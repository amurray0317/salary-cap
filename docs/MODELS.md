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

## Model card: rosteriq-xg-v1 — Expected goals (built from NHL play-by-play)

- **Output**: probability an unblocked shot attempt (shot on goal, miss or goal) with a goalie in
  net becomes a goal. Imported as season totals only: skater ixG, goalie xGA / GSAx, team
  xGF / xGA per season, game type and situation (all, 5on5, 5on4, 4on5).
- **Inputs** (NHL play-by-play, api-web.nhle.com): distance, angle, shot type, rebound (own
  attempt ≤ 3 s before), rush (turnover, hit, block or shot outside the offensive zone ≤ 4 s
  before), the play before the shot (type, team, time and distance), strength state, score
  state, off-wing (from shooter handedness), shooter position, period, home/away.
- **Model**: logistic regression (distance and angle as cubic splines, C = 0.1) with 1,238
  XGBoost trees fitted on its logit. Training seasons are weighted toward the season being
  scored (half-life 1 season, chosen on 2024-25 from none / 2 / 1) because the NHL's event
  recording changes season to season.
- **Explanation**: each shot's xG splits exactly into a baseline plus 12 feature-group
  contributions (LR terms + exact TreeSHAP), shown per player-season as "biggest reasons".
- **Validation**: train 2021-22 – 2023-24, select on 2024-25, test on 2025-26 against MoneyPuck's
  shot-level xGoal on the same 117,770 shots (99.6% of each side matched; goal labels agree 100%):

  | 2025-26 | Log loss | AUC | Brier | xG ÷ goals |
  |---|---|---|---|---|
  | League-average rate | 0.2484 | 0.500 | 0.0634 | 0.989 |
  | RosterIQ LR only | 0.2208 | 0.757 | 0.0597 | 1.055 |
  | **RosterIQ xG** | **0.2141** | **0.778** | **0.0581** | 1.049 |
  | MoneyPuck xGoal | 0.2168 | 0.769 | 0.0583 | 1.009 |

  Paired bootstrap over 1,394 games (RosterIQ − MoneyPuck, 95%): log loss −0.0026 [−0.0039,
  −0.0015], AUC +0.0084 [+0.0052, +0.0119]. MoneyPuck's published values may include this
  season in their fit. 2025-26 was examined once with an earlier version (which led to the
  rush redefinition and recency weighting), so it is not strictly untouched; 2026-27, scored
  nightly by the production model, is the first clean test.
- **Season totals are out-of-sample** (leave-one-season-out). xG ÷ goals by season: 0.991,
  1.022, 0.969, 0.979, 1.049. Correlation with MoneyPuck: team xGF 0.975–0.988, player ixG
  (≥ 5 ixG) 0.975–0.986.
- **Known limitations**: no pre-shot passing; no arena location correction; recording drift
  (rebounds 7.2% → 10.6% of attempts 2021-22 → 2025-26, attempts inside 10 ft 9.5% → 14.5%) is
  weighted for, not removed — total xG ran 4.9% above goals in 2025-26; rush attempts are
  over-predicted (0.049 vs 0.027 in 2025-26); empty-net attempts not modelled. Descriptive, not
  a forecast.
- **In season**: `rosteriq_models.xg.score` + `.github/workflows/nightly-xg.yml` score newly
  completed games nightly with the production model (never refitted in season) and run a
  Poisson drift check (|z| > 4 fails the run).
- **Status**: active. Reproduce: `analytics/README.md`.

## Model card: rosteriq-prospects-v1 — P(NHL regular) at the draft

- **Output**: probability a drafted skater plays 200+ NHL regular-season games in the seven
  seasons after the draft, from draft-time information only; plus the same probability from
  draft position alone ("from draft slot") for comparison, and a league equivalency (NHLe) table.
- **Inputs**: draft-year and prior-season production translated with RosterIQ NHLe (network
  estimate over 71,008 same-player league pairs with a development-by-age term; 204 leagues get
  a factor, e.g. KHL 0.59, SHL 0.51, AHL 0.43, NCAA 0.23, OHL 0.13, WHL 0.13, USHL 0.12),
  goals per game, games played, age at the draft, draft-time height/weight, position, league
  group. Not draft position. 4,747 of 4,751 player picks 2005–2026 linked to NHL ids (verified
  against the player's draft details); 4 unresolved, reported.
- **Model**: logistic regression (C = 0.03) with 367 XGBoost trees on its logit; same exact
  per-group explanation as xG.
- **Validation**: train on 2005–2013 drafts, select on 2014–2015, test on 2016–2019 (771 skaters,
  121 reached 200 games):

  | 2016–2019 drafts | Log loss | AUC | Brier |
  |---|---|---|---|
  | Base rate | 0.436 | 0.500 | 0.133 |
  | **Draft position only** | **0.285** | 0.888 | **0.084** |
  | RosterIQ stats (no draft position) | 0.334 | 0.844 | 0.100 |
  | RosterIQ stats + draft position | 0.289 | 0.892 | 0.087 |

  Paired bootstrap vs draft position (95%): stats only AUC −0.043 [−0.077, −0.009], log loss
  +0.049 [+0.025, +0.070] — worse; stats + draft position AUC +0.004 [−0.013, +0.022] — no
  detectable gain. After round 1: +0.012 [−0.030, +0.060], also inconclusive.
- **Use**: explain a production profile and flag disagreement with the draft slot (a 10-point
  gap is marked), not rank players. Historical projections are leave-one-draft-out; drafts
  2020–2026 have no outcome yet.
- **Known limitations**: thin inputs (no ice time, role, competition, or scouting); outcome
  depends on opportunity (shortened 2019-20 / 2020-21, 84-game schedule from 2026-27); NHLe
  from non-random movers and league-level only; goalies not modelled.
- **Status**: active. Next: benchmark pre-draft against NHL Central Scouting final ranks.

## Surplus value

`surplus = performanceValue − capHit` — see CALCULATIONS.md. Stored per player/season/model in
`surplus_value_records`.

## Roadmap for models

Regression-based market model with backtesting on licensed data, arbitration-award estimator,
qualifying-offer calculator, aging curves, Monte Carlo availability, and the NIL estimator —
all behind the same versioning/governance rules above.
