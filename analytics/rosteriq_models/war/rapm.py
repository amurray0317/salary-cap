"""Regularised adjusted plus-minus (RAPM) on stints.

Each stint gives two rows, one per team attacking: the attacking team's
skaters as offence columns, the defending team's skaters as defence
columns, the response = the attacking team's xG per 60 in that stint,
weighted by the stint's seconds. Covariates: home ice and the attacking
team's score state (trailing / leading; tied is the base), so a player is
not credited for the extra shots every team takes when behind.

A player's offence coefficient = change in his team's xG for per 60 when he
is on the ice; defence coefficient = change in xG against per 60 (lower is
better). Ridge penalty chosen by 5-fold cross-validation grouped by game.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold

ALPHAS = (250.0, 1000.0, 4000.0, 16000.0)


def score_states(st: pd.DataFrame) -> pd.DataFrame:
    """Home score minus away score at the start of each stint (goals from earlier stints of the game)."""
    st = st.sort_values(["game_id", "period", "start"]).copy()
    g = st.groupby("game_id")
    st["home_before"] = g["home_g"].cumsum() - st["home_g"]
    st["away_before"] = g["away_g"].cumsum() - st["away_g"]
    st["diff"] = st["home_before"] - st["away_before"]
    return st


def design(st: pd.DataFrame, offence_side: str = "both") -> tuple[sparse.csr_matrix, np.ndarray, np.ndarray, np.ndarray, list[int]]:
    """Rows = (stint, attacking side). Returns X, y (xG/60), w (seconds), groups (game), player ids."""
    players = sorted({p for col in ("home_sk", "away_sk") for t in st[col] for p in t})
    col = {p: i for i, p in enumerate(players)}
    P = len(players)
    rows, cols, vals, y, w, grp = [], [], [], [], [], []
    r = 0
    for s in st.itertuples():
        sides = []
        if offence_side in ("both", "home"):
            sides.append((s.home_sk, s.away_sk, s.home_xg, 1.0, s.diff))
        if offence_side in ("both", "away"):
            sides.append((s.away_sk, s.home_sk, s.away_xg, 0.0, -s.diff))
        for att, dfn, xg, home, diff in sides:
            for p in att:
                rows.append(r); cols.append(col[p]); vals.append(1.0)
            for p in dfn:
                rows.append(r); cols.append(P + col[p]); vals.append(1.0)
            # covariates: home, trailing, leading
            for j, v in enumerate((home, float(diff < 0), float(diff > 0))):
                if v:
                    rows.append(r); cols.append(2 * P + j); vals.append(v)
            y.append(xg * 3600.0 / s.dur)
            w.append(float(s.dur))
            grp.append(s.game_id)
            r += 1
    X = sparse.csr_matrix((vals, (rows, cols)), shape=(r, 2 * P + 3))
    return X, np.asarray(y), np.asarray(w), np.asarray(grp), players


def fit(X, y, w, groups, alphas=ALPHAS) -> tuple[Ridge, float, dict]:
    """Weighted ridge; alpha by grouped 5-fold CV on weighted squared error."""
    cv = {}
    for a in alphas:
        err = 0.0
        for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
            m = Ridge(alpha=a, solver="sparse_cg", max_iter=2000, tol=1e-6).fit(X[tr], y[tr], sample_weight=w[tr])
            err += float(np.sum(w[te] * (y[te] - m.predict(X[te])) ** 2))
        cv[a] = err / w.sum()
    best = min(cv, key=cv.get)
    model = Ridge(alpha=best, solver="sparse_cg", max_iter=4000, tol=1e-7).fit(X, y, sample_weight=w)
    return model, best, {str(k): round(v, 3) for k, v in cv.items()}


def coefficients(model: Ridge, players: list[int]) -> pd.DataFrame:
    P = len(players)
    c = model.coef_
    return pd.DataFrame({"player_id": players, "off": c[:P], "def": c[P : 2 * P]})


def toi(st: pd.DataFrame) -> pd.Series:
    """Seconds on the ice per player in these stints."""
    acc: dict[int, float] = {}
    for hs, as_, d in zip(st["home_sk"], st["away_sk"], st["dur"]):
        for p in (*hs, *as_):
            acc[p] = acc.get(p, 0.0) + d
    return pd.Series(acc, name="toi_s")
