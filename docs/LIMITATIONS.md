# Known Limitations

Honest list of what this release does **not** do, per the "do not claim a feature works unless
it is implemented" rule.

## Cap accounting

- **Season-level accounting only.** No daily proration, no in-season accrual of cap space
  toward the trade deadline. Deadline-space projection is on the roadmap and requires daily
  accounting.
- **LTIR is simplified**: relief equals the injured player's hit (optionally capped by a pool
  input). Real pool establishment (relative to cap space on placement day) is not modeled.
- **Buyouts are simplified**: dead cap = remaining hit × fraction per remaining season; no
  age-dependent ⅓/⅔ rates and no spread years beyond the contract's original term.
- **Performance bonuses** are charged as scheduled cash; no bonus-overage carryover to the
  next season.
- Waiver eligibility is tracked as a status + games threshold rule but call-up/send-down
  simulations do not yet block on waiver-required players — they surface status only.
- No arbitration awards, qualifying-offer amounts, offer-sheet compensation, or entry-level
  slide rules yet (statuses are tracked; math is roadmap).
- Weekly-payroll and daily-cap league types exist in the schema but have no engine yet.

## Scenarios

- **Applying a scenario is one-way.** The apply flow (preview → confirm) writes official
  records atomically and marks the scenario read-only, but there is no UI-level undo — reversing
  an applied scenario means making new official moves. Every applied move is recorded in the
  transaction log and audit history.
- Apply is blocked while the projection contains blocking violations; there is no
  override-with-reason flow yet (a compliance officer "requires review" path is roadmap).
- No undo/redo stack inside the builder (transactions can be disabled/removed instead).
- Multi-team trade modeling is limited to this team's side (out with retention / in with
  retention); draft-pick trades are recorded descriptively, not valued.

## Data & imports

- CSV import covers **players**, **contracts** (one row per contract-season), **NCAA
  conferences**, **NCAA schools**, **NCAA prospects**, **NCAA season statistics**, **NCAA
  game logs**, and **NHL draft status & rights**. League rules, projections, scholarship,
  and NIL importers are roadmap; the definitions module (`src/lib/import/definitions.ts`)
  is the extension point.
- Record matching in importers is by exact full name (players, prospects) or exact name
  (schools, conferences); ambiguous names are rejected rather than guessed. Files are
  capped at 1 MB / 2000 rows.
- Schools and conferences are global reference data (not org-scoped); duplicate detection
  is by name. Connector imports record source URL / retrieved date / effective season in
  `data_sources` automatically; the CSV upload form still does not capture them.
- No file storage (player documents) yet despite the schema field.
- Free agents are tracked per organization (scouting records), not as a shared league pool.

## Real-data connectors

- **Licensing is the operator's responsibility.** MoneyPuck's data page (checked
  2026-09-22) allows free use for non-commercial purposes and ad-hoc journalism with clear
  credit, and asks other uses to contact MoneyPuck. A commercial front-office deployment
  needs MoneyPuck's approval before importing its data. The NHL endpoints are public but
  undocumented and subject to NHL.com terms; NHL data is © NHL. The app credits sources
  everywhere the data is shown but cannot grant rights.
- **NHL API formats can change without notice.** Parsers fail loudly on a missing envelope,
  but a silently renamed field would import as blank (NULL) rather than error. Re-record
  fixtures (`npm run fixtures:record`) and re-run the parser tests when behavior looks off.
- **EliteProspects is unverified against real data.** No API key was available while it was
  built, so only the real 401 responses were recorded. The parser accepts only the minimal
  `{ data: [{ id, … }] }` envelope, maps id / name / position / shoots / date of birth, and
  rejects anything else. Record a real response with a key before relying on it; height,
  weight, birthplace, and stats are intentionally not mapped yet.
- **Reference data is not linked to official records.** Imported NHL players live in
  `ext_*` tables and are not matched to RosterIQ `players`, NCAA `amateur_prospects`, or the
  Phase 3 draft or CFA boards. Draft picks and Central Scouting
  rankings carry no NHL player id in the source, so they are not linked to player pages.
