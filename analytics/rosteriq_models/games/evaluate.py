"""Which metrics go with wins, and which ones predict them before puck drop.

    python -m rosteriq_models.games.evaluate 20212022 20222023 20232024 20242025 20252026

Two different questions, kept apart on purpose:

1. Descriptive ("win drivers"): in the game itself, how often does the team
   that won a stat win the game? Backward-looking: it explains results and
   cannot be bet on, because the stat is only known afterwards.

2. Predictive (pre-game): using only what is known before puck drop
   (season-to-date team rates, the goaltender, rest, home ice), how well
   can the home team's win probability be estimated? Walk-forward: each
   test season is predicted by a model trained on earlier seasons only.
   Baselines: home ice only, points percentage, and Elo.

Target: the home team wins, overtime and shootout included (the moneyline
outcome). Regular season only. Early-season rates are shrunk toward a prior
(previous season's value regressed halfway to the league mean) with a
weight of K_GAMES games, so a 3-0 start is not treated as a .1000 team.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from rosteriq_models.games.build import load

ROOT = Path(__file__).resolve().parents[3]
CARD_DIR = ROOT / "models" / "rosteriq-games-v0"
K_GAMES = 10  # prior weight, in games
GOALIE_K_XG = 30.0  # prior weight for goalie save rate, in expected goals faced (~1,000 shots)
REST_CAP = 4

# ---------------------------------------------------------------- descriptive

DESCRIPTIVE = [
    ("xgf", "xga", "More expected goals (all situations)"),
    ("xgf_5v5", "xga_5v5", "More 5v5 expected goals"),
    ("sog", "sog_against", "More shots on goal"),
    ("fenwick", "fenwick_against", "More unblocked shot attempts"),
    ("fo_won", "fo_lost", "Won more faceoffs"),
    ("hits", None, "More hits"),
    ("takeaways", None, "More takeaways"),
    ("giveaways", None, "Fewer giveaways"),
    ("blocks", None, "More blocked shots"),
    ("pp_goals", "pp_goals_against", "More power-play goals"),
    ("pen_drawn", "pen_taken", "Drew more penalties"),
]


def descriptive(tg: pd.DataFrame) -> list[dict]:
    """P(win | led the stat in that game), ties in the stat excluded."""
    g = tg[tg["game_type"] == 2]
    home = g[g["is_home"]].set_index("game_id")
    away = g[~g["is_home"]].set_index("game_id")
    away = away.loc[home.index]
    out = []
    for mine, theirs, label in DESCRIPTIVE:
        if theirs is None:
            a, b = home[mine].to_numpy(float), away[mine].to_numpy(float)
        else:
            a, b = home[mine].to_numpy(float) - home[theirs].to_numpy(float), away[mine].to_numpy(float) - away[theirs].to_numpy(float)
        lower_is_better = label.startswith("Fewer")
        lead = np.where(a == b, np.nan, np.where((a < b) if lower_is_better else (a > b), 1.0, 0.0))
        ok = ~np.isnan(lead)
        home_won = home["win"].to_numpy(bool)
        leader_won = np.where(lead == 1, home_won, ~home_won)[ok]
        out.append({"metric": label, "games": int(ok.sum()), "leader_win_pct": round(float(leader_won.mean()), 4)})
    sf = g[g["scored_first"]]
    out.append({"metric": "Scored first", "games": int(len(sf)), "leader_win_pct": round(float(sf["win"].mean()), 4)})
    return sorted(out, key=lambda r: -r["leader_win_pct"])


# ---------------------------------------------------------------- pre-game

RATES = {
    # name: (numerator columns, denominator columns or "gp") → season-to-date value
    "pts_pct": (["points"], "2gp"),
    "gf_pct": (["goals"], ["goals", "goals_against"]),
    "xgf_pct": (["xgf"], ["xgf", "xga"]),
    "xgf_pct_5v5": (["xgf_5v5"], ["xgf_5v5", "xga_5v5"]),
    "xgf_pg": (["xgf"], "gp"),
    "xga_pg": (["xga"], "gp"),
    "st_net_pg": (["pp_goals", "-pp_goals_against"], "gp"),
    "pen_diff_pg": (["pen_drawn", "-pen_taken"], "gp"),
    "fo_pct": (["fo_won"], ["fo_won", "fo_lost"]),
    "sh_pct": (["goals"], ["sog"]),
    "sv_pct": (["sog_against", "-goals_against"], ["sog_against"]),
}
FEATURES = [*RATES, "goalie_sax_rate", "rest", "b2b"]
# Chosen before looking at any test season, from the public literature on NHL game prediction:
# territory/chance share, goaltending, special teams, schedule. (The full set is reported too.)
COMPACT = ["xgf_pct_5v5", "goalie_sax_rate", "st_net_pg", "pts_pct", "rest", "b2b"]


def _cum(team_rows: pd.DataFrame, col: str) -> np.ndarray:
    sign = -1.0 if col.startswith("-") else 1.0
    v = sign * team_rows[col.lstrip("-")].to_numpy(float)
    return np.concatenate([[0.0], np.cumsum(v)[:-1]])  # strictly before each game


def pregame(tg: pd.DataFrame, seed: dict | None = None) -> pd.DataFrame:
    """Per team-game: season-to-date rates (before the game), shrunk to a prior; goalie; rest.

    `seed` (from season_summary of the previous season) supplies priors when that season's
    games are not in `tg`, which is how the live predictions run from committed files."""
    g = tg[tg["game_type"] == 2].sort_values(["date", "game_id"]).copy()
    g["date"] = pd.to_datetime(g["date"])
    finals: dict[tuple[int, str], dict[str, float]] = {}
    league: dict[int, dict[str, float]] = {}  # league rate per season (known only after that season)
    den_pg: dict[int, dict[str, float]] = {}  # league denominator per team-game per season
    if seed:
        league[seed["season"]] = seed["league"]
        den_pg[seed["season"]] = seed["den_pg"]
        finals.update({(seed["season"], t): f for t, f in seed["finals"].items()})
    parts = []

    def total(frame: pd.DataFrame, cols) -> float:
        return float(sum(frame[c.lstrip("-")].sum() * (-1 if c.startswith("-") else 1) for c in cols))

    for season in sorted(g["season"].unique()):
        s = g[g["season"] == season].copy()
        prev = season - 10001
        # Priors use only the previous season. The first season in the data has no previous
        # one, so it borrows its own league figures: it is only ever a training season.
        lg_prev = league.get(prev)
        dp_prev = den_pg.get(prev)
        this_lg = {n: total(s, num) / (2 * len(s) if den == "2gp" else (len(s) if den == "gp" else total(s, den))) for n, (num, den) in RATES.items()}
        this_dp = {n: (2.0 if den == "2gp" else 1.0 if den == "gp" else total(s, den) / len(s)) for n, (num, den) in RATES.items()}
        lg = lg_prev or this_lg
        dp = dp_prev or this_dp
        for team, rows in s.groupby("team", sort=False):
            rows = rows.sort_values("date")
            gp = np.arange(len(rows), dtype=float)
            for name, (num, den) in RATES.items():
                n = sum(_cum(rows, c) for c in num)
                d = 2 * gp if den == "2gp" else (gp if den == "gp" else sum(_cum(rows, c) for c in den))
                last = finals.get((prev, team), {}).get(name)
                prior = lg[name] if last is None else 0.5 * last + 0.5 * lg[name]
                w = K_GAMES * dp[name]  # K_GAMES games' worth of denominator
                rows[name] = (n + prior * w) / (d + w)
            days = rows["date"].diff().dt.days.to_numpy()
            rows["rest"] = np.minimum(np.nan_to_num(days, nan=REST_CAP), REST_CAP)
            rows["b2b"] = (rows["rest"] == 1).astype(float)
            parts.append(rows)
            full = s[s["team"] == team]
            finals[(season, team)] = {
                n: total(full, num) / (2 * len(full) if den == "2gp" else (len(full) if den == "gp" else total(full, den))) for n, (num, den) in RATES.items()
            }
        league[season] = this_lg
        den_pg[season] = this_dp
    out = pd.concat(parts).sort_values(["date", "game_id"])
    out["goalie_sax_rate"] = _goalie_rates(out, seed)
    return out


def season_summary(tg: pd.DataFrame, season: int) -> dict:
    """End-of-season figures that seed the next season's priors (committed for live predictions)."""
    s = tg[(tg["game_type"] == 2) & (tg["season"] == season)]

    def total(frame, cols):
        return float(sum(frame[c.lstrip("-")].sum() * (-1 if c.startswith("-") else 1) for c in cols))

    def rate(frame, num, den):
        return total(frame, num) / (2 * len(frame) if den == "2gp" else (len(frame) if den == "gp" else total(frame, den)))

    goalies = s.groupby("starter").agg(xg=("starter_xg_faced", "sum"), ga=("starter_ga", "sum"))
    return {
        "season": int(season),
        "league": {n: rate(s, num, den) for n, (num, den) in RATES.items()},
        "den_pg": {n: (2.0 if den == "2gp" else 1.0 if den == "gp" else total(s, den) / len(s)) for n, (num, den) in RATES.items()},
        "finals": {t: {n: rate(f, num, den) for n, (num, den) in RATES.items()} for t, f in s.groupby("team")},
        "goalies": {str(int(k)): [float(v.xg), float(v.ga)] for k, v in goalies.iterrows()},
    }


