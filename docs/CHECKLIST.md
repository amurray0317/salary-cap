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
      UI, consensus rankings (see docs/SCOUTING.md)

## Amateur Scouting Phase 1 — data foundation (final run 2026-07-19)
- [x] Schema completeness (migration 0004): conference abbreviation; school short
      name/abbreviation/city/state/country/division/active flag; prospect
      external_ref/draft_round/draft_overall; game-log home_away/PP points/faceoffs/TOI;
      watchlist member priority/reason/follow-up date
- [x] CSV import types now cover the full Phase-1 set: ncaa_conferences, ncaa_schools,
      ncaa_players, ncaa_season_stats, ncaa_game_logs, ncaa_draft_status — all through the
      same gated pipeline (template → upload → mapping w/ auto-suggestions → row-level
      validation → preview → explicit approval; invalid rows never committed)
- [x] Import validation: in-file + against-DB duplicate detection (conferences, schools,
      per-game logs, per-prospect draft rows); referential checks (school → conference,
      logs/draft → existing prospect); cross-field draft rules (drafted requires year,
      undrafted must leave round/overall blank)
- [x] NCAA players page: name search, position/conference/school/class/hand/draft-status
      filters, max-age/min-PPG/min-GP thresholds, 8 sort keys with direction, pagination
      (50/page), column visibility toggles, per-user saved filter views (saved_views),
      filtered CSV export (/api/export/prospects, gated by export_scouting)
- [x] Prospect profile: draft round/overall in header, percentile panel (position- and
      conference-relative pools, n shown, <8-peer pools reported as insufficient, F/D/G
      never mixed), data sources & provenance section (source name, verification status,
      TOI-honesty note)
- [x] Watchlists: priority (1–5) + reason + follow-up date on add, sorted display,
      remove with audit trail
- [x] Seed updated for all new columns (conference abbreviations, school geography,
      draft round/overall, game-log home/away + PP points, watchlist priorities)
- [x] `tsc --noEmit` clean · eslint clean · 118/118 vitest tests (6 new) ·
      production build succeeds
- [x] Browser acceptance run (26 checks): login as scouting director → filtered/sorted/
      paginated list → saved view → column visibility → filtered CSV export → profile
      percentiles + provenance → watchlist add (priority/reason/follow-up) + remove →
      4 new templates download → conferences import chain (upload → auto-map → validate
      with duplicate error → approve → committed; new conference selectable in filters) →
      Ironport sees only its own 5 isolation-fixture prospects

