# RosterIQ — Front-Office Roster Intelligence Platform

RosterIQ helps professional sports front offices manage salary-cap space, contracts, rosters,
transaction scenarios, and player valuation in one place. The current release implements the
**NHL-style annual-cap MVP**: cap accounting, contract management, an isolated transaction
simulator, a transparent valuation model, scenario comparison, compliance checks, and exports —
all driven by a **versioned, configurable rules engine** rather than hardcoded league values.

> All bundled demonstration data (league, teams, players, contracts, figures) is fictional.
> Every model output is an estimate and is labeled as such throughout the product.

## Demo

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000 and sign in:

| Login | Password | Role |
|---|---|---|
| `gm@aurora.demo` | `rosteriq-demo` | Org admin, Aurora Ridge Hockey Club |
| `analyst@aurora.demo` | `rosteriq-demo` | Cap analyst, Aurora Ridge Hockey Club |
| `gm@ironport.demo` | `rosteriq-demo` | GM, Ironport Athletic Company (demonstrates isolation) |

The seed creates the fictional **Boreal Hockey League** (4 seasons of versioned rules), 4
organizations/teams, 120 players, 100+ multi-year contracts (retained salary, dead cap, IR/LTIR,
two-way and buried deals), 5 saved scenarios, 20 transaction examples, projections, comparables,
and persisted valuations. One team is intentionally over the cap and one below the floor so the
compliance engine has something to say out of the box.

## Technology stack

- **Frontend / app server** — Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS 4
- **Database** — PostgreSQL via Drizzle ORM. Local/dev/CI runs an **embedded PGlite** (real
  Postgres compiled to WASM, persisted to `.data/pglite`) so no external services are needed.
  Setting `DATABASE_URL` switches the same code to managed Postgres (e.g. Supabase).
- **Auth** — provider abstraction; the built-in local provider uses scrypt password hashing and
  opaque session tokens stored hashed in the DB, delivered via HttpOnly cookies. A Supabase auth
  provider can be slotted in via `AUTH_PROVIDER` without touching call sites.
- **Testing** — Vitest: pure-function engine tests plus DB-backed integration tests on in-memory
  PGlite with the real migrations.

## Architecture

```
src/
├── db/            schema.ts (40+ tables), client.ts (PGlite/Postgres switch)
├── lib/
│   ├── connectors/ NHL API, MoneyPuck, EliteProspects parsers + HTTP policy (pure)
│   ├── engine/    cap rules engine — pure, versioned, explainable
│   ├── scenario/  typed transaction payloads + projector (overlay, never mutates)
│   ├── valuation/ market/performance/surplus models v0.1 (transparent heuristics)
│   ├── auth/      password hashing, sessions, role→capability map
│   └── csv.ts, format.ts
├── server/
│   ├── context.ts       requireOrgAccess: server-side tenancy + role gate
│   ├── appContext.ts    org/team/season working-context resolution
│   ├── services/        capService, scenarioService, valuationService,
│   │                    connectorService (fetch → gated import), referenceDataService
│   └── actions/         validated server actions (zod), all audited
└── app/           App Router pages (public, auth, and app shell)
```

Key invariants:

1. **No cap logic in components.** Pages call services; services assemble inputs and run the
   engine; the engine is a pure function.
2. **League rules are data.** `league_rules` rows are versioned by league, season, key, effective
   date, source, and version. Edits deactivate the old row and insert version+1; the engine reports
   which rule versions produced every figure.
3. **Scenarios are overlays.** `scenario_transactions` are validated payloads applied at read time
   by the projector. Official tables are never touched by a simulation (enforced and tested).
   The only crossing point is the explicit apply flow: preview → confirm (manage_team role,
   no blocking violations) → atomic write of official records + transaction log + audit, after
   which the scenario is read-only.
4. **Every figure is explainable.** The engine emits line items with formula text, input records,
   and applied rule versions, surfaced in the dashboard's calculation-detail table and reports.
5. **Isolation is server-side.** Every read/write is scoped by organization membership checked in
   the service layer; a Supabase deployment adds database-level RLS (`supabase/policies.sql`).

### Salary-cap engine (src/lib/engine)

Inputs: season, rule set, contract-seasons (cap hit, cash, status, retained-by-others %), and cap
obligations (retained/buyout/dead cap). Outputs: totals (cap charge, space, floor, cash), counts,
line items, violations, warnings, applied rules. Supported mechanics: active roster, scratches,
IR, simplified LTIR relief pool, buried contracts (minimum + allowance threshold), retained
salary on both sides of a trade, dead cap, suspended players, minimum salary, individual maximum
(% of upper limit), roster min/max, goalie minimum, contract-slot limit.

### Scenario engine (src/lib/scenario)

