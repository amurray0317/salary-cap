# RosterIQ Architecture

## Goals

- One founder-maintainable production stack (single Next.js app + one database).
- A configurable, versioned **rules engine** instead of hardcoded league values.
- Simulations that are provably isolated from official records.
- Every displayed figure explainable to its formula, inputs, and rule version.
- Organization isolation enforced server-side (and at the DB layer on Supabase).

## Assumptions (documented per Phase 1)

1. **NHL-style annual cap first.** Weekly/daily accounting systems are represented in the schema
   (`cap_system` enum, `salary_cap_periods.period_type`) but the engine currently implements
   season-level annual accounting only.
2. **Season-level accounting.** No daily proration of cap hits; a season is one accounting
   period. This is the largest simplification vs. a real CBA (see LIMITATIONS).
3. **One active contract per player.** Extensions are modeled as scenario overlays or new
   contracts, not amendments.
4. **Roster status lives on the player** and applies to all projected seasons unless a scenario
   changes it. Future-season status assumptions are explicit in the UI copy.
5. **Retained salary** is a fraction of the contract's cap hit: retained-by-others reduces our
   hit; salary we retain for departed players is a `cap_obligations` row per season.
6. **Money is whole dollars** in `bigint` columns; no floating-point cap math.
7. **Local mode = embedded PGlite.** The same Drizzle schema and SQL migrations run against
   managed Postgres when `DATABASE_URL` is set. PGlite is single-process: don't run two servers
   against one `.data` directory.
8. **College module is schema-only** in this release; scholarship/NIL/institutional-payment data
   is modeled but has no UI. This keeps the product honest about what works.

## Layering

```
UI (App Router pages, server components)
  │  reads view models, posts server actions
Server actions (zod-validated, audited)          src/server/actions/*
  │  authorize via requireOrgAccess(org, capability)
Services (assemble inputs, run engines)          src/server/services/*
  │  pure data in, pure data out
Engines (cap, scenario projector, valuation)     src/lib/{engine,scenario,valuation}
  │
Drizzle schema + migrations                      src/db/*, drizzle/*
```

- **Engines are pure**: no DB, no React, no ambient config. They take a `RuleSet` (already
  versioned rows) and typed inputs; they return totals + line items + violations. This is what
  makes calculation tests trivial and the numbers explainable.
- **Services** are the only code that assembles engine inputs from persisted rows
  (`buildTeamCapInputs`, `getScenarioProjection`, `valuatePlayer`).
- **Server actions** are the only mutation path. Each one: zod-parses the form, calls
  `requireOrgAccess` with the needed capability, verifies row ownership (`WHERE organization_id
  = ctx.organizationId` on every lookup), performs the write (multi-row writes inside
  `db.transaction`), and writes an `audit_logs` row.

## Rules engine data flow

`league_rules` rows are keyed `(league, season, rule_key, rule_version)`; only `is_active` rows
feed the engine. `loadRuleSet` produces a `Map<ruleKey, RuleValue{value, version, effectiveDate}>`.
The engine records every rule it consulted in `appliedRules`, and each violation carries the rule
key + version + effective date, so a report generated in March can name the exact rule text used.

Rule edits (League rules page) deactivate the old row, insert version+1 with a new effective
date, snapshot into `rule_versions`, and audit-log the change. Nothing is overwritten.

## Scenario isolation

`scenario_transactions.payload` is a zod discriminated union (`src/lib/scenario/payloads.ts`).
The projector deep-clones the official `CapInput[]`, applies transactions in order, marks
everything it adds/changes `isHypothetical`, and reports notes for anything it had to skip.
DB tests assert official tables are untouched after inserting scenario transactions.

Crossing the boundary is explicit: `applyService.applyScenario` is the only code that turns
scenario transactions into official records. It runs behind the `manage_team` capability, a
confirmation form, and a server-side re-projection that refuses to apply while blocking
violations exist. All moves apply inside one DB transaction (all-or-nothing), each move writes
an official `transactions` row, and the scenario flips to `applied` (read-only). The service
takes its `Db` as a parameter (no `server-only` import) so integration tests can run it
against in-memory PGlite.

## CSV import pipeline

One generic pipeline serves all eight dataset types (players, contracts, NCAA conferences,
schools, prospects, season statistics, game logs, NHL draft status). The single source of
truth is `src/lib/import/definitions.ts`: per-type field definitions (key, label, required,
validator), template rows, and header auto-mapping — the UI, the service, and the tests all
consume it. `importService` runs the state machine `pending → awaiting_approval →
committed | rejected`; validation persists row-level problems to `import_errors` and
NOTHING is written to target tables until explicit approval, which re-validates
server-side from stored raw data (page state is never trusted) and commits only clean rows
in one transaction. Per-type validation adds in-file + against-DB duplicate detection,
referential checks (school → conference, stats/logs/draft → existing prospect), and
cross-field rules (drafted requires a year; undrafted must leave round/overall blank).
Every transition is audit-logged.