def _goalie_rates(g: pd.DataFrame, seed: dict | None = None) -> np.ndarray:
    """Starting goalie's saves-above-expected rate before the game: (xG faced − GA) / xG faced,
    over his previous games this season and last, shrunk to 0 with GOALIE_K_XG expected goals."""
    rate = np.zeros(len(g))
    hist: dict[int, list[tuple[pd.Timestamp, int, float, float]]] = {}
    if seed:
        for gid, (xg, ga) in seed.get("goalies", {}).items():
            hist[int(gid)] = [(pd.Timestamp("1900-01-01"), int(seed["season"]), xg, ga)]
    for i, (date, season, starter, xgf, ga) in enumerate(zip(g["date"], g["season"], g["starter"], g["starter_xg_faced"], g["starter_ga"])):
        if pd.isna(starter):
            continue
        h = hist.setdefault(int(starter), [])
        xs = sum(x for d, s, x, _ in h if s in (season, season - 10001) and d < date)
        gs = sum(a for d, s, _, a in h if s in (season, season - 10001) and d < date)
        rate[i] = (xs - gs) / (xs + GOALIE_K_XG)
        h.append((date, season, float(xgf), float(ga)))
    return rate


def matchups(pre: pd.DataFrame) -> pd.DataFrame:
    """One row per game: home-minus-away feature differences and the home result."""
    h = pre[pre["is_home"]].set_index("game_id")
    a = pre[~pre["is_home"]].set_index("game_id").loc[h.index]
    m = pd.DataFrame({"season": h["season"], "date": h["date"], "home": h["team"], "away": a["team"], "home_win": h["win"].astype(int)}, index=h.index)
    for f in FEATURES:
        m[f"d_{f}"] = h[f].to_numpy(float) - a[f].to_numpy(float)
    return m.reset_index()


