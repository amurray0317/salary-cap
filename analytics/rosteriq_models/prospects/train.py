"""Train and evaluate the prospect model; export league factors and
per-player projections.

    python -m rosteriq_models.prospects.train \
        --drafts 2005-2025 --train 2005-2013 --valid 2014-2015 --test 2016-2019

Steps
  1. NHLe league factors from every cached career (network estimate).
  2. One row per drafted skater (dataset.build).
  3. Selection on --train/--valid; test on --test drafts (never seen).
     Compared with a draft-position-only model: does the stats read add
     information beyond where teams picked?
  4. Every labelled draft is scored by a model trained on the OTHER labelled
     drafts (leave-one-draft-out), so historical projections are
     out-of-sample. Unlabelled (recent) drafts are scored by a model trained
     on all labelled drafts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score

from rosteriq_models import explainable as ex
from rosteriq_models.prospects import dataset, nhle
from rosteriq_models.prospects.careers import load_careers, load_picks, season_id
from rosteriq_models.prospects.model import GROUPS_STATS, MODEL_VERSION, recipe
from rosteriq_models.raw import OUT

LAST_COMPLETE_SEASON = 20252026


def years(spec: str) -> list[int]:
    a, b = (int(x) for x in spec.split("-"))
    return list(range(a, b + 1))


def scores(y, p) -> dict:
    y = np.asarray(y, int)
    return {
        "players": int(len(y)),
        "regulars": int(y.sum()),
        "expected": round(float(np.sum(p)), 1),
        "log_loss": round(ex.logloss(y, p), 5),
        "auc": round(float(roc_auc_score(y, p)), 4) if 0 < y.sum() < len(y) else None,
        "brier": round(float(brier_score_loss(y, p)), 5),
    }


def pick_only(train: pd.DataFrame):
    lr = LogisticRegression(C=1.0).fit(np.log(train[["overall_pick"]].clip(1, 300)), train["nhl_regular"])
    return lambda df: lr.predict_proba(np.log(df[["overall_pick"]].clip(1, 300)))[:, 1]


def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("drafts", "train", "valid", "test"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    all_years = years(a.drafts)
    tr_y, va_y, te_y = years(a.train), years(a.valid), years(a.test)

    picks = load_picks(all_years)
    link_report = picks.groupby("draft_year")["link_status"].value_counts().unstack(fill_value=0).to_dict(orient="index")
    ids = sorted({int(i) for i in picks["player_id"].dropna()})
    bio, lines = load_careers(ids)

    pairs = nhle.build_pairs(lines, bio)
    factors, nhle_report = nhle.estimate(pairs)
    fmap = dict(zip(factors["league"], factors["nhle_multiplier"]))

    data = dataset.build(picks, bio, lines, fmap, LAST_COMPLETE_SEASON)
    labelled = data[data["label_mature"]]
    by_year = lambda ys: labelled[labelled["draft_year"].isin(ys)].reset_index(drop=True)  # noqa: E731
    train, valid, test = by_year(tr_y), by_year(va_y), by_year(te_y)

    results = {}
    chosen = {}
    for variant, with_pick in (("stats", False), ("stats_pick", True)):
        rec = recipe(with_pick)
        _, log = ex.fit(rec, train, valid, C_grid=(0.03, 0.1, 0.3, 1.0), max_trees=2000)
        final = ex.refit(rec, pd.concat([train, valid], ignore_index=True), log["chosen_C"], log["gbm_trees"])
        chosen[variant] = (log["chosen_C"], log["gbm_trees"])
        p = final.predict(test)
        results[variant] = {"selection": log, "test": scores(test["nhl_regular"], p), "test_lr_only": scores(test["nhl_regular"], final.lr_predict(test))}
        late = test["round"] >= 2
        results[variant]["test_rounds_2_plus"] = scores(test.loc[late, "nhl_regular"], p[late.to_numpy()])
    base_rate = float(pd.concat([train, valid])["nhl_regular"].mean())
    po = pick_only(pd.concat([train, valid]))
    pp = po(test)
    late = (test["round"] >= 2).to_numpy()
    results["baselines"] = {
        "constant_rate": scores(test["nhl_regular"], np.full(len(test), base_rate)),
        "draft_position_only": scores(test["nhl_regular"], pp),
        "draft_position_only_rounds_2_plus": scores(test.loc[late, "nhl_regular"], pp[late]),
    }
    print(json.dumps({k: v.get("test", v) for k, v in results.items()}, indent=1))

    # Leave-one-draft-out projections for labelled drafts; final model for the rest.
    C, n_trees = chosen["stats"]
    rec = recipe(False)
    parts = []
    lab_years = sorted(labelled["draft_year"].unique())
    for y in lab_years:
        mdl = ex.refit(rec, labelled[labelled["draft_year"] != y].reset_index(drop=True), C, n_trees)
        rows = labelled[labelled["draft_year"] == y].reset_index(drop=True)
        e = ex.explain(mdl, rows)
        parts.append(pd.concat([rows, e.add_prefix("contrib_")], axis=1).assign(projection="out_of_sample_leave_one_draft_out"))
    prod = ex.refit(rec, labelled.reset_index(drop=True), C, n_trees)
    recent = data[~data["label_mature"]].reset_index(drop=True)
    if len(recent):
        e = ex.explain(prod, recent)
        parts.append(pd.concat([recent, e.add_prefix("contrib_")], axis=1).assign(projection="final_model_unlabelled_draft"))
    proj = pd.concat(parts, ignore_index=True).rename(columns={"contrib_p": "p_nhl_regular", "contrib_baseline_p": "baseline_p"})

    out = OUT / "prospects" / MODEL_VERSION
    out.mkdir(parents=True, exist_ok=True)
    factors.to_csv(out / "league_factors.csv", index=False)
    keep = [
        "draft_year", "overall_pick", "round", "player_id", "name", "pos", "drafted_by", "amateur_league", "amateur_club",
        "birth_date", "age_at_draft", "draft_height_in", "draft_weight_lb",
        "d0_main_league", "d0_league_group", "d0_gp", "d0_points", "d0_ppg", "d0_nhle_ppg", "d0_known_share",
        "dm1_main_league", "dm1_gp", "dm1_points", "dm1_nhle_ppg",
        "p_nhl_regular", "baseline_p", *[f"contrib_{g}" for g in GROUPS_STATS],
        "label_mature", "nhl_regular", "nhl_gp_7", "nhl_gp_to_date", "projection",
    ]
    proj[keep].to_csv(out / "prospects.csv", index=False)
    meta = {
        "version": MODEL_VERSION,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "outcome": f">= {dataset.REGULAR_GP} NHL regular-season games in the {dataset.OUTCOME_SEASONS} seasons after the draft",
        "last_complete_season": LAST_COMPLETE_SEASON,
        "drafts": {"all": all_years, "train": tr_y, "valid": va_y, "test": te_y, "labelled": [int(y) for y in lab_years]},
        "chosen": {k: {"C": v[0], "gbm_trees": v[1]} for k, v in chosen.items()},
        "links": {str(k): v for k, v in link_report.items()},
        "skaters": int(len(data)),
        "labelled_skaters": int(len(labelled)),
        "base_rate": round(base_rate, 4),
        "nhle": nhle_report,
        "results": results,
        "source": "NHL draft picks, player search and player landing pages (api-web.nhle.com, search.d3.nhle.com)",
    }
    ex.save(prod, out / "production", meta)
    (out / "metrics.json").write_text(json.dumps(meta, indent=1, default=str))
    print("wrote", out)


if __name__ == "__main__":
    main()
