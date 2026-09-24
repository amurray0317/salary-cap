"""RosterIQ xG model family: the shared explainable LR + boosted-trees
classifier (see rosteriq_models/explainable.py) with the xG features."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from rosteriq_models import explainable as ex
from rosteriq_models.explainable import logloss, sigmoid  # noqa: F401  (re-exported)
from rosteriq_models.xg.features import GROUPS, FeatureSpec, design

MODEL_VERSION = "rosteriq-xg-v1"
SPLINE_COLS = {"distance": 7, "angle": 6}
GBM_PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "max_depth": 4,
    "eta": 0.03,
    "min_child_weight": 50,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "lambda": 5.0,
    "tree_method": "hist",
    "seed": 20260924,
}


def _make_design(train: pd.DataFrame):
    spec = FeatureSpec.fit(train)
    return (lambda df: design(df, spec)), spec.to_dict()


def recency_weight(half_life: float | None, target_start: int):
    """Weight 0.5 ** (|season start − target season start| / half_life).

    The NHL feed's event recording changes from season to season (more
    rebounds, tips and close attempts logged each year, each converting less
    often), so the seasons nearest the one being scored describe its feed
    best. `target_start` is the start year of the season the model will
    score (the validation or test season, a left-out season, or the coming
    season for the production model)."""
    if half_life is None:
        return None

    def w(df: pd.DataFrame) -> np.ndarray:
        start = (df["season"] // 10000).to_numpy()
        return 0.5 ** (np.abs(start - target_start) / half_life)

    return w


def recipe(half_life: float | None = None, target_start: int = 0) -> ex.Recipe:
    # GBM_PARAMS is read at call time so tests can shrink it.
    return ex.Recipe(_make_design, list(GROUPS), SPLINE_COLS, GBM_PARAMS, label="goal", weight=recency_weight(half_life, target_start))


def fit(train, valid, C_grid=(0.01, 0.1, 1.0), max_trees=3000, half_life: float | None = None, target_start: int = 0):
    return ex.fit(recipe(half_life, target_start), train, valid, C_grid, max_trees)


def refit(full: pd.DataFrame, C: float, n_trees: int, half_life: float | None = None, target_start: int = 0) -> ex.ExplainableModel:
    return ex.refit(recipe(half_life, target_start), full, C, n_trees)


def logit_contributions(model: ex.ExplainableModel, df: pd.DataFrame):
    return ex.logit_contributions(model, df)


def explain(model: ex.ExplainableModel, df: pd.DataFrame) -> pd.DataFrame:
    """Per-shot contributions in goals; group columns sum exactly to xg - baseline_xg."""
    return ex.explain(model, df).rename(columns={"baseline_p": "baseline_xg", "p": "xg"})


def save(model: ex.ExplainableModel, folder: Path, meta: dict) -> None:
    ex.save(model, folder, {"version": MODEL_VERSION, **meta})


def load(folder: Path) -> ex.ExplainableModel:
    def from_info(info: dict):
        spec = FeatureSpec(**info)
        return lambda df: design(df, spec)

    return ex.load(folder, from_info, list(GROUPS))
