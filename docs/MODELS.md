# Model Governance & Model Cards

Rules for every valuation/projection model in RosterIQ:

- Each model has a **name and version** (`riq-perf-v0.1`, `riq-market-v0.1`); stored outputs
  (`player_valuations`, `surplus_value_records`, `player_projections`) carry the version used.
- Versions are never silently replaced: a new version writes new rows; historical reports keep
  the version that generated them.
- Every user-facing output shows: model version, confidence, input-data date, assumptions,
  comparables used, and a disclaimer that it is an estimate.
- Outputs are stored with provenance `model_generated` and must never be presented as official.

---

## Model card: riq-perf-v0.1 — Estimated Performance Value

- **Output**: estimated dollar value of a player's projected season, USD.
- **Formula**: `leagueMin + projectedGAR × $/GAR × availability × positionFactor`, floored at
  the league minimum. Position factors: G 0.90, D 1.05, F 1.00. `$/GAR = $425,000` (assumed
  league-wide market price derived from the seeded demonstration dataset).
- **Inputs**: stored projection row (GAR, availability), position, league minimum salary rule.
- **Confidence method**: not probabilistic; component breakdown is exposed instead.
- **Validation**: none — transparent heuristic for workflow validation on fictional data.
- **Known limitations**: linear in GAR; no aging curve inside the season value; $/GAR is a
  single league constant; goalie valuation is crude.
- **Status**: active (demo).

## Model card: riq-market-v0.1 — Estimated Market Value

- **Output**: estimated next-contract AAV (median, low, high), term, total, confidence 0–1.
- **Method**: 50/50 blend of the performance value and the median AAV of the 5 nearest
  same-position comparables (distance = 4×|Δage| + |Δplatform points|), comparables inflated
  by an assumed 4%/season cap growth; ×0.85 RFA discount; league-minimum floor. Band width
  scales with (1 − confidence); confidence rises with comparable count, capped at 0.85.
- **Inputs**: age, position, projected points, free-agent status, comparable pool
  (`comparable_contracts`: global fictional pool + org-entered records), min-salary rule.
- **Term heuristic**: age band (≤23: 3–4y, 24–26: 5y, 27–29: 4y, 30–32: 3y, 33–34: 2y, 35+: 1y).
- **Validation**: none — heuristic on fictional data; not a negotiation predictor.
- **Known limitations**: no contract-structure modeling (bonuses, term-price tradeoff), no
  market-conditions signal, small comparable pool, age may be null.
- **Status**: active (demo).

## Model card: seeded projections (riq-perf-v0.1 rows)

Seeded `player_projections` are generated (provenance `projected`) with GAR loosely tracking
pay plus noise, so surplus values spread realistically in both directions. They exist to
exercise the workflow, not to describe real athletes.

## Surplus value

`surplus = performanceValue − capHit` — see CALCULATIONS.md. Stored per player/season/model in
`surplus_value_records`.

## Roadmap for models

Regression-based market model with backtesting on licensed data, arbitration-award estimator,
qualifying-offer calculator, aging curves, Monte Carlo availability, and the NIL estimator —
all behind the same versioning/governance rules above.
