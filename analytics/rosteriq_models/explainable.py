"""Explainable binary classifier shared by the xG and prospect models.

  logit(p) = LR(x) + GBM(x)

  * LR: L2-regularised logistic regression. Chosen numeric columns enter as
    cubic B-splines; everything else enters linearly or as 0/1 indicators.
    Inputs are standardised.
  * GBM: XGBoost trees trained with the LR logit as `base_margin`, so the
    trees only learn what the LR misses (interactions, sharper shapes).

Every prediction splits EXACTLY into a baseline plus one contribution per
feature group:
  * LR part: beta_j * z_j, where z_j is centred on the training mean.
  * GBM part: exact TreeSHAP values from XGBoost (pred_contribs).
`explain` turns logit contributions into probability units using the
secant of the logistic between the baseline and the prediction, so the
per-group values add up exactly to (p - baseline p).
"""
from __future__ import annotations

import json
import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import SplineTransformer

Design = Callable[[pd.DataFrame], tuple[pd.DataFrame, dict[str, str]]]


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def logloss(y, p) -> float:
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


@dataclass
class LRBase:
    splines: dict[str, SplineTransformer]
    groups: dict[str, str]
    mean: np.ndarray
    scale: np.ndarray
    lr: LogisticRegression

    def transform(self, X: pd.DataFrame) -> tuple[np.ndarray, list[str], list[str]]:
        blocks, names, groups = [], [], []
        for col in X.columns:
            if col in self.splines:
                b = self.splines[col].transform(X[[col]].to_numpy())
                blocks.append(b)
                names += [f"{col}_s{i}" for i in range(b.shape[1])]
                groups += [self.groups[col]] * b.shape[1]
            else:
                blocks.append(X[[col]].to_numpy())
                names.append(col)
                groups.append(self.groups[col])
        return np.hstack(blocks), names, groups

    def z(self, X: pd.DataFrame) -> np.ndarray:
        Z, _, _ = self.transform(X)
        return (Z - self.mean) / self.scale

    def logit(self, X: pd.DataFrame) -> np.ndarray:
        return self.lr.decision_function(self.z(X))


def fit_lr(X: pd.DataFrame, y: np.ndarray, groups: dict[str, str], C: float, spline_cols: dict[str, int], w: np.ndarray | None = None) -> LRBase:
    splines = {
        c: SplineTransformer(n_knots=k, degree=3, knots="quantile", extrapolation="linear").fit(X[[c]].to_numpy())
        for c, k in spline_cols.items()
        if c in X.columns
    }
    base = LRBase(splines, groups, np.zeros(1), np.ones(1), LogisticRegression())
    Z, _, _ = base.transform(X)
    base.mean = Z.mean(axis=0)
    scale = Z.std(axis=0)
    base.scale = np.where(scale > 1e-12, scale, 1.0)
    base.lr = LogisticRegression(C=C, max_iter=5000, solver="lbfgs").fit((Z - base.mean) / base.scale, y, sample_weight=w)
    return base