Transaction types: free-agent signing, trade out (with retention), trade in (with retention by
others), call-up, send-down, IR/LTIR placement, extension, simplified buyout. Transactions are
zod-validated discriminated unions; malformed rows are skipped and reported, never applied.

### Valuation models (src/lib/valuation) — v0.1, estimates only

- **Performance value** = league minimum + projected GAR × $/GAR × availability × position factor.
- **Market value** = blend of performance value and the median AAV of the 5 nearest same-position
  comparables (age/points distance, cap-inflation adjusted), with an RFA discount, a
  league-minimum floor, and a confidence-driven low/high band.
- **Surplus value** = performance value − actual cap hit.

These are transparent rules-based heuristics for workflow validation — not scientifically
validated pricing models. Every output carries model version, confidence, assumptions,
comparables, input-data date, and a disclaimer. See `docs/MODELS.md` for governance.

## Environment variables

Copy `.env.example` to `.env`. Everything is optional in local mode:

- `DATABASE_URL` — managed Postgres; unset = embedded PGlite in `.data/`
- `PGLITE_DATA_DIR` — override the local data directory
- `AUTH_PROVIDER` — `local` (default) or `supabase`
- `REGISTRATION_MODE=invite_only` — only people with an invite link (Settings → Invite people) can
  create an account; unset = open sign-up
- `SESSION_SECRET` — required in production for the local provider
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase mode
- `LLM_PROVIDER`, `LLM_API_KEY` — reserved for the future AI assistant (off by default)
- `BILLING_ENABLED`, `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` — paid plans (Settings → Plan &
  billing); off by default, and while off every feature is unlocked. See `.env.example`
- `EP_API_KEY` — EliteProspects official API key; the EP connector is disabled until it is set
- `NODE_USE_ENV_PROXY=1` — only when outbound HTTPS goes through a proxy (Node's fetch ignores
  `HTTPS_PROXY` otherwise)

No secrets are committed; `.env*` is gitignored.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build / serve |
| `npm run db:generate` | regenerate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations (PGlite or `DATABASE_URL`) |
| `npm run db:seed` | load fictional demo data (local DB only; refuses `DATABASE_URL`) |
| `npm run db:reset` | wipe the local database only (`.data/pglite`, or `PGLITE_DATA_DIR`), re-migrate, re-seed — cached raw data in `.data/raw` and model work files in `.data/models` are kept |
| `npm run typecheck` / `npm run lint` / `npm test` | quality gates |
| `npm run fixtures:record` | re-record real connector fixtures into `tests/fixtures/connectors/` |
| `npm run test:e2e:real-data` | live browser run of the connectors (needs a running server with network access) |
| `npm run data:fetch -- --pbp <seasons> --draft <years>` | download raw NHL play-by-play / draft / career data for the models into `.data/raw` (cached, rate-limited) |
| `.venv/bin/pytest -q analytics/tests` | modelling pipeline tests (see `analytics/README.md` for training and export) |

## Deployment

- **Vercel + Supabase**: set `DATABASE_URL` (Supabase Postgres), run `npm run db:migrate` during
  release, apply `supabase/policies.sql` for row-level security, set `SESSION_SECRET`. The
  frontend deploys as a standard Next.js app.
- **Single container**: `npm run build && npm start` with a mounted volume for `.data/` (embedded
  DB) or `DATABASE_URL` pointing at any Postgres 14+.

## Permission model

Roles map to cumulative capability tiers (`src/lib/auth/roles.ts`):

| Tier | Capability | Roles |
|---|---|---|
| 0 | read | viewer |
| 1 | annotate | coach, scout, agent, consultant |
| 2 | review | compliance officer, finance/college/NIL admin |
| 3 | edit data | analyst, cap analyst |
| 4 | manage team | GM, assistant GM |
| 5 | admin | org admin, league admin |

Checks happen server-side in `requireOrgAccess(orgId, capability)`; UI hiding is cosmetic only.
All mutating actions write `audit_logs` rows (user, action, entity, before/after values).

## Reports & exports

CSV exports (roster, future commitments, valuations, scenario comparison) are stamped with
generation time, team/season, and model versions. A print-optimized roster report provides PDF
output via the browser. All exports enforce the same org-scoping as pages.

Shareable read-only links (Reports page) freeze the current cap report into a stored snapshot
and mint an unguessable `/share/<token>` URL that renders without sign-in — only the snapshot,
never live data. Links are revocable and both creation and revocation are audit-logged.

## Amateur scouting (NCAA D-I men's hockey)