# ---------------------------------------------------------------- models

def log_loss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def scores(y, p) -> dict:
    return {"games": int(len(y)), "log_loss": round(log_loss(y, p), 5), "brier": round(float(np.mean((p - y) ** 2)), 5),
            "accuracy": round(float(np.mean((p > 0.5) == (y == 1))), 4), "mean_p": round(float(p.mean()), 4), "home_win_rate": round(float(y.mean()), 4)}


def elo(m: pd.DataFrame, k: float, hfa: float, carry: float = 0.7, ratings: dict[str, float] | None = None, seasons: dict[str, int] | None = None,
        return_state: bool = False):
    """Pre-game Elo P(home win); ratings regress (1 − carry) toward 1500 each new season.
    `ratings`/`seasons` continue from a saved state (live predictions)."""
    r: dict[str, float] = dict(ratings or {})
    season_of: dict[str, int] = dict(seasons or {})
    p = np.zeros(len(m))
    for i, row in enumerate(m.itertuples()):
        for t in (row.home, row.away):
            if t in season_of and season_of[t] != row.season:
                r[t] = 1500 + carry * (r[t] - 1500)
            season_of[t] = row.season
        rh, ra = r.get(row.home, 1500.0), r.get(row.away, 1500.0)
        p[i] = 1 / (1 + 10 ** (-(rh + hfa - ra) / 400))
        delta = k * (row.home_win - p[i])
        r[row.home], r[row.away] = rh + delta, ra - delta
    return (p, r, season_of) if return_state else p


