# Product Roadmap

## R1 (shipped) — NHL-style cap MVP
Versioned rules engine, cap dashboard with explainable calculations, contracts with per-season
schedules, isolated scenario simulator (sign/trade±retention/assignments/IR/extension/buyout),
scenario comparison, valuation v0.1 + surplus value, compliance checks, CSV + printable
reports, role-based access, audit log, seeded fictional demo.

## R2 — Cap depth
- Daily cap accounting + trade-deadline space projection
- Real LTIR pool mechanics; bonus overage carryover
- Age-accurate buyout schedules with spread years
- Waiver blocking in simulations; qualifying offers & arbitration estimates
- Apply-scenario-to-official with preview, confirmation, and full audit trail
- CSV import UI (templates, field mapping, row-level validation, approval gate)
- Shareable read-only report links; server-side PDF

## R3 — Multi-league organizations
- AHL rules + affiliate reimbursement; ECHL weekly payroll engine
- Organizational depth chart across NHL/AHL/ECHL with cascading moves
- Draft-pick inventory & pick valuation
- League-office views (league-wide compliance)

## R4 — Analytics
- Roster optimization service (Python FastAPI + OR-Tools MIP) behind a job abstraction
- Regression-based market model with backtesting on licensed data; model registry UI
- Monte Carlo roster simulations; trade-value model

## R5 — College vertical
- NCAA roster planner UI (roster limits, scholarship equivalents, allocations)
- Institutional athlete-payment budgeting; compliance exports
- NIL market-value estimator (labeled estimates, comparable athletes)
- Transfer-portal scenarios; retention modeling

## R6 — Platform
- AI front-office assistant: deterministic query layer first, LLM behind provider abstraction,
  org-scoped retrieval with citations and confirmation gates
- Public API; licensed data-provider integrations; subscription billing; mobile apps

---

## 2026-27 season, data coverage and models

Free data and free services only. Model outputs reach the app only through
the gated import pipeline (preview → approval → provenance).

### 2026-27 season readiness

| Item | What happens on opening night | Status |
|---|---|---|
| Nightly xG | 10:00 UTC: downloads newly final games, scores them with the committed production model, commits season-to-date totals to `models/rosteriq-xg-v1` | Live; off-season runs are no-ops |
| Nightly rehearsal | Manual run with `rehearse = 20252026`: re-scores last season as if in progress and pushes to the `nightly-rehearsal` branch; proves every step including the bot's push | To run once before opening night |
| Drift alarm | Goals vs xG beyond a Poisson z-score of ±4 (overall or by distance band) marks the nightly run failed, so GitHub emails the owner | Live |
| Standings | NHL standings through the connector; each import replaces the previous standings | Live (one click per refresh) |
| App updates | Stage the xG bundle and approve it on Real data | One click per refresh |
| Hosting | Vercel (free Hobby) + Supabase (free) so the app is reachable anywhere and picks up nightly commits | Needs the owner's accounts |
| 2027 draft | Central Scouting midterm list (January) → pre-draft scoring with stats + midterm rank | Planned (prospect model v2) |
| In-season drift review | Our xG vs MoneyPuck on the same shots, about 250 games in (mid-November) | Planned |

### Navigation (sections requested by staff)

Built: grouped sidebar, light ice-blue/purple theme, compact tables,
Standings (NHL). Items marked *planned* in the sidebar:

- **Scores (live):** NHL games from the NHL API (`/v1/score/{date|now}`),
  refreshed every ~20–30 s with a short server cache; display only, never
  stored or used by models. Flashscore is not a source (no public API; its
  terms do not allow reuse). Other leagues as their platforms are connected.
- **Data-backed:** Pro player tracking (NHL EDGE: skating speed, shot speed,
  zone time; free) · League overview · other leagues' standings and player
  stats (see [LEAGUE_COVERAGE.md](LEAGUE_COVERAGE.md)).
- **Staff-entered:** development reports · my calendar · prospect calendar ·
  prospect traits · drill library · development video (links) · workout
  designer / programs · daily console · amateur player tracking · injuries ·
  team chat (messages stored in the app; no paid AI).
- **Needs a definition:** WAR components for prospects (no public WAR exists
  for junior or European players).

### Feature queue (chosen by the owner, in build order)

Single power user for now (may expand later); everything in-app.

1. **In-season prospect tracker:** every drafted or ranked prospect's season
   updated daily (HockeyTech + NHL), P(regular) re-scored as games are played.
2. **Prospect comparables:** the most similar draft-year profiles and what
   became of them, next to the model's probability.
3. **On-ice impact:** NHL shift charts (free) + RosterIQ xG: on-ice xGF/xGA
   per 60, line combinations, with-or-without-you.
4. **Alerts & daily digest (in-app):** prospect breakouts, drift alarms, new
   Central Scouting lists, standings moves.
5. **Player comparison:** 2–4 players side by side (stats, xG, model
   breakdowns, contracts).
6. **Contract value model:** projected AAV and term for upcoming UFAs/RFAs,
   plugged into cap scenarios; before the trade deadline.
7. **Trade analyzer:** cap impact and value on both sides.
8. **Draft-day war room:** live board (model + Central Scouting + needs),
   picks crossed off, best available with reasons; ready by June 2027.

### Models

- **Prospect model v2 (in progress):** tiered outcome (NHL regular / top of
  lineup by ice time), the full Central Scouting-ranked population
  (undrafted players included), benchmarks vs draft position and Central
  Scouting final and midterm ranks.
- **Game predictions (future tab):** win probability (incl. OT/SO), puck
  line (P(win by 2+)), over/under (P(total > 5.5 / 6.5)) and fair odds, from
  a team goal model built on RosterIQ xG, goalie GSAx, special teams, home
  ice and rest. Shown only after out-of-sample validation (log loss,
  calibration) against simple baselines. Free historical betting lines are
  scarce, so beating the market cannot be assumed or, possibly, measured.
