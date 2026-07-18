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
│   ├── engine/    cap rules engine — pure, versioned, explainable
│   ├── scenario/  typed transaction payloads + projector (overlay, never mutates)
│   ├── valuation/ market/performance/surplus models v0.1 (transparent heuristics)
│   ├── auth/      password hashing, sessions, role→capability map
│   └── csv.ts, format.ts
├── server/
│   ├── context.ts       requireOrgAccess: server-side tenancy + role gate
│   ├── appContext.ts    org/team/season working-context resolution
│   ├── services/        capService, scenarioService, valuationService
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
- `SESSION_SECRET` — required in production for the local provider
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase mode
- `LLM_PROVIDER`, `LLM_API_KEY` — reserved for the future AI assistant (off by default)

No secrets are committed; `.env*` is gitignored.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build / serve |
| `npm run db:generate` | regenerate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations (PGlite or `DATABASE_URL`) |
| `npm run db:seed` | load fictional demo data (local DB only; refuses `DATABASE_URL`) |
| `npm run db:reset` | wipe local DB, re-migrate, re-seed |
| `npm run typecheck` / `npm run lint` / `npm test` | quality gates |

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

## Data sources

The MVP uses user-entered data, CSV-style seeds, and fictional demonstration data only. A
`data_sources` table tracks name/URL/retrieved/verified/confidence for every externally sourced
record, and provenance enums (`official / user_entered / estimated / projected / model_generated`)
are carried on players, contracts, statistics, and valuations. No scraping; licensed providers
would plug in behind the import layer.

## Known limitations

See `docs/LIMITATIONS.md` for the full list. Headlines: season-level (not daily) cap accounting,
simplified LTIR and buyout math, applied scenarios have no UI-level undo, no CSV import UI yet,
college/NIL modules are schema-only, and the valuation model is a v0.1 heuristic.

## Documentation

- `docs/ARCHITECTURE.md` — decisions, assumptions, module boundaries
- `docs/CALCULATIONS.md` — every cap formula with worked examples
- `docs/MODELS.md` — model cards for the valuation models
- `docs/LIMITATIONS.md` — known limitations and simplifications
- `docs/ROADMAP.md` — post-MVP phases (AHL/ECHL, NCAA/NIL, optimization, AI assistant)
- `docs/CHECKLIST.md` — implementation checklist and acceptance-test status