def fit_lr(X, y, C=0.5):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000)).fit(X, y)


def bootstrap_diff(y, p_model, p_base, n=2000, seed=7) -> list[float]:
    """95% interval of log loss(model) − log loss(base), resampling games."""
    rng = np.random.default_rng(seed)
    idx = np.arange(len(y))
    diffs = []
    for _ in range(n):
        b = rng.choice(idx, len(idx))
        diffs.append(log_loss(y[b], p_model[b]) - log_loss(y[b], p_base[b]))
    lo, mid, hi = np.percentile(diffs, [2.5, 50, 97.5])
    return [round(float(lo), 4), round(float(mid), 4), round(float(hi), 4)]


def calibration(y, p, bins=10) -> list[dict]:
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        s = (p >= lo) & (p <= hi)
        if s.sum():
            out.append({"p_from": round(float(lo), 3), "p_to": round(float(hi), 3), "games": int(s.sum()), "predicted": round(float(p[s].mean()), 4), "actual": round(float(y[s].mean()), 4)})
    return out


def walk_forward(m: pd.DataFrame) -> dict:
    seasons = sorted(m["season"].unique())
    preds: dict[str, list[np.ndarray]] = {k: [] for k in ("home_only", "points_pct", "elo", "compact", "full")}
    ys, test_seasons, per_season = [], [], {}
    # Elo runs through every season in order (it only ever uses earlier games); K/HFA tuned on the first season.
    grid = [(k, h) for k in (4, 6, 8, 10) for h in (0, 25, 50, 75)]
    first = m[m["season"] == seasons[0]]
    best = min(grid, key=lambda kh: log_loss(first["home_win"].to_numpy(), elo(first, *kh)))
    p_elo_all = elo(m, *best)
    single = {f: [] for f in FEATURES}
    for ts in seasons[1:]:
        tr, te = m[m["season"] < ts], m[m["season"] == ts]
        y = te["home_win"].to_numpy()
        base = np.full(len(te), tr["home_win"].mean())
        pts = fit_lr(tr[["d_pts_pct"]], tr["home_win"]).predict_proba(te[["d_pts_pct"]])[:, 1]
        cols = [f"d_{f}" for f in FEATURES]
        full = fit_lr(tr[cols], tr["home_win"]).predict_proba(te[cols])[:, 1]
        ccols = [f"d_{f}" for f in COMPACT]
        compact = fit_lr(tr[ccols], tr["home_win"]).predict_proba(te[ccols])[:, 1]
        e = p_elo_all[m["season"].to_numpy() == ts]
        for k, v in (("home_only", base), ("points_pct", pts), ("elo", e), ("compact", compact), ("full", full)):
            preds[k].append(v)
        for f in FEATURES:
            single[f].append(fit_lr(tr[[f"d_{f}"]], tr["home_win"]).predict_proba(te[[f"d_{f}"]])[:, 1])
        ys.append(y)
        test_seasons.append(int(ts))
        per_season[str(ts)] = {k: scores(y, preds[k][-1]) for k in preds}
    y = np.concatenate(ys)
    P = {k: np.concatenate(v) for k, v in preds.items()}
    S = {f: np.concatenate(v) for f, v in single.items()}
    last_train = m[m["season"] < seasons[-1]]
    coef_model = fit_lr(last_train[[f"d_{f}" for f in COMPACT]], last_train["home_win"])
    coefs = dict(zip(COMPACT, (round(float(c), 4) for c in coef_model[-1].coef_[0])))
    return {
        "test_seasons": test_seasons,
        "elo_settings": {"k": best[0], "home_advantage_elo": best[1], "season_carryover": 0.7},
        "pooled": {k: scores(y, p) for k, p in P.items()},
        "per_season": per_season,
        "vs_home_only_log_loss_diff_ci95": {k: bootstrap_diff(y, P[k], P["home_only"]) for k in ("points_pct", "elo", "compact", "full")},
        "compact_vs_elo_log_loss_diff_ci95": bootstrap_diff(y, P["compact"], P["elo"]),
        "compact_vs_points_log_loss_diff_ci95": bootstrap_diff(y, P["compact"], P["points_pct"]),
        "full_vs_elo_log_loss_diff_ci95": bootstrap_diff(y, P["full"], P["elo"]),
        "single_feature": sorted(
            ({"feature": f, "log_loss": round(log_loss(y, S[f]), 5), "vs_home_only_ci95": bootstrap_diff(y, S[f], P["home_only"], n=1000)} for f in FEATURES),
            key=lambda r: r["log_loss"],
        ),
        "compact_model_standardised_coefficients": coefs,
        "calibration_compact": calibration(y, P["compact"]),
    }


