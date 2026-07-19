# Implementation Checklist

## Phase 1 — Planning
- [x] Inspect repository (empty greenfield)
- [x] Architecture plan (docs/ARCHITECTURE.md)
- [x] Assumptions documented
- [x] Folder structure created
- [x] First vertical slice defined

## Phase 2 — Foundation
- [x] Next.js 15 + strict TypeScript + Tailwind 4
- [x] Reusable UI primitives (Card, StatTile, CapMeter, ViolationList, tables, empty states)
- [x] Auth (local provider: scrypt + hashed session tokens; Supabase slot via env)
- [x] PostgreSQL via Drizzle (embedded PGlite locally, DATABASE_URL for managed PG)
- [x] SQL migrations generated & applied
- [x] RLS policies for Supabase deployment (supabase/policies.sql)
- [x] Environment template (.env.example), no secrets in repo
- [x] Seed script (fictional BHL: 4 orgs/teams, 120 players, contracts, scenarios…)

## Phase 3 — Core data
- [x] Organizations, members, roles
- [x] Leagues, seasons, versioned league rules
- [x] Teams, players, rosters
- [x] Contracts + contract-season schedules
- [x] Cap obligations (retained / dead cap)

## Phase 4 — Cap engine
- [x] Rules engine (versioned RuleSet consumption)
- [x] Cap calculations (active/IR/LTIR/buried/retained/dead)
- [x] Roster-limit & contract-limit & individual-max validation
- [x] Future commitments (multi-season)
- [x] Calculation explanations (line items + applied rules)
- [x] Automated tests (16 engine tests)

## Phase 5 — Scenarios
- [x] Scenario CRUD, duplicate, archive
- [x] Typed transaction payloads (zod)
- [x] Sign / trade out+retention / trade in / call-up / send-down / IR-LTIR / extension / buyout
- [x] Projection (official vs projected, multi-season)
- [x] Scenario comparison (1–5 scenarios vs official)
- [x] Automated tests (13 scenario tests)
- [x] Apply scenario to official roster (preview page, blocking-violation gate,
      manage_team capability, atomic apply with official transaction log + audit;
      11 integration tests in tests/applyScenario.test.ts)

## Phase 6 — Valuation
- [x] Projection storage
- [x] Market-value model v0.1 (+ comparables)
- [x] Performance-value model v0.1
- [x] Surplus value
- [x] Confidence scores, assumptions, disclaimers
- [x] Model documentation (docs/MODELS.md)
- [x] Automated tests (12 valuation tests)

## Phase 7 — Reports
- [x] Roster CSV, commitments CSV, valuations CSV, comparison CSV
- [x] Print-optimized roster report (browser PDF)
- [x] Shareable read-only links (frozen snapshot in reports/report_sections,
      unguessable token, public /share/[token] route, revoke, audit;
      5 integration tests in tests/shareReport.test.ts)
- [x] CSV import UI (downloadable templates, field mapping, row-level
      validation into import_errors, preview, explicit approval before commit;
      players + contracts importers; 14 tests in tests/csvImport.test.ts)
- [ ] Server-side PDF (deferred)

## Phase 8 — Quality (final run 2026-07-18)
- [x] `tsc --noEmit` clean
- [x] `eslint` clean
- [x] 80/80 vitest tests passing (engine, scenario, valuation, apply,
      share reports, CSV import pipeline, isolation/permissions/DB, CSV)
- [x] Production build succeeds (29 routes)
- [x] Live smoke test: login, dashboard math, scenario projection, violation display,
      comparison CSV, roster CSV, player valuation panel
- [x] Isolation verified live: rival org gets 404 on foreign scenario page & export; sees only
      its own team
- [x] Apply-scenario flow verified in the browser: preview → confirm → applied banner,
      re-apply blocked, transaction log populated, over-cap scenario gated by violations
- [x] Share-link flow verified in the browser: create → anonymous visitor sees the frozen
      snapshot but cannot reach the app → revoke → link returns 404
- [x] CSV import verified in the browser: template download → upload → auto-mapped fields →
      validation with visible row-level error → approve → "Committed 2 of 3 rows" → valid
      players live in Players, invalid row excluded, history shows Committed

## Amateur Scouting (NCAA D-I men's hockey) — vertical slice
- [x] Schema: 25+ scouting tables (migration 0003), org-scoped, reference data global
- [x] Roles/permissions: scouting_director, scouting_asst_director, crossover_scout +
      9 scouting capabilities on the existing tier model
- [x] Engines: trends (riq-trend-v0.1), percentiles + age adjustment, role scoring
      (riq-role-v0.1, DB-stored weights), explainable fit (riq-fit-v0.1, live contract depth)
- [x] Navigation: 10-tab scouting section + sidebar entry
- [x] NCAA player table with position/school/conference/hand/age/PPG/draft filters
- [x] Prospect profile: stats (TOI-honest), trends, role-score explanations,
      scout-assigned roles (separate from inference), reports, comparables
- [x] Scouting reports (viewing types, 20–80 grades, floor/ceiling/risk/recommendation)
- [x] Organizational needs + explainable fit scores; watchlists; draft board with
      model-vs-scout rank deltas (never averaged away); CFA board; assignments; model center
- [x] Print-optimized prospect report export
- [x] CSV import types: ncaa_players, ncaa_season_stats (full gated pipeline)
- [x] Seed: 6 conferences, 20 schools, 305 prospects, 694 season lines, 1,482 game
      logs, 34 archetypes / 114 weights, 1,200 role scores, reports, boards, needs,
      fits, comparables, isolation fixtures
- [x] 32 new tests (112 total passing): engines, service integration, isolation,
      permissions, uniqueness constraints
- [x] Verified in the browser end to end (all 15 slice steps + rival-org 404)
- [ ] Deferred: scouting AI assistant query layer, projection models, weight-editing
      UI, consensus rankings, conference-relative percentiles (see docs/SCOUTING.md)

## MVP acceptance test status
1–8 (register→commitments) ✓ · 9–14 (scenarios, violations) ✓ · 15–16 (valuation, surplus) ✓ ·
17–18 (compare, export) ✓ · 19 (sign out/in persistence) ✓ · 20 (cross-org denial) ✓
