"""Prospect model family: P(NHL regular) from what was known at the draft,
using the shared explainable LR + boosted-trees classifier.

Two variants:
  * "stats": production, age, size, position, league — no draft position.
    This is the independent read, usable before a player is drafted.
  * "stats_pick": the same plus log(overall pick), to test whether the
    stats add information beyond where teams actually picked the player.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from rosteriq_models import explainable as ex

MODEL_VERSION = "rosteriq-prospects-v1"

GROUPS_STATS = {
    "d0_scoring": "Draft-year scoring (NHLe)",
    "dm1_scoring": "Scoring the year before",
    "age": "Age at draft",
    "size": "Size",
    "position": "Position",
    "league": "Draft-year league",
    "games": "Games played",
}
GROUPS_PICK = {**GROUPS_STATS, "pick": "Draft position"}

SPLINE_COLS = {"d0_nhle_ppg": 5, "age_at_draft": 4}
GBM_PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "max_depth": 2,
    "eta": 0.02,
    "min_child_weight": 20,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "lambda": 10.0,
    "tree_method": "hist",
    "seed": 20260924,
}
MIN_GROUP_COUNT = 40


def _design(df: pd.DataFrame, league_levels: list[str], with_pick: bool) -> tuple[pd.DataFrame, dict[str, str]]:
    X = pd.DataFrame(index=df.index)
    group: dict[str, str] = {}

    def add(name, values, g):
        X[name] = np.asarray(values, dtype=float)
        group[name] = g

    for tag, g in (("d0", "d0_scoring"), ("dm1", "dm1_scoring")):
        v = df[f"{tag}_nhle_ppg"]
        add(f"{tag}_nhle_ppg", v.fillna(0).clip(0, 1.5), g)
        add(f"{tag}_nhle_missing", v.isna(), g)
        add(f"{tag}_gpg", df[f"{tag}_gpg"].fillna(0).clip(0, 3), g)
    add("age_at_draft", df["age_at_draft"].fillna(df["age_at_draft"].median()).clip(17.5, 21.5), "age")
    add("age_missing", df["age_at_draft"].isna(), "age")
    add("height_in", df["draft_height_in"].fillna(73).clip(64, 80), "size")
    add("weight_lb", df["draft_weight_lb"].fillna(195).clip(150, 260), "size")
    add("size_missing", df["draft_height_in"].isna() | df["draft_weight_lb"].isna(), "size")
    add("is_defence", df["pos"] == "D", "position")
    lg = df["d0_league_group"].where(df["d0_league_group"].isin(league_levels), "other")
    for lvl in league_levels + ["other"]:
        add(f"league_{lvl}", lg == lvl, "league")
    add("d0_gp", df["d0_gp"].fillna(0).clip(0, 90), "games")
    add("dm1_gp", df["dm1_gp"].fillna(0).clip(0, 90), "games")
    if with_pick:
        add("log_pick", np.log(df["overall_pick"].clip(1, 300)), "pick")
    return X, group


def recipe(with_pick: bool) -> ex.Recipe:
    def make_design(train: pd.DataFrame):
        vc = train["d0_league_group"].value_counts()
        levels = sorted(vc[vc >= MIN_GROUP_COUNT].index.tolist())
        return (lambda df: _design(df, levels, with_pick)), {"league_levels": levels, "with_pick": with_pick}

    groups = GROUPS_PICK if with_pick else GROUPS_STATS
    return ex.Recipe(make_design, list(groups), SPLINE_COLS, GBM_PARAMS, label="nhl_regular")
