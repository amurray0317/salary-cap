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

## NCAA player list & percentiles

`prospectListService.listProspects` is the shared assembly for the players page and the
filtered CSV export (`/api/export/prospects`, gated by `export_scouting`) — filters,
sorting, and derived stats live once. Saved filter views are querystring snapshots stored
per user in `saved_views`. `scoutingService.computePercentilePanel` builds position- and
conference-relative percentile pools from same-season, same-position-group org prospects;
pools under 8 peers report null percentiles rather than extrapolating, and F/D/G
populations never mix.

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
`valuation`, `isolation`, `csv`).