The Amateur Scouting module gives hockey-operations staff a searchable NCAA prospect
database (position/school/conference/age/handedness/production filters), prospect
profiles with multi-season stats and versioned trend classifications, transparent
role scoring against 34 configurable archetypes (weights stored in the database,
every score explained with inputs × weights, missing data, and contradicting
evidence), scout-assigned roles kept strictly separate from statistical inference,
structured scouting reports on a 20–80 scale, watchlists, collaborative acquisition
boards (below), scout assignments, and an explainable organizational-fit system wired into
RosterIQ's live contract data. Organizational needs (Org needs tab) capture what the
front office is looking for — position, handedness, target statistical role and
scout-defined role (kept separate), an NHL-arrival window, acquisition path,
size/special-teams preferences, risk tolerance, and 20–80 grade minimums — and the
fit model (riq-fit-v0.2, 14 components, weights stored in `fit_component_weights`)
ranks every eligible NCAA prospect against a need in one run. Each score decomposes
into input × weight = contribution per component with penalties, missing-input flags,
and a confidence value; missing data is excluded and lowers confidence rather than
scoring low. Runs snapshot org and prospect-pool depth, auto-link the expiring
contracts that motivate the need, and feed a ranked table (search/sort/pagination/
column visibility/CSV export) plus a 2–5-prospect comparison view that presents
evidence side by side without issuing an automatic verdict. The NCAA Players page adds
name search, class/min-GP thresholds, eight sort keys, pagination, per-user saved
filter views, column visibility toggles, and a filtered CSV export
(`/api/export/prospects`, gated by the `export_scouting` capability). Prospect
profiles show position- **and** conference-relative percentiles (pool sizes shown;
pools under 8 peers reported as insufficient, forwards/defensemen/goaltenders never
mixed) plus a data-sources & provenance section. Watchlist entries carry a priority
(1–5), reason, and follow-up date, and can be removed with an audit trail. NCAA
conferences, schools, prospects, season statistics, game logs, and NHL draft-status
updates all import through the same gated CSV pipeline. Demo login:
`scouting@aurora.demo` / `rosteriq-demo` (scouting director). Time-on-ice is never
fabricated, and every model output is a labeled, versioned estimate — the system
supports scouts, it does not replace them (`docs/SCOUTING.md`).

### Acquisition boards (draft + college free agents)

**Draft boards** (Draft board tab) are multi-board and multi-year. Each entry carries five
ranking sources in separate columns that never overwrite one another: the working
overall order, the statistical-model rank (best persisted role score), the scout
consensus, the organizational-fit rank (best fit across needs), and the director's final
rank. Scouts submit personal rankings; the consensus shows the number of submissions,
mean, median, best–worst range, and standard deviation, and flags 10+ spot splits and
samples under three rankings rather than hiding disagreement behind an average. Boards
support drag-and-drop reordering (with an optional reason), recomputed position ranks,
expected round and selection range, risk/floor/ceiling, viewing and report counts,
recommendations, private notes, meeting notes, 14 filters, a 2–5 prospect comparison,
CSV export, and lock/unlock/archive. Every meaningful change bumps the board version,
writes an immutable ordered snapshot, and records previous/new value, rank, user,
timestamp, and reason; the history page compares any earlier version with the current
board. A locked board rejects ranking, add/remove, and rank-field changes (notes and
recommendations stay editable for board managers); locking and unlocking are
director-level capabilities and are audit-logged.

**College free-agent boards** (College FAs tab) track undrafted targets: signing
priority (drag-and-drop, history-tracked), NHL rights status, remaining eligibility,
expected availability, readiness, projected AHL/NHL roles, organizational fit, signing
competition, agent, a ten-stage relationship pipeline, last contact, next action + due
date, and an assigned staff member. Field-level history records every change; an
org-wide follow-up view flags overdue actions. Agent/relationship/contact fields and
follow-up assignment are separately permissioned, and all board records are
organization-isolated.

## Data imports

The Imports page provides a gated CSV pipeline: download a template, upload a file, map CSV
columns to target fields (auto-mapped by name), and review row-level validation — every
problem is stored in `import_errors` with its row, column, and message. Nothing is written
until you explicitly approve; approval commits only the rows that validated cleanly, in one
transaction, and is audit-logged. Eight dataset types are supported: players, contracts (one
row per contract-season, grouped by player; a group with any invalid row is skipped whole),
NCAA conferences, NCAA schools, NCAA prospects, NCAA season statistics, NCAA game logs, and
NHL draft status & rights. Validation includes in-file and against-database duplicate
detection, referential checks (schools must name an existing conference; stats/logs/draft
rows must name an existing prospect), and cross-field rules (drafted rows require a draft
year; undrafted rows must leave round/overall blank).

## Real data connectors

The **Real data** section pulls real-world data on demand — the fictional demo seed is
untouched, and nothing real is bundled:

