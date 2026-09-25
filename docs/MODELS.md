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
- **Before the draft (vs NHL Central Scouting final rank, 2016–2019 drafts, same players, trained on
  2008–2015)**: Central Scouting only — log loss 0.314, AUC 0.856; stats only — 0.333, 0.844;
  stats + Central Scouting (stats logit out-of-fold) — **0.303, 0.870**. Paired bootstrap vs
  Central Scouting only: AUC +0.014 [+0.002, +0.028], log loss −0.011 [−0.020, −0.003]; after
  round 1 AUC +0.035 [+0.004, +0.068], log loss −0.008 [−0.016, −0.001]. So the stats add
  information to the pre-draft consensus (not to where teams actually pick). Rankings linked by
  name + exact birth date (1,831 full name, 100 last name, 18 reviewed transliterations, 2
  ambiguous left unlinked). Caveats: drafted players only (ranked players who went undrafted
  have no outcome here); one four-draft window. Reproduce: `rosteriq_models.prospects.css`.
- **v2 research (`rosteriq_models.prospects.v2`, results in the card under `v2_research`; not
  yet used for the projections)**:
  - *Scaled regular bar*: 200 games of a normal 574-game window, scaled to games scheduled
    (187–196 in windows with 2012-13, 2019-20 or 2020-21); 23 labels change; 2016–2019 test
    drafts: 128 regulars.
  - *Tier 2, top of lineup*: a regular with 2+ seasons in D+1..D+7 as a top-6 forward / top-4
    defenceman by TOI per game (league-wide rank <= teams x slots, among skaters with half the
    season's games; cut-offs about 15.5 and 18.7 min every season). P(top) = P(regular) x
    P(top | regular). Top-5 picks: 93% regular, 80% top of lineup; picks 6–10: 83% vs 61%.
  - *Before the draft, 2016–2019 drafts (771 skaters; 128 regulars, 73 top of lineup)*, paired
    bootstrap 95%:

    | Comparison | Regular: AUC | Regular: log loss | Top: AUC | Top: log loss |
    |---|---|---|---|---|
    | Stats + midterm vs midterm only (January) | +0.026 [+0.008, +0.046] | −0.018 [−0.028, −0.008] | +0.021 [−0.001, +0.048] | −0.010 [−0.020, −0.000] |
    | … after round 1 | +0.062 [+0.024, +0.105] | −0.014 [−0.023, −0.006] | +0.057 [−0.000, +0.126] | −0.008 [−0.017, −0.000] |
    | Stats + final vs final only (April) | +0.017 [+0.002, +0.034] | −0.013 [−0.022, −0.004] | +0.009 [−0.010, +0.030] | −0.005 [−0.014, +0.005] |
    | … after round 1 | +0.048 [+0.017, +0.089] | −0.009 [−0.017, −0.002] | +0.026 [−0.025, +0.080] | −0.005 [−0.012, +0.003] |
    | Stats only vs draft position | −0.046 [−0.082, −0.009] | +0.049 [+0.026, +0.071] | −0.046 [−0.092, +0.001] | +0.030 [+0.009, +0.051] |

    The stats add most to the midterm list (the January decision point); for top-of-lineup
    players the direction is the same but intervals reach zero (73 events).
  - *Population*: all 4,142 skaters Central Scouting ranked 2008–2019 (first ranked year),
    linked to NHL ids by name + exact birth date (99.3% of known-drafted rows found; 15
    nickname spellings filled from the draft records); unlinked = never drafted or signed =
    no NHL games. 2,147 were never drafted; 3 became regulars (Dillon, Sustr, Vatrano).
    Central Scouting inputs only (draft-year stats do not exist in the NHL feed for undrafted
    players): trained on drafted players only, the model predicts 181.6 regulars for the
    2016–2019 ranked lists vs 125 actual (log loss 0.209); trained on everyone ranked, 147.3
    (0.195). Live pre-draft scoring therefore trains on the whole ranked population.
  - *Junior draft-year production for the whole ranked population* (HockeyTech: OHL, WHL,
    QMJHL, USHL, 2003-04 on; drafted or not; matched by name + exact birth date): 95.6% of
    ranked players listed in those leagues matched (1,114 of 1,165); 1,954 players, 843 not
    drafted that year. Features: draft-year PPG, even-strength and PP PPG, goals, shots (not
    reported by the WHL), share of team goals, D-1 PPG, league. Two fixes were needed before
    the result meant anything: QMJHL rosters store names "Last, First" (no QMJHL player
    matched; 77.9% overall), and junior scoring rose between classes (draft-year PPG 0.611 in
    2008–15, 0.646 in 2016–19), which made raw rates over-predict newer classes (log loss
    +0.045 [+0.026, +0.067] vs Central Scouting alone). With rates divided by the league-season
    mean, 2016–2019 test (paired bootstrap 95%, vs Central Scouting inputs alone):

    | Comparison | Regular: AUC | Regular: log loss | Top: AUC | Top: log loss |
    |---|---|---|---|---|
    | + junior stats vs midterm only | +0.013 [−0.006, +0.033] | −0.006 [−0.021, +0.013] | +0.023 [−0.001, +0.057] | −0.004 [−0.022, +0.012] |
    | + junior stats vs final only | −0.002 [−0.020, +0.013] | +0.001 [−0.013, +0.015] | +0.007 [−0.021, +0.031] | +0.001 [−0.015, +0.018] |

    Neutral against the final list and positive in direction against the midterm list, with
    no interval clear of zero: not yet worth adding to live scoring. Both models still expect
    about 20% more regulars than the 2016–2019 classes produced (e.g. 94.3 and 99.0 vs 76).
  - *Calibration*: the 2016–2019 drafts produced about 10–15% fewer regulars than every model
    expected, draft position included, even after scaling for shortened seasons. After round 1
    the stats model over-predicts in almost every draft year (a selected group: teams passed on
    those players for reasons the stats cannot see).
- **Use**: explain a production profile and flag disagreement with the draft slot (a 10-point
  gap is marked), not rank players. Historical projections are leave-one-draft-out; drafts
  2020–2026 have no outcome yet.
- **Known limitations**: thin inputs (no ice time, role, competition, or scouting); outcome
  depends on opportunity (shortened 2019-20 / 2020-21, 84-game schedule from 2026-27); NHLe
  from non-random movers and league-level only; goalies not modelled.
- **Status**: active. Next: 2027 pre-draft scoring (Central Scouting list + season-to-date rates).

## Model card: rosteriq-games-v0 — Win drivers and pre-game win probability

- **Question**: which stats go with winning inside a game (descriptive), and what, known
  before puck drop, predicts the winner (predictive). Target: home team wins, OT and shootout
  included (the moneyline result); regular season.
- **Data**: NHL play-by-play 2021-22 to 2025-26 (6,560 games) + RosterIQ xG v1. Game tables
  reconciled exactly to the NHL's 2025-26 totals (goals 8,086 excluding shootouts, 5v5 goals
  5,362, power-play goals 1,565, empty-net goals 508, points 2,950, 119 shootouts).