## Amateur Scouting Phase 2 — organizational needs & prospect fit (final run 2026-07-21)
- [x] Schema (migration 0005): needs extended (name, description, secondary position,
      scout-role target, arrival window + target season, size/special-teams preferences,
      NHL-roster/AHL flags); organizational_need_requirements (normalized 20–80 grade
      floors); organizational_need_roster_links; fit_models / fit_model_versions /
      fit_component_definitions / fit_component_weights (the engine's only weight source);
      fit_calculation_runs; prospect_fit_components (normalized per-component breakdown);
      organizational_depth_snapshots + prospect_pool_depth_snapshots; fit scores carry
      run id + confidence
- [x] Fit engine riq-fit-v0.2: 14 components (position, handedness, statistical role,
      scout role — kept separate, timeline window, NHL readiness, AHL opportunity, roster
      depth, contract expiry, pool scarcity, special teams, scout grades, risk,
      acquisition method); every component reports input, desired value, raw score,
      weight, weighted contribution, penalties, missing inputs, and explanation; missing
      data is excluded and reduces confidence — never scored low; overall normalized
      0–100 with model version + timestamp
- [x] Weights load from fit_component_weights per active model version (never hardcoded
      in React); engine defaults only as a flagged fallback
- [x] fitService: batch-scored runs per need (run row, upserted scores, replaced
      components, org + pool depth snapshots, auto-linked expiring contracts), single-
      prospect recompute, live depth summary, 2–5-prospect comparison; read-only over
      official roster/contract/prospect data
- [x] Permissions: run_fit_models capability (analyst tier+); manage_org_needs
      (director/GM); export gated by export_scouting; org isolation on needs, scores,
      runs, snapshots, comparisons, exports
- [x] UI: Org needs tab (list + live depth-by-position summary + full create form),
      need detail (requirements, roster links, run button, run history, snapshots,
      ranked fit table with search/sort/pagination/column visibility/compare checkboxes,
      CSV export), comparison page (side-by-side components, decision-support evidence
      without an automatic verdict, watchlist add), upgraded profile fit panel
      (inputs × weights = contributions, confidence, warnings)
- [x] Export: /api/export/fit?needId=… ranked CSV with all 14 component columns
- [x] Seed: fit model + version + 14 definitions/weights, 5 varied needs (incl.
      right-shot transition D with grade minimums and a PK need that showcases
      missing-data warnings), grade requirements, 5 runs → 660 scores / 9,240 component
      rows / snapshots / 40 roster links — seeded through the real service
- [x] 21 new tests (139 total): engine components + confidence + DB-weight override,
      service runs/upserts/isolation/no-mutation/comparison/depth, permissions
- [x] `tsc --noEmit` clean · eslint clean · 139/139 vitest · production build succeeds
- [x] Browser acceptance run (20 checks): create right-shot transition-D need with 2–4y
      window and skating/sense minimums → run model → ranked table (sorted, auto-linked
      expiring D contracts, run history) → top-prospect profile shows every component's
      input × weight = contribution with warnings → compare top two (all components,
      decision support, missing-data flags) → watchlist add → ranked CSV export →
      rival org 404s on the need page and export and sees no Aurora needs
- [ ] Deferred: draft boards beyond current slice, NHL projection models, ML models,
      Elite Prospects integration, fit-weight editing UI

## Amateur Scouting Phase 3 — draft board & college free-agent board (2026-09-22)
- [x] Schema (migrations 0006 + 0007): draft boards gain status/version/lock fields;
      entries gain position rank, expected round/range, separate model/consensus/fit/
      director rank columns, risk/floor/ceiling, viewing/report counts, last viewed;
      new draft_board_versions, draft_board_snapshots, draft_board_rank_history,
      scout_rankings + consensus_rankings (board-scoped, replacing reserved
      placeholders), college_free_agent_boards/entries/status_history,
      board_meeting_notes, board_exports
- [x] Capabilities: finalize_boards + unlock_boards (director/GM), manage_cfa_boards,
      manage_contacts, assign_followups (asst. director/analyst tier); view/manage/export
      reuse view_scouting / manage_draft_boards / export_scouting
- [x] Consensus engine: n, mean, median, best, worst, spread, stddev; insufficient
      (< 3) and disagreement (≥ 10 spots) warnings
- [x] Draft boards: multiple boards and years, add/remove, drag-and-drop reorder with
      reason, position ranks, director final rank, personal scout ranks, entry fields,
      notes (editable when locked), meeting notes, lock/unlock/archive, 14 filters,
      2–5 comparison, history + version comparison, CSV export
- [x] CFA boards: multiple boards, undrafted-only candidates, drag-and-drop priorities,
      rights/eligibility/availability/readiness/roles/fit/competition, agent, ten-stage
      relationship pipeline, last contact, next action + date, assigned staff, notes,
      candidate + board archiving, field history, org-wide follow-up view, 14 filters,
      2–5 comparison, CSV export
- [x] Seed: locked 2026 board and active 2027 board, 74 scout rankings from four scouts
      (spreads up to 15 spots, 7 thin-sample prospects), 52 versions / 123 history rows,
      47 scout viewings, two CFA boards covering nine relationship statuses, overdue and
      upcoming follow-ups, signed and archived candidates
- [x] 22 new tests (161 total): consensus math, lifecycle, reorder persistence, position
      ranks, source separation, consensus spread + insufficient warnings, locking,
      archived boards, versioning/snapshots, rank history, CFA fields + status history,
      follow-ups, staff validation, isolation, permissions, export logging
- [x] `tsc --noEmit` clean · eslint clean · 161/161 vitest · production build succeeds
- [x] Browser acceptance run (30 checks, all 19 required steps): create board → add four
      prospects → real drag-and-drop reorder persisted → position filter → separate
      ranking columns → disagreement flags → lock → edit controls gone, notes still
      editable, analyst cannot unlock, director can → version list + compare with current
      → CSV export → create CFA board → add candidates → eligibility/availability,
      relationship (with history), follow-up + staff → drag priorities → CSV export →
      both comparisons → rival org 404s on both boards, history, and exports
- [x] Bug fixed during verification: a constant exported from a "use client" module
      reached the server page as a client reference (`.map is not a function`); moved to
      `src/lib/scouting/cfa.ts`
- [ ] Deferred: real data connectors (NHL APIs, NHL Central Scouting, MoneyPuck,
      EliteProspects), viewing-entry UI, assignment scheduling, per-change DB transactions

## Real data connectors (final run 2026-09-22)
> Built after Phase 2; merged with Phase 3 (draft + CFA boards) — the connector migration
> is 0008, after Phase 3's 0006/0007.
- [x] Network check: api-web.nhle.com, api.nhle.com, moneypuck.com, peter-tanner.com
      reachable; api.eliteprospects.com reachable but returns 401 without a key (no
      `EP_API_KEY` in this environment → EP built disabled-until-configured)
- [x] Real responses inspected first and recorded as fixtures (15 files + manifest:
      player landings skater/goalie, roster, CS rankings NA skaters/NA goalies, draft
      picks, stats REST skater/goalie/team summaries + team index, MoneyPuck
      skaters/goalies/teams CSVs, EP 401 bodies); recorder script is deterministic and
      drop-only
- [x] Schema (migration 0008, renumbered after Phase 3): connector_cache; ext_players, ext_roster_entries,
      ext_player_seasons, ext_team_seasons, ext_draft_picks, ext_draft_rankings (all
      org-scoped, all stats nullable); provenance columns on imports and data_sources;
      RLS policies
- [x] NHL API connector: player bios, career seasons (all leagues, TOI only when
      reported), rosters, league skater/goalie/team summaries (tri-codes via team
      index), draft history, NHL Central Scouting rankings (midterm/final kept separate)
- [x] MoneyPuck connector: skaters / goalies / teams season-summary CSVs by situation,
      credited as "Data: MoneyPuck.com", terms shown before fetching and stored with
      every import
- [x] EliteProspects connector: official API only, `apiKey` parameter, key redacted
      everywhere, disabled until `EP_API_KEY` is set, strict envelope check
- [x] HTTP policy: host allowlist, per-host rate limits (NHL 500 ms, MoneyPuck 2 s,
      EP 1 s), per-org cache with TTLs + bypass, 30 s timeout, 10 MB cap, audit log of
      fetches and failures
- [x] Every connector import goes through the existing gated pipeline: pending →
      validation (identity mapping, in-file natural-key duplicates) → preview with
      provenance + new/update counts → explicit approval → upsert + data_sources row;
      connector types can never be uploaded as CSV
- [x] UI: Real data section (connectors, players & stats, draft, teams, provenance log),
      import preview provenance panel, sidebar entry, import-history connector badge
- [x] Demo seed unchanged; real data imported on demand only
- [x] 34 new tests (173 total): 21 parser tests on recorded fixtures (+ validators agree
      with parsers, rate limiter, EP config/redaction/401s), 13 pipeline tests on PGlite
      (gating, provenance, upsert, cache per org, isolation, reject, TOI NULLs, roster
      fill-only, MoneyPuck credit, two-request team stats, EP disabled + real 401)
- [x] `db:migrate` + `db:seed` clean · `tsc --noEmit` clean · eslint clean · 173/173
      vitest · production build succeeds (53 routes)
- [x] Live browser run against the real sources (`npm run test:e2e:real-data`, 9 checks):
      EP disabled notice → Central Scouting 2025 NA skaters fetched live → preview shows
      URL/effective season/"fetched live" and no mapping step → nothing in reference
      tables before approval → approve → draft page → MoneyPuck 2024-25 skaters (all +
      5on5) → approve → McDavid career via NHL API (no-TOI warning) → approve → player
      page merges NHL career + MoneyPuck with credit and "—" for unreported TOI → repeat
      fetch served from cache with new/update counts → discard → Ironport sees nothing
      and gets 404 on Aurora's import
- [ ] Deferred: linking ext players to RosterIQ players / NCAA prospects / draft board,
      EP data mapping beyond identity (needs a recorded real response), scheduled
      refreshes, shared multi-instance rate limiter, MoneyPuck lines/shots datasets

## Real data — NHL game logs
- [x] Real responses recorded first: McDavid 2024-25 regular + playoffs, Hellebuyck
      2024-25 (goalie with a relief appearance that has no `decision`, and "O" OT/SO
      losses), plus Hellebuyck's landing for the name the game log omits
- [x] Migration 0009: `ext_player_game_logs` (org-scoped, unique per player + game,
      skater and goalie columns nullable) + RLS policy
- [x] `nhl_game_logs` connector dataset (≤10 players per request, 2 rate-limited
      requests each), gated preview → approval → upsert, provenance as for all
      connectors
- [x] Player page: game log per season/type with season and last-10 summaries derived
      from the per-game rows (per-60 uses only games with reported TOI)
- [x] Reconciliation test: summed game-log rows equal the career season line (67 GP,
      26 G, 100 P, 22:02 average TOI); goalie totals 47-12-3, 1,664 SA, 125 GA
- [x] 4 new tests (177 total) · typecheck · lint · build · live browser run 10/10
      (adds the game-log import and player-page checks)

## RosterIQ models — xG + prospects (2026-09-24)
- [x] Raw data: `scripts/data/fetch-raw.ts` (allowlist + per-host limiter + gzip cache): NHL
      play-by-play 2021-22 → 2025-26 (7,000 completed games; unplayed "if necessary" playoff
      games skipped), skater bios, drafts 2005–2026 linked to NHL ids only when the landing page
      confirms draft year + pick (4,747 linked, 4 unresolved, 5 forfeited picks reported)
- [x] Shot parser validated against MoneyPuck's shot file: 2025-26 99.6% of each side matched,
      goal labels 100%, empty-net 99.99%
- [x] xG: LR + XGBoost on its logit, exact per-group explanations; recency weighting and rush
      definition chosen on 2024-25; 2025-26 test beats MoneyPuck shot-level (log loss 0.2141 vs
      0.2168, game-level bootstrap below zero); every season's totals out-of-sample
- [x] Prospects: network NHLe (league aliases merged, tournaments excluded), dataset, same model
      family; test drafts 2016–2019 show draft position predicts better (bootstrap on the card);
      draft-slot probability shown beside each projection
- [x] Migration 0010: `ext_prospect_projections`, `ext_league_equivalencies` (+RLS); model-output
      import types reading `models/<version>/` (header must match; SHA-256 provenance); rows stored
      under the model version so a new version never overwrites an old one
- [x] UI: RosterIQ models section (incl. "stage all xG totals" bundle, one approval), player-page
      ixG reasons / GSAx / prospect card, Prospects page, Model cards page
- [x] Nightly in-season scoring (`rosteriq_models.xg.score`, `nightly-xg.yml`, drift check)
- [x] CI: Python tests job; `npm run test:e2e:models` browser run
- [x] Pre-draft benchmark vs NHL Central Scouting final rank (2016–2019): stats + Central Scouting
      beats Central Scouting alone (bootstrap intervals exclude zero, overall and after round 1);
      linking by name + birth date with reviewed transliterations; on the model card
- [x] `db:reset` deletes only the local database (it used to remove all of `.data`, including the
      raw download cache)

## MVP acceptance test status
1–8 (register→commitments) ✓ · 9–14 (scenarios, violations) ✓ · 15–16 (valuation, surplus) ✓ ·
17–18 (compare, export) ✓ · 19 (sign out/in persistence) ✓ · 20 (cross-org denial) ✓
