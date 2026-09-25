# RosterIQ models (offline pipeline)

Two models, built here from public NHL data and imported into the app as
**season totals / per-player projections only**, through the same gated
import pipeline as every other data source (preview → approval → commit).

| Model | Question | Output in the app |
|---|---|---|
| `rosteriq-xg-v1` | How likely was this unblocked shot attempt to be a goal? | Skater ixG, goalie xGA/GSAx, team xGF/xGA per season, game type and situation, with per-feature breakdowns |
| `rosteriq-prospects-v1` | How likely is this drafted skater to play 200+ NHL regular-season games in the seven seasons after the draft? | One projection per drafted skater, per-feature breakdown, league equivalency (NHLe) table |

Both use the same model family (`rosteriq_models/explainable.py`):
a regularised **logistic regression** base with **gradient-boosted trees
(XGBoost) fitted on top of the LR logit**. Every prediction splits exactly
into a baseline plus one contribution per feature group (LR terms + exact
TreeSHAP values), then into probability / goal units that add up exactly.
The trees are kept only if they beat the LR alone on the validation data.

## Reproduce

```bash
# 1. Raw data (NHL API; cached gzip under .data/raw, safe to re-run)
npm run data:fetch -- --pbp 20252026,20242025,20232024,20222023,20212022 --draft 2005-2026 --rankings 2008-2026

# 2. Python environment (pinned)
python3 -m venv .venv && .venv/bin/pip install -r analytics/requirements.txt
cd analytics

# 3. MoneyPuck shot files — benchmark only, never a model input (Data: MoneyPuck.com)
../.venv/bin/python -m rosteriq_models.benchmark 2021 2022 2023 2024 2025

# 4. Train + evaluate
../.venv/bin/python -m rosteriq_models.xg.train \
    --train 20212022,20222023,20232024 --valid 20242025 --test 20252026
../.venv/bin/python -m rosteriq_models.prospects.train \
    --drafts 2005-2026 --train 2005-2013 --valid 2014-2015 --test 2016-2019

# 5. Uncertainty vs MoneyPuck (game-level bootstrap), written into the xG model card
../.venv/bin/python -m rosteriq_models.xg.bootstrap

# 6. Write import-ready files + model cards to models/<version>/ (committed)
../.venv/bin/python -m rosteriq_models.export

# 7. Benchmark the prospect model against NHL Central Scouting final ranks
#    (needs: npm run data:fetch -- --rankings 2008-2026); written into the committed card
../.venv/bin/python -m rosteriq_models.prospects.css --train 2008-2015 --test 2016-2019

# 8. Prospect model v2 research: tiers, the full ranked population, benchmarks
#    vs draft position and Central Scouting final + midterm ranks
#    (needs: npm run data:fetch -- --rank-links 2008-2019 --nhl-seasons 2005-2025)
../.venv/bin/python -m rosteriq_models.prospects.v2 --train 2005-2013 --valid 2014-2015 --test 2016-2019

# Before opening night: rehearse the nightly xG run on a completed season
# (writes to copies of the model files; models/ is untouched)
../.venv/bin/python -m rosteriq_models.xg.score --season 20252026 --rehearse /tmp/xg-rehearsal

# Tests
../.venv/bin/pytest -q tests
```

## Validation rules

* **xG**: our shot parse must match MoneyPuck's shot file on ≥ 99% of
  shots (joined on game, game-second, shooter and order within the second).
  2025-26: 99.56% of ours / 99.63% of MoneyPuck's, goal labels agree 100%.
  Headline accuracy is on 2025-26, a season no model selection touched,
  against MoneyPuck's `xGoal` on the same shots (`metrics.json`).
* **Season totals are out-of-sample**: each season is scored by a model
  trained on the other seasons. The 2025-26 totals come from the test model.
* **Prospects**: test drafts (2016–2019) are never used for fitting or
  selection. The model is compared with a draft-position-only model on the
  same players, overall and for picks after round 1. Historical projections
  are leave-one-draft-out.

## Known limits (also on the model cards in the app)

* xG has no pre-shot passing (the NHL feed does not record passes), which is
  the biggest gap for any public xG model. No correction for arena
  shot-location recording bias. Blocked shots are not modelled (same as
  MoneyPuck). Empty-net attempts are counted, not modelled.
* xG totals are **descriptive**: they measure the chances a player got, not
  what he will get.
* NHLe is estimated from players who changed leagues, who are not a random
  sample: players promoted after unusually good seasons make lower leagues
  look slightly harder than they are. League labels are as the NHL feed
  reports them (some leagues appear under more than one name over time).
* The prospect outcome counts NHL games, which also depend on
  opportunity (team depth, injuries, the shortened 2019-20 and 2020-21
  seasons), not only ability. Goalies are not modelled.