- **Descriptive** (leader of the stat in that game won): more power-play goals 71.3%, scored
  first 67.1%, more 5v5 xG 61.8%, more xG 60.1%, more shots on goal 55.1%, more faceoffs 52.0%,
  more hits 43.5%, more blocked shots 41.2% (score effects: trailing teams hit and get blocked).
- **Predictive** (walk-forward: each of 2022-23 to 2025-26 predicted by a model trained on
  earlier seasons only; 5,248 games; season-to-date rates shrunk to a prior worth 10 games):
  log loss home ice 0.6906, points % 0.6748, Elo 0.6704, **compact 0.6646** (5v5 xG share,
  starting goalie's saves above expected, special teams, points %, rest, back-to-back; chosen
  before testing), every feature 0.6659. Compact vs Elo −0.006 [−0.010, −0.002]; vs points %
  −0.010 [−0.014, −0.006]. Picks 58.8% of winners (published ceiling ≈ 62%). Best single input:
  5v5 xG share; save % adds nothing; goalie and rest effects small. Slightly overconfident at
  the extremes (calibration table in the card and the app).
- **Live (2026-27)**: probabilities frozen at 10:00 UTC with the expected starter (checked on 56
  games of 2025-26: identical to the backtest when the guess is right, mean |diff| 0.009) and
  scored after each final against home ice and Elo.
- **Limits**: no odds, so no closing-line-value test (the real test for betting use); xG is
  in-sample for the shot model; travel and injuries not modelled.

## Model card: rosteriq-war-v0 — Wins above replacement

- **Method**: stints from NHL shift charts (skater and goalie on-ice sets; strength agrees
  with play-by-play on 99.0–99.1% of shots); weighted ridge RAPM on xG per 60 at 5v5 (home ice
  and score state as covariates; penalty by grouped 5-fold CV) and at 5v4 (power play vs
  penalty kill); penalties drawn − taken × the net goal value of a power play (0.139 goals in
  2025-26); finishing = goals − individual xG; goalies = xG faced − goals. Replacement level:
  players outside each team's top 13 F / 7 D by ice time (goalies outside the top 64 by xG
  faced). Goals per win 6.11 (team records 2021-22 to 2025-26).
- **Seasons**: 2024-25 (1,255 of 1,312 games; the NHL did not publish shift charts for 57) and
  2025-26 (all 1,312). 2021-22 to 2023-24 follow once their shift charts are processed.
- **Reliability**: split-half (odd/even games) 5v5 offence 0.73, defence 0.53 (Spearman-Brown);
  2024-25 → 2025-26 for 488 skaters with 500+ 5v5 minutes both years: offence 0.58, defence
  0.36, power play 0.47, WAR 0.49. Goalie saves above expected per xG repeat at 0.07 (47 goalies).
- **Face validity (2025-26)**: MacKinnon 4.0, Caufield 3.7, Kucherov 3.6, Robertson, McDavid,
  Celebrini 3.3; defence led by Werenski.
- **Differences from Evolving-Hockey (the public reference; paywalled, not compared
  number-for-number)**: xG rather than goals as the RAPM target, no box-score (SPM) stage, no
  zone-start or prior-season priors, so totals run smaller. Goalie WAR depends heavily on the
  replacement level (−8.6% of xG faced in 2025-26).

## Surplus value

`surplus = performanceValue − capHit` — see CALCULATIONS.md. Stored per player/season/model in
`surplus_value_records`.

## Roadmap for models

Regression-based market model with backtesting on licensed data, arbitration-award estimator,
qualifying-offer calculator, aging curves, Monte Carlo availability, and the NIL estimator —
all behind the same versioning/governance rules above.