- **No cross-source reconciliation.** NHL and MoneyPuck rows are shown per source, never
  blended; they can differ (e.g. MoneyPuck assigns a traded player's season to one team
  while the NHL stats summary lists "BOS,FLA"). Rows are merged only on the shared NHL
  player id.
- **Derived rates are display-only** (ixG/60, P/60, G − ixG, GSAx, GSAx/60): computed from the
  source's reported values and labeled; never stored and never computed without reported
  ice time. MoneyPuck reports its on-ice percentages rounded to two decimals.
- **A reported save % of 0 with no shots against** (seen in minor-league goalie lines of the
  NHL landing feed) is treated as missing and flagged in the import warnings.
- **Rate limiting and caching are per server process.** The per-host limiter is in memory
  and the cache is per organization (the same public response fetched by two orgs is
  fetched twice by design). A multi-instance deployment needs a shared limiter.
- **Game logs** come from the per-player endpoint, one player at a time (two requests
  each, because the game log carries no player name). Team-wide game logs and
  play-by-play / shift data are not imported yet.
- **Scale limits:** 25 player ids per request (10 for game logs); 10,000 rows per connector import; 10 MB per
  response. Imports run synchronously in the request (a full MoneyPuck skater file with all
  five situations is ~4,600 rows).
- **No scheduled refresh.** Data is imported on demand only; re-running a connector and
  approving updates rows in place (natural-key upsert). Removed/renamed upstream rows are
  not deleted automatically.
- Behind an outbound HTTPS proxy, the server must run with `NODE_USE_ENV_PROXY=1` (Node's
  built-in fetch ignores `HTTPS_PROXY` otherwise).

## RosterIQ models (xG + prospects)

- **Model outputs, not official data.** Imported through the gated pipeline and labelled as
  model output wherever shown. The app never runs a model; it imports season totals and
  per-player projections written by `analytics/`.
- **xG sees no passes.** The NHL feed does not record pre-shot passes (cross-seam, royal road),
  the biggest gap in any public xG model. Blocked shots are not modelled (as MoneyPuck); empty-net
  attempts are counted, not modelled; penalty shots are excluded.
- **The NHL's event recording changes from season to season.** 2021-22 → 2025-26: rebounds 7.2% →
  10.6% of unblocked attempts (goal rate 17.5% → 10.2%), attempts inside 10 ft 9.5% → 14.5%,
  tips 7.0% → 9.6%. The model weights seasons by distance to the season it scores (half-life
  chosen on validation data) but cannot know a future season's recording in advance; the nightly
  drift check flags when goals and xG part ways. No arena-by-arena location correction.
- **xG is descriptive.** It measures the chances a player got, not finishing skill and not a
  forecast; small samples (a few weeks of a season) are noisy.
- **Prospects: draft position predicts better.** On the 2016–2019 test drafts the stats-only
  model was clearly worse than draft position alone, and adding the stats to draft position gave
  no detectable improvement (paired bootstrap, 95% intervals on the model card). Before the
  draft, combined with NHL Central Scouting's final rank, the stats did add information
  (AUC +0.014 [+0.002, +0.028]) — tested on drafted players only, one four-draft window. The
  model's value is explaining a production profile, flagging disagreement with the draft slot,
  and adding to the pre-draft consensus — not ranking players on its own.
- **Prospect inputs are thin.** Points, goals, games, age, draft-time size, position and league
  only — no ice time, role, quality of competition, or anything scouts see. Outcome (200 NHL
  games in seven seasons) also depends on opportunity, and the shortened 2019-20 / 2020-21
  seasons and the 84-game schedule from 2026-27 shift it slightly by cohort. Goalies are not
  modelled.
- **NHLe** is estimated from players who changed leagues (not a random sample; promotions follow
  good seasons) and is league-level only. League names were merged and tournaments excluded by
  explicit lists (`analytics/rosteriq_models/prospects/careers.py`) — judgement calls. Four draft
  picks (2005–2026) could not be linked to an NHL player id and are reported, not guessed.
- **Leakage kept small but not zero:** NHLe factors use all seasons, including later careers of
  test-draft players (league-level averages only).

## College / NIL