## Real-data connectors

```
connector form (edit_data) ──► connectorService.runConnectorImport
   zod request ─► buildPlan (URLs, source name, credit, terms)
   cachedFetch  ─► connector_cache (per org, TTL) ─miss─► rateLimitedGet
                    (host allowlist · per-host min interval · 30 s timeout · 10 MB cap)
   pure parser  ─► normalized records ("" = not reported) + warnings + effective season
   importService.createConnectorImport ─► imports (source_kind=connector, source_meta)
                                        ─► validateImport (identity mapping) ─► awaiting_approval
explicit approval ─► commitImport ─► data_sources row ─► connectorCommit upserts ext_* rows
```

- **Pure parsers** live in `src/lib/connectors/{nhl,moneypuck,eliteprospects}.ts` and were
  written against recorded real responses (`tests/fixtures/connectors/`, produced by
  `scripts/record-connector-fixtures.ts`, which only drops whole array elements / CSV lines
  and records URL, status, time, and trimming in `manifest.json`). A parser that does not
  find the envelope it depends on throws `ConnectorParseError` instead of importing a guess.
- **Connector datasets are import types** (`src/lib/import/connectorDefinitions.ts`) with
  `connectorOnly` set: the upload action and template route refuse them, and connector
  imports always validate with the identity mapping (no re-mapping of real data). Field
  descriptions name the source column; `m_*` fields land in the row's `metrics` JSON.
- **Natural keys** (`rowKey`) drive in-file duplicate detection, the preview's
  new-vs-update count, and `ON CONFLICT` upserts, so re-importing refreshes rows instead of
  duplicating them. Datasets that carry only part of a bio (rosters) use a fill-only upsert
  (`coalesce(excluded.x, x)`) so they never erase fields another dataset supplied.
- **Provenance**: `imports.source_meta` holds source name, redacted URLs, retrieval time
  (a cache hit keeps the original retrieval time), effective season, credit, terms, cache
  status, and parser warnings; commit copies it into one `data_sources` row whose id is
  stamped on every committed `ext_*` row (plus `import_id`).