@dataclass
class ExplainableModel:
    design: Design
    group_names: list[str]
    lr: LRBase
    booster: xgb.Booster | None
    n_trees: int
    design_info: dict

    def matrices(self, df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
        X, _ = self.design(df)
        return X, self.lr.logit(X)

    def logit(self, df: pd.DataFrame) -> np.ndarray:
        X, base = self.matrices(df)
        if self.booster is None or self.n_trees == 0:
            return base
        return self.booster.predict(xgb.DMatrix(X, base_margin=base), output_margin=True, iteration_range=(0, self.n_trees))

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        return sigmoid(self.logit(df))

    def lr_predict(self, df: pd.DataFrame) -> np.ndarray:
        return sigmoid(self.matrices(df)[1])


@dataclass
class Recipe:
    """Everything that defines a model family."""

    make_design: Callable[[pd.DataFrame], tuple[Design, dict]]  # fitted on training rows
    group_names: list[str]
    spline_cols: dict[str, int]
    gbm_params: dict
    label: str
    # Optional per-row training weights (e.g. recency); None = equal weights.
    weight: Callable[[pd.DataFrame], np.ndarray] | None = None


def fit(recipe: Recipe, train: pd.DataFrame, valid: pd.DataFrame, C_grid=(0.01, 0.1, 1.0), max_trees=3000) -> tuple[ExplainableModel, dict]:
    """Chooses C and the number of trees on `valid`."""
    design, info = recipe.make_design(train)
    Xtr, groups = design(train)
    Xva, _ = design(valid)
    ytr, yva = train[recipe.label].to_numpy(int), valid[recipe.label].to_numpy(int)
    wtr = recipe.weight(train) if recipe.weight else None
    log: dict = {"lr_C": {}}
    best = None
    for C in C_grid:
        lr = fit_lr(Xtr, ytr, groups, C, recipe.spline_cols, wtr)
        ll = logloss(yva, sigmoid(lr.logit(Xva)))
        log["lr_C"][str(C)] = round(ll, 6)
        if best is None or ll < best[0]:
            best = (ll, C, lr)
    lr_ll, C, lr = best
    log["chosen_C"] = C
    dtr = xgb.DMatrix(Xtr, label=ytr, base_margin=lr.logit(Xtr), weight=wtr)
    dva = xgb.DMatrix(Xva, label=yva, base_margin=lr.logit(Xva))
    booster = xgb.train(recipe.gbm_params, dtr, num_boost_round=max_trees, evals=[(dva, "valid")], early_stopping_rounds=100, verbose_eval=False)
    n_trees = int(booster.best_iteration) + 1
    # Keep the trees only if they actually improve on the LR on validation.
    gbm_ll = float(booster.best_score)
    if gbm_ll >= lr_ll:
        n_trees = 0
    log.update(gbm_trees=n_trees, gbm_valid_logloss=round(gbm_ll, 6), lr_valid_logloss=round(lr_ll, 6))
    return ExplainableModel(design, recipe.group_names, lr, booster, n_trees, info), log


def refit(recipe: Recipe, full: pd.DataFrame, C: float, n_trees: int) -> ExplainableModel:
    design, info = recipe.make_design(full)
    X, groups = design(full)
    y = full[recipe.label].to_numpy(int)
    w = recipe.weight(full) if recipe.weight else None
    lr = fit_lr(X, y, groups, C, recipe.spline_cols, w)
    booster = None
    if n_trees > 0:
        booster = xgb.train(recipe.gbm_params, xgb.DMatrix(X, label=y, base_margin=lr.logit(X), weight=w), num_boost_round=n_trees, verbose_eval=False)
    return ExplainableModel(design, recipe.group_names, lr, booster, n_trees, info)


def logit_contributions(model: ExplainableModel, df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """-> (baseline logit per row, logit contribution per group); rows sum exactly to the model logit."""
    X, base = model.matrices(df)
    Z = model.lr.z(X)
    _, _, zgroups = model.lr.transform(X.iloc[:1])
    out = pd.DataFrame(0.0, index=df.index, columns=model.group_names)
    lr_part = Z * model.lr.lr.coef_[0]
    for j, g in enumerate(zgroups):
        out[g] += lr_part[:, j]
    baseline = np.full(len(df), float(model.lr.lr.intercept_[0]))
    if model.booster is not None and model.n_trees > 0:
        contribs = model.booster.predict(xgb.DMatrix(X, base_margin=base), pred_contribs=True, iteration_range=(0, model.n_trees))
        # Last column is the bias, which includes the base_margin (the LR
        # logit decomposed above): keep only the trees' own expected value.
        baseline = baseline + (contribs[:, -1] - base)
        _, colgroups = model.design(df.iloc[:1])
        for j, col in enumerate(X.columns):
            out[colgroups[col]] += contribs[:, j]
    return baseline, out


def explain(model: ExplainableModel, df: pd.DataFrame) -> pd.DataFrame:
    """Per-row contributions in probability units; group columns sum exactly to p - baseline_p."""
    baseline, contrib = logit_contributions(model, df)
    total = baseline + contrib.sum(axis=1).to_numpy()
    delta = total - baseline
    p0, p1 = sigmoid(baseline), sigmoid(total)
    small = np.abs(delta) <= 1e-9
    slope = np.where(small, p0 * (1 - p0), (p1 - p0) / np.where(small, 1.0, delta))
    goals = contrib.mul(slope, axis=0)
    goals["baseline_p"] = p0
    goals["p"] = p1
    return goals


def save(model: ExplainableModel, folder: Path, meta: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    if model.booster is not None and model.n_trees > 0:
        model.booster.save_model(folder / "gbm.json")
    lr = {
        "intercept": float(model.lr.lr.intercept_[0]),
        "C": float(model.lr.lr.C),
        "coef": model.lr.lr.coef_[0].tolist(),
        "mean": model.lr.mean.tolist(),
        "scale": model.lr.scale.tolist(),
        "spline_knots": {c: s.bsplines_[0].t.tolist() for c, s in model.lr.splines.items()},
    }
    (folder / "lr.json").write_text(json.dumps(lr, indent=1))
    # The fitted LR (with its spline transformers) for exact re-use when
    # scoring new games. Only ever loaded from our own committed files.
    (folder / "lr.pkl").write_bytes(pickle.dumps(model.lr))
    (folder / "spec.json").write_text(json.dumps({"n_trees": model.n_trees, "design": model.design_info, **meta}, indent=1, default=str))


def load(folder: Path, make_design_from_info: Callable[[dict], Design], group_names: list[str]) -> ExplainableModel:
    """Rebuilds a saved model. `make_design_from_info` turns the saved design
    info (e.g. category levels) back into the design function."""
    spec = json.loads((folder / "spec.json").read_text())
    lr = pickle.loads((folder / "lr.pkl").read_bytes())
    n_trees = int(spec["n_trees"])
    booster = None
    if n_trees > 0:
        booster = xgb.Booster()
        booster.load_model(folder / "gbm.json")
    return ExplainableModel(make_design_from_info(spec["design"]), group_names, lr, booster, n_trees, spec["design"])