- Schema-only (schools, conferences, college teams, athletes, scholarships, allocations,
  institutional payments, NIL agreements/valuations). No UI, no engine, no seed data. Nothing
  in the product claims otherwise.

## Models

- v0.1 valuation models are transparent heuristics on fictional data — not validated, and
  labeled as estimates everywhere. See docs/MODELS.md.

## Amateur scouting

- Statistical models are v0.1 heuristics on fictional data (see docs/SCOUTING.md for
  full assumptions): no schedule-strength adjustment, PIM-proxy physicality, weak
  goalie inference, org-scoped percentile pools.
- No NCAA time-on-ice data — per-60 rates are never computed or estimated.
- Percentiles are position-relative and conference-relative (pools under 8 peers are
  reported as insufficient, F/D/G never mixed); a dedicated same-age percentile pool is
  approximated by the age-adjusted-PPG metric rather than an age-bucketed population.
- Percentile panels are computed on request from stored season lines (fast at seed
  scale); only role scores are cached with a model version.
- The players-page trend/percentile columns are limited to what the list query derives
  (PPG, shots/game); full trend classifications live on the profile.
- Saved filter views are per-user, per-page snapshots of the querystring — they are not
  shared across the organization.
- AI scouting assistant, projection models, weight-editing UI, consensus rankings,
  and professional-outcome comparables are deliberately deferred past this slice.

## Organizational fit (riq-fit-v0.2)

- Fit is a transparent weighted heuristic on fictional data — decision support, not a
  ranking authority. Component thresholds (depth buckets, timeline penalties,
  acquisition scores) are v0.2 judgment calls documented in the engine, not fitted
  parameters.
- Timeline uses class year as the only arrival estimator (freshman ≈ 3y … senior ≈ 0y);
  no per-player development-curve modeling.
- AHL opportunity is proxied by org players with `rosterStatus = minor` at the
  position — there is no real affiliate roster model yet.
- PK special-teams fit uses short-handed scoring as a weak proxy (flagged in the
  output) because NCAA usage data does not exist; PP fit uses PP point share.
- Prospect-pool scarcity counts scout-assigned or top persisted statistical roles;
  prospects without computed role scores don't count toward target-role coverage.
- Size preference is stored on the need but not yet scored as a component.
- Weights are per model version and global; per-organization weight overrides and a
  weight-editing UI are deferred (weights change via new model versions).
- Depth snapshots are captured per run; the needs-page depth summary is computed live
  and can drift from the last snapshot until the next run.

## Acquisition boards

- Board mutations run as sequential statements, not a single database transaction per
  change; a crash mid-change could leave a version row without its snapshot. Acceptable
  at demo scale; wrap `commitBoardVersion` callers in `db.transaction` before production.
- Consensus uses a plain mean/median over submitted ranks; it does not weight scouts by
  seniority or coverage, and ranks from scouts who saw a prospect once count equally.
- The statistical-model rank is the best persisted role score, not a draft-value model;
  organizational-fit rank uses the best fit across all active needs.
- Viewing counts come from `scout_viewings`; there is no viewing-entry UI yet (seeded
  data only), and assignment scheduling is out of scope for this phase.
- CFA boards can be archived but not locked; there is no CFA version snapshot (field
  history is kept instead).
- Real data sources (NHL APIs, NHL Central Scouting, MoneyPuck, EliteProspects) are not
  connected yet — all board data is fictional (see the roadmap).

## Platform

- Roster optimization (OR-Tools/PuLP) not built yet; schema reserved.
- AI assistant not built yet; provider abstraction reserved via env vars.
- No user invitation flow (members are seeded or created via registration; role management UI
  is minimal read-only).
- PDF export is browser-print based; server-side PDF rendering is roadmap.
- Shareable links currently cover the roster/cap report; scenario-comparison and valuation
  share links are roadmap. Shared snapshots are frozen by design and never update.
- Inbound request rate limiting is not implemented (abstraction point noted in middleware
  roadmap); outbound connector requests are rate-limited per host.
- PGlite local mode is single-process: run one server per `.data` directory. `db:seed` refuses
  to run against `DATABASE_URL` as a guard.
- The embedded demo database ships unencrypted fictional data only.