- **Tenancy**: `connector_cache`, `imports`, `data_sources`, and all `ext_*` tables carry
  `organization_id`; every read goes through `referenceDataService` with the context's org
  id; RLS policies cover the new tables on Supabase. Cache entries are never shared across
  organizations (an EliteProspects response fetched under one org's key must not leak).
- **Secrets**: the EP key is read from `EP_API_KEY` at request time, sent as the `apiKey`
  query parameter (the only form the API accepted when probed), and redacted from cache
  keys, stored URLs, provenance, and audit logs.
- **Game logs** (`ext_player_game_logs`, migration 0009) follow the same path; the service
  fetches each player's game log and landing (for the name) and pairs them by position.
- **Separation from official records**: real data lives in `ext_*` reference tables and never
  writes `players`, `contracts`, or cap tables; the demo seed is unchanged.

## RosterIQ models (offline) → model-output imports

```
scripts/data/fetch-raw.ts (rate-limited, allowlisted, gzip cache in .data/raw)
   NHL play-by-play + skater bios · draft picks ─► player search ─► landing (draft details must match)
analytics/ (Python, pinned)
   xg/shots.py (parse, validated against MoneyPuck's shot file) ─► features ─► explainable.py
   prospects/careers.py (league aliases, tournaments dropped) ─► nhle.py (network NHLe) ─► dataset ─► explainable.py
   explainable.py: logistic regression (splines) + XGBoost trees on its logit (base_margin)
                   → exact per-group contributions (LR terms + TreeSHAP) → probability units
   train steps: selection on a validation split, test on unseen seasons/drafts,
                leave-one-out scoring for every historical total
   export.py ─► models/<version>/import_*.csv (+ metrics.json model card, production model)
app
   Real data → RosterIQ models form ─► connectorService.runModelImport
      readModelFile (fixed names, version regex, SHA-256) ─► header must equal the import definition
      ─► createConnectorImport (source_kind=connector, connector_key=rosteriq_models) ─► approval ─► commit
      xG totals → ext_player_seasons / ext_team_seasons (source rosteriq_xg[_goalies]); prospects →
      ext_prospect_projections; NHLe → ext_league_equivalencies (migration 0010, RLS)
```

- The app never runs a model: it imports season totals and per-player projections that the
  pipeline wrote, through the same gated path as every other source. Model cards
  (`metrics.json`) are rendered at `/real-data/models`.
- Draft picks carry no NHL player id in the feed; a pick is linked only when the candidate's
  landing page reports the same draft year and overall pick (unit-tested on recorded
  responses, including three players named Mikko Lehtonen). Forfeited picks are reported as
  "no player selected".

## NCAA player list & percentiles

`prospectListService.listProspects` is the shared assembly for the players page and the
filtered CSV export (`/api/export/prospects`, gated by `export_scouting`) — filters,
sorting, and derived stats live once. Saved filter views are querystring snapshots stored
per user in `saved_views`. `scoutingService.computePercentilePanel` builds position- and
conference-relative percentile pools from same-season, same-position-group org prospects;
pools under 8 peers report null percentiles rather than extrapolating, and F/D/G
populations never mix.

## Organizational fit (riq-fit-v0.2)

The fit engine (`src/lib/scouting/fit.ts`) is pure: it takes a need input, a prospect
input, a depth context, and a weight map, and returns 14 components each carrying
input value, desired value, raw score, weight, weighted contribution, penalties,
missing inputs, and an explanation, plus an overall (0–100), a confidence (covered
weight share, reduced by warnings), the model version, and a timestamp. Missing data
excludes a component and reduces confidence — it never produces a low score.

Weights live in `fit_component_weights`, keyed by model version
(`fit_models → fit_model_versions`); `fitService.loadActiveFitModel` is the only
loader and engine defaults are a flagged fallback. `runFitForNeed` writes one
`fit_calculation_runs` row per execution, batch-assembles prospect inputs (one query
per table), upserts `prospect_fit_scores` (unique per prospect + need + model
version), replaces the normalized `prospect_fit_components`, captures
`organizational_depth_snapshots` + `prospect_pool_depth_snapshots`, and refreshes
auto roster links to the expiring contracts motivating the need. The whole path is
read-only over official roster/contract/scenario/prospect data. `run_fit_models`
(analyst tier) gates runs; `manage_org_needs` (director/GM) gates need CRUD;
`export_scouting` gates `/api/export/fit`.

## Acquisition boards

`boardService` is the only mutation path for draft and college free-agent boards.
Draft-board writes go through `commitBoardVersion`, which bumps `draft_boards.version`,
inserts a `draft_board_versions` row, stores an immutable ordered snapshot in
`draft_board_snapshots`, and writes one `draft_board_rank_history` row per change
(previous/new value and rank, user, version, reason). Version comparison diffs a stored
snapshot against the live entries — snapshots are never rewritten.

Ranking sources live in separate columns on `draft_board_entries` (`overall_rank`,
`model_rank`, `consensus_rank`, `fit_rank`, `director_final_rank`); each has exactly one
writer (reorder, `refreshBoardDerived`, `recomputeConsensus`, and `setDirectorRank`), so
no source can overwrite another. Individual rankings live in `scout_rankings` (unique per
board/prospect/scout); `consensus_rankings` caches the pure `computeConsensus` result
(n, mean, median, best, worst, spread, stddev, insufficient flag).

Lock guards run in the service, not just the UI: `assertUnlocked` rejects reorder,
add/remove, director rank, scout rankings, and rank-bearing field edits on locked or
archived boards; notes/recommendations pass only with an explicit `allowOnLocked` flag
that the action sets for board managers. `finalize_boards` locks, `unlock_boards`
unlocks, `manage_draft_boards` edits. CFA entries record field-level history in
`college_free_agent_status_history`; contact fields require `manage_contacts` and
follow-up fields require `assign_followups`, and assigned staff must be members of the
organization. Exports log to `board_exports`.

## Tenancy & security

- Session tokens: 32 random bytes, stored **hashed** (SHA-256) in `sessions`, HttpOnly cookie.
- Passwords: scrypt (N=16384), constant-time compare.
- `requireOrgAccess(orgId, capability)` resolves membership + role tier per request; capability
  tiers in `src/lib/auth/roles.ts`.
- Working-context cookies (org/team/season) are validated against real memberships on every
  request — a forged cookie cannot select an org the user doesn't belong to.
- On Supabase, `supabase/policies.sql` adds RLS as a second enforcement layer.
- Exports (`/api/export/*`) run the same context resolution; unauthenticated requests get 401,
  cross-org ids get 404.

## Folder structure

See README "Architecture" section; test layout mirrors features (`tests/capEngine`, `scenario`,
`valuation`, `isolation`, `csv`, `connectorParsers`, `connectorPipeline`); real-response
fixtures live in `tests/fixtures/connectors/`.
