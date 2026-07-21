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
  is by name. Import-level source URL / retrieved-date metadata lives in the
  `data_sources` table and is not yet captured in the upload form.
- No file storage (player documents) yet despite the schema field.
- Free agents are tracked per organization (scouting records), not as a shared league pool.

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

## Platform

- Roster optimization (OR-Tools/PuLP) not built yet; schema reserved.
- AI assistant not built yet; provider abstraction reserved via env vars.
- No user invitation flow (members are seeded or created via registration; role management UI
  is minimal read-only).
- PDF export is browser-print based; server-side PDF rendering is roadmap.
- Shareable links currently cover the roster/cap report; scenario-comparison and valuation
  share links are roadmap. Shared snapshots are frozen by design and never update.
- Rate limiting is not implemented (abstraction point noted in middleware roadmap).
- PGlite local mode is single-process: run one server per `.data` directory. `db:seed` refuses
  to run against `DATABASE_URL` as a guard.
- The embedded demo database ships unencrypted fictional data only.