def main(argv: list[str]) -> None:
    seasons = [int(a) for a in argv]
    tg = load(seasons)
    m = matchups(pregame(tg))
    result = {
        "question": "Which metrics go with wins (descriptive), and which pre-game information predicts them (walk-forward)",
        "target": "home team wins, OT and shootout included; regular season",
        "seasons": seasons,
        "games": int(len(m)),
        "home_win_rate_by_season": {str(s): round(float(v), 4) for s, v in m.groupby("season")["home_win"].mean().items()},
        "descriptive": descriptive(tg),
        "predictive": walk_forward(m),
        "features": {
            "shrinkage": f"season-to-date rates blended with a prior worth {K_GAMES} games (previous season regressed halfway to the league mean)",
            "goalie": f"starting goalie's (xG faced − goals) / (xG faced + {GOALIE_K_XG:.0f}), this season and last, before the game; the actual starter (assumes the starter is confirmed before puck drop)",
            "rest": f"days since the team's previous game, capped at {REST_CAP}; b2b = second night of a back-to-back",
            "xg": "RosterIQ xG v1 production model (fitted on these seasons' shots; in-sample for the shot model, never sees game results). "
            "Its season totals run below MoneyPuck's in 2023-24 (−5.1%) and 2024-25 (−4.7%); a league-wide shift cancels in xG shares and in "
            "home-minus-away goalie differences, which is all this model uses",
            "live_starter": "live predictions are made at 10:00 UTC, before starters are confirmed, and use the expected starter (most starts in the "
            "team's last 10 games); checked on 56 games of 2025-26: identical to the backtest when the guess is right (17 games), "
            "mean |difference| 0.009 overall",
        },
    }
    CARD_DIR.mkdir(parents=True, exist_ok=True)
    # Live artifacts: the compact model fitted on every season, and the last season's priors.
    ccols = [f"d_{f}" for f in COMPACT]
    final = fit_lr(m[ccols], m["home_win"])
    sc, lr = final[0], final[-1]
    es = result["predictive"]["elo_settings"]
    _, ratings, season_of = elo(m, es["k"], es["home_advantage_elo"], es["season_carryover"], return_state=True)
    last = seasons[-1]
    summary = season_summary(tg, last)
    reg_last = tg[(tg["game_type"] == 2) & (tg["season"] == last)]
    summary["team_starters"] = {t: int(f["starter"].mode().iloc[0]) for t, f in reg_last.groupby("team") if f["starter"].notna().any()}
    (CARD_DIR / "model.json").write_text(json.dumps({
        "model": "rosteriq-games-v0 compact",
        "trained_on": seasons,
        "features": COMPACT,
        "scaler_mean": sc.mean_.tolist(),
        "scaler_scale": sc.scale_.tolist(),
        "coef": lr.coef_[0].tolist(),
        "intercept": float(lr.intercept_[0]),
        "home_win_rate": float(m["home_win"].mean()),
        "k_games": K_GAMES,
        "goalie_k_xg": GOALIE_K_XG,
        "elo": {**es, "ratings": ratings, "season_of": season_of},
    }, indent=1))
    (CARD_DIR / "priors.json").write_text(json.dumps(summary, indent=1))
    (CARD_DIR / "metrics.json").write_text(json.dumps(result, indent=1))
    print(json.dumps({k: result[k] for k in ("games", "home_win_rate_by_season")}, indent=1))
    print(json.dumps(result["descriptive"], indent=1))
    print(json.dumps({k: result["predictive"][k] for k in ("test_seasons", "elo_settings", "pooled", "vs_home_only_log_loss_diff_ci95", "compact_vs_elo_log_loss_diff_ci95", "compact_vs_points_log_loss_diff_ci95", "full_vs_elo_log_loss_diff_ci95")}, indent=1))
    print(json.dumps(result["predictive"]["single_feature"], indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
