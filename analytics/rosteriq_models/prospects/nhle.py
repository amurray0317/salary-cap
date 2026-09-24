"""League equivalency (NHLe) estimated as a network from the same players
scoring in two leagues.

For every player with at least MIN_GP games in league A in season t and
league B in season t+1 (or in both leagues in the same season):

    log(PPG_B) - log(PPG_A) = f_B - f_A + g(age) + noise

  * f_L is how much easier it is to score in league L than in the NHL
    (f_NHL = 0), so a league's NHLe multiplier is exp(-f_L).
  * g(age) is one year's development at that age (consecutive-season pairs
    only), estimated jointly so improvement is not mistaken for an easier
    league. Same-season pairs carry no development term.
  * PPG uses (points + 0.5) / GP so scoreless seasons stay usable.
  * Weighted least squares with weight 1 / (1/GP_A + 1/GP_B).

Leagues are only estimated if they connect to the NHL through the pair
network and have at least MIN_PAIRS pairs. Every other league has no factor
and the player row says so; nothing is guessed.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

import numpy as np
import pandas as pd

from rosteriq_models.prospects.careers import age_on

MIN_GP = 10
MIN_PAIRS = 30
REF = "NHL"
AGE_MIN, AGE_MAX = 17, 26
RIDGE = 1e-3


def _age_mid(birth: str | None, season: int) -> float | None:
    return age_on(birth, dt.date(season % 10000, 1, 1))


def build_pairs(lines: pd.DataFrame, bio: pd.DataFrame) -> pd.DataFrame:
    births = dict(zip(bio["player_id"], bio["birth_date"]))
    ok = lines[lines["gp"] >= MIN_GP]
    by = defaultdict(lambda: defaultdict(list))
    for r in ok.itertuples(index=False):
        by[r.player_id][r.season].append((r.league, r.gp, r.points))
    rows = []
    for pid, seasons in by.items():
        for season, entries in seasons.items():
            nxt = season + 10001
            age = _age_mid(births.get(pid), season)
            # Consecutive seasons (includes staying in the same league).
            for a in entries:
                for b in seasons.get(nxt, []):
                    rows.append((pid, season, a, b, age, True))
            # Same season, two leagues.
            for i, a in enumerate(entries):
                for b in entries[i + 1:]:
                    rows.append((pid, season, a, b, None, False))
    out = pd.DataFrame(
        [
            {
                "player_id": pid, "season": s, "league_a": a[0], "gp_a": a[1], "pts_a": a[2],
                "league_b": b[0], "gp_b": b[1], "pts_b": b[2], "age": age, "consecutive": cons,
            }
            for pid, s, a, b, age, cons in rows
        ]
    )
    out["y"] = np.log((out["pts_b"] + 0.5) / out["gp_b"]) - np.log((out["pts_a"] + 0.5) / out["gp_a"])
    out["w"] = 1.0 / (1.0 / out["gp_a"] + 1.0 / out["gp_b"])
    # Development pairs need an age; drop only those (counted in the report).
    return out[~(out["consecutive"] & out["age"].isna())].reset_index(drop=True)


def _connected_to_ref(pairs: pd.DataFrame, leagues: set[str]) -> set[str]:
    adj = defaultdict(set)
    for a, b in zip(pairs["league_a"], pairs["league_b"]):
        if a != b and a in leagues and b in leagues:
            adj[a].add(b)
            adj[b].add(a)
    seen, stack = {REF}, [REF]
    while stack:
        for n in adj[stack.pop()]:
            if n not in seen:
                seen.add(n)
                stack.append(n)
    return seen


def estimate(pairs: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    counts = pd.concat([pairs["league_a"], pairs["league_b"]]).value_counts()
    eligible = set(counts[counts >= MIN_PAIRS].index) | {REF}
    leagues = sorted(_connected_to_ref(pairs, eligible) - {REF})
    use = pairs[pairs["league_a"].isin(leagues + [REF]) & pairs["league_b"].isin(leagues + [REF])].reset_index(drop=True)
    idx = {lg: i for i, lg in enumerate(leagues)}
    ages = list(range(AGE_MIN, AGE_MAX + 1))
    n_f, n_g = len(leagues), len(ages)
    X = np.zeros((len(use), n_f + n_g))
    for r, (a, b) in enumerate(zip(use["league_a"], use["league_b"])):
        if b in idx:
            X[r, idx[b]] += 1
        if a in idx:
            X[r, idx[a]] -= 1
    cons = use["consecutive"].to_numpy()
    age_bucket = np.clip(np.floor(use["age"].fillna(0).to_numpy()), AGE_MIN, AGE_MAX).astype(int) - AGE_MIN
    X[np.where(cons)[0], n_f + age_bucket[cons]] = 1
    w = use["w"].to_numpy()
    y = use["y"].to_numpy()
    XtW = X.T * w
    A = XtW @ X + RIDGE * np.eye(X.shape[1])
    beta = np.linalg.solve(A, XtW @ y)
    resid = y - X @ beta
    sigma2 = float((w * resid**2).sum() / max(len(y) - X.shape[1], 1))
    Ainv = np.linalg.inv(A)
    se = np.sqrt(np.clip(np.diag(Ainv @ (XtW @ X) @ Ainv) * sigma2, 0, None))
    pair_counts = counts.reindex(leagues).fillna(0).astype(int)
    table = pd.DataFrame({
        "league": leagues,
        "f": beta[:n_f],
        "se": se[:n_f],
        "pairs": pair_counts.to_numpy(),
    })
    table["nhle_multiplier"] = np.exp(-table["f"])
    table = pd.concat([pd.DataFrame([{"league": REF, "f": 0.0, "se": 0.0, "pairs": int(counts.get(REF, 0)), "nhle_multiplier": 1.0}]), table], ignore_index=True)
    # Same-league consecutive seasons are what separate development from
    # league difficulty; report how many support each age's growth term.
    same = use[use["consecutive"] & (use["league_a"] == use["league_b"])]
    same_counts = np.clip(np.floor(same["age"].to_numpy()), AGE_MIN, AGE_MAX).astype(int)
    growth = pd.DataFrame({
        "age": ages,
        "one_year_log_ppg_change": beta[n_f:],
        "se": se[n_f:],
        "same_league_pairs": [int((same_counts == a).sum()) for a in ages],
    })
    report = {
        "pairs_total": int(len(pairs)),
        "pairs_used": int(len(use)),
        "leagues_seen": int(counts.size),
        "leagues_estimated": int(len(leagues)) + 1,
        "leagues_without_factor": sorted(set(counts.index) - set(leagues) - {REF}),
        # Typical size of one pair's miss, in log points-per-game (unweighted).
        "residual_rms_log_ppg": round(float(np.sqrt(np.mean(resid**2))), 4),
        "growth_by_age": growth.round(4).to_dict(orient="records"),
    }
    return table.sort_values("nhle_multiplier", ascending=False).reset_index(drop=True), report
