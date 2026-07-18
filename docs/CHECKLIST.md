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
- [ ] Shareable read-only links (schema ready; route deferred)
- [ ] Server-side PDF (deferred)

## Phase 8 — Quality (final run 2026-07-18)
- [x] `tsc --noEmit` clean
- [x] `eslint` clean
- [x] 61/61 vitest tests passing (engine, scenario, valuation, apply,
      isolation/permissions/DB, CSV)
- [x] Production build succeeds (25 routes)
- [x] Live smoke test: login, dashboard math, scenario projection, violation display,
      comparison CSV, roster CSV, player valuation panel
- [x] Isolation verified live: rival org gets 404 on foreign scenario page & export; sees only
      its own team
- [x] Apply-scenario flow verified in the browser: preview → confirm → applied banner,
      re-apply blocked, transaction log populated, over-cap scenario gated by violations

## MVP acceptance test status
1–8 (register→commitments) ✓ · 9–14 (scenarios, violations) ✓ · 15–16 (valuation, surplus) ✓ ·
17–18 (compare, export) ✓ · 19 (sign out/in persistence) ✓ · 20 (cross-org denial) ✓