| Connector | Datasets | Notes |
|---|---|---|
| NHL API (`api-web.nhle.com`, `api.nhle.com`) | player bios, career seasons (all leagues), per-game logs (skater and goalie, per-game TOI), team rosters, league skater/goalie/team season summaries, draft history, **NHL Central Scouting rankings** (`/v1/draft/rankings/{year}/{category}`) | public, undocumented endpoints |
| MoneyPuck season-summary CSVs | skaters, goalies, teams by situation (all / 5on5 / 5on4 / 4on5 / other) | **Data: MoneyPuck.com** — credited everywhere it is shown; free for non-commercial use per moneypuck.com/data.htm |
| EliteProspects (official API only) | player search | **disabled until `EP_API_KEY` is configured**; never scrapes |

Every fetch is host-allowlisted, rate-limited per host, and cached per organization. The
response is parsed into a connector-only import type and staged in the **same gated import
pipeline** as CSV uploads: the preview shows the source, request URL (secrets redacted),
retrieval time, effective season, cache status, credit, terms, and parser warnings, plus
how many rows are new vs. updates. Nothing is written until a user with `edit_data`
approves; approval upserts the org's `ext_*` reference tables and records a `data_sources`
row (source name, URL, retrieved date, effective season, credit, terms) that every
committed row points to. Missing values stay NULL — e.g. junior-league seasons have no TOI
in the NHL feed and are shown as "—", never estimated. Browse pages: players & stats
(NHL career + league summaries + game logs with season and last-10 summaries + MoneyPuck,
merged on the NHL player id, with clearly labeled derived rates such as ixG/60, P/60, and GSAx), Central Scouting rankings (midterm vs.
final, never blended) and draft history, and team seasons by source and situation.

Parsers were written against **recorded real responses** in `tests/fixtures/connectors/`
(`manifest.json` lists URL, status, retrieval time, and trimming for each; re-record with
`npm run fixtures:record`).

## RosterIQ models (expected goals + prospects)

Two models are built offline in `analytics/` (Python, pinned requirements) from public
NHL data and imported into the app **as season totals and per-player projections only**:

| Model | Output in the app |
|---|---|
| `rosteriq-xg-v1` — probability an unblocked shot attempt becomes a goal | skater ixG with a per-feature breakdown ("why"), goalie xGA / GSAx, team xGF / xGA, per season, game type and situation |
| `rosteriq-prospects-v1` — probability a drafted skater plays 200+ NHL games in the seven seasons after the draft, from draft-time information only | one projection per drafted skater (2005–2025 drafts) with a per-feature breakdown, and a league equivalency (NHLe) table |

Both are a logistic regression with gradient-boosted trees fitted on top of its output;
each prediction splits exactly into a baseline plus per-feature contributions. Every
historical number is out-of-sample (leave-one-season-out / leave-one-draft-out), and each
model is benchmarked on data no fitting step saw: xG against MoneyPuck's shot-level xG on
the same shots, prospects against a draft-position-only model. The model cards
(**Real data → Model cards**, and `docs/MODELS.md`) show the numbers and the limits.

Model outputs are committed under `models/<version>/` and staged from **Real data →
RosterIQ models** through the same gated import pipeline as every connector (preview →
approval → commit, with the file path, SHA-256, model version and training time recorded
as provenance). The app refuses an output file whose columns differ from the import
definition. Reproduce or retrain: `analytics/README.md`.

## Data sources

The fictional demo seed stays as-is. Real data enters only through the connectors above
(on demand, per organization, gated) or user CSV uploads. The `data_sources` table carries
source name / URL / retrieved date / effective season / credit / terms for every connector
import, and provenance enums (`official / user_entered / estimated / projected /
model_generated`) are carried on players, contracts, statistics, and valuations. No scraping.
MoneyPuck's shot-level files are used only offline, as the benchmark for RosterIQ xG (Data:
MoneyPuck.com); they are never a model input and are not imported.

## Known limitations

See `docs/LIMITATIONS.md` for the full list. Headlines: season-level (not daily) cap accounting,
simplified LTIR and buyout math, applied scenarios have no UI-level undo, college/NIL modules
are schema-only, and the valuation model is a v0.1 heuristic.

## Documentation

- `docs/ARCHITECTURE.md` — decisions, assumptions, module boundaries
- `docs/CALCULATIONS.md` — every cap formula with worked examples
- `docs/MODELS.md` — model cards for the valuation models and the RosterIQ xG / prospect models
- `analytics/README.md` — how the xG and prospect models are built, validated, and reproduced
- `docs/LIMITATIONS.md` — known limitations and simplifications
- `docs/ROADMAP.md` — post-MVP phases (AHL/ECHL, NCAA/NIL, optimization, AI assistant)
- `docs/CHECKLIST.md` — implementation checklist and acceptance-test status
