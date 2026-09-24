"""Uncertainty for the xG test comparison: RosterIQ vs MoneyPuck on the
test season, paired bootstrap resampling whole GAMES (shots within a game
are not independent). Writes the result into the model card.

    python -m rosteriq_models.xg.bootstrap            # uses .data/models/xg/<version>/metrics.json

Refits the test model from the recorded selection (same seasons, C, trees,
half-life) — deterministic given the seed in GBM_PARAMS.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from rosteriq_models.raw import OUT
from rosteriq_models.xg import model as m
from rosteriq_models.xg.features import modelled
from rosteriq_models.xg.train import join_moneypuck, load

B = 1000


def main() -> None:
    card_path = OUT / "xg" / m.MODEL_VERSION / "metrics.json"
    card = json.loads(card_path.read_text())
    sel = card["selection"]
    train_s = sel["train"] + [sel["valid"]]
    test_s = card["test_season"]
    mod = {}
    for s in train_s + [test_s]:
        df = load(s)[0]
        mod[s] = df[modelled(df)].reset_index(drop=True)
    model = m.refit(pd.concat([mod[s] for s in train_s], ignore_index=True), sel["chosen_C"], sel["gbm_trees"], sel["half_life"], test_s // 10000)
    t = mod[test_s].copy()
    t["xg"] = model.predict(t)
    j, _ = join_moneypuck(t, test_s)
    both = j[j["mp_xg"].notna() & (j["shotOnEmptyNet"] == 0)].reset_index(drop=True)
    y, ours, mp = both["goal"].to_numpy(int), both["xg"].to_numpy(), both["mp_xg"].to_numpy()

    def ll(p, idx):
        q = np.clip(p[idx], 1e-9, 1 - 1e-9)
        return -np.mean(y[idx] * np.log(q) + (1 - y[idx]) * np.log(1 - q))

    games = both.groupby("game_id").indices
    keys = list(games)
    rng = np.random.default_rng(20260924)
    d_ll, d_auc = [], []
    for _ in range(B):
        idx = np.concatenate([games[k] for k in rng.choice(keys, len(keys))])
        d_ll.append(ll(ours, idx) - ll(mp, idx))
        d_auc.append(roc_auc_score(y[idx], ours[idx]) - roc_auc_score(y[idx], mp[idx]))
    q = lambda x: [round(float(v), 5) for v in np.percentile(x, [2.5, 50, 97.5])]  # noqa: E731
    result = {
        "method": "paired bootstrap over games (RosterIQ − MoneyPuck), same shots",
        "resamples": B,
        "games": len(keys),
        "shots": int(len(y)),
        "log_loss_diff_ci95": q(d_ll),
        "auc_diff_ci95": q(d_auc),
        "rosteriq_log_loss_check": round(ll(ours, np.arange(len(y))), 5),
    }
    card["test"]["bootstrap_vs_moneypuck"] = result
    card_path.write_text(json.dumps(card, indent=1))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
