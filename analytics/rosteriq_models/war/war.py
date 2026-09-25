"""RosterIQ WAR v0: goals and wins above replacement for one regular season.

    python -m rosteriq_models.war.war 20252026 [20242025 ...]

Components (goals, then wins):
  EV offence / EV defence  5v5 RAPM on xG per 60 × the player's 5v5 minutes
  PP offence / SH defence  5v4 RAPM (power-play attackers vs penalty killers)
  Penalties                (drawn − taken) × the net goal value of a power play
  Finishing                goals − individual xG (unblocked, goalie in net)
  Goalies                  goals saved above expected (xG faced − goals, goalie in net)

Replacement level: the TOI-weighted average of players outside each team's
top 13 forwards / top 7 defencemen by total ice time (goalies: outside the
top 64 by xG faced), per component. Goals per win: the slope of team wins on
goal differential across the seasons' team records.

Differences from Evolving-Hockey's model (the public reference): xG rather
than goals as the RAPM target (predictive rather than descriptive), no
box-score (SPM) stage, and no zone-start or teammate-quality priors.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from rosteriq_models.games.build import scored_shots
from rosteriq_models.raw import season_games
from rosteriq_models.war.rapm import coefficients, design, fit, score_states, toi
from rosteriq_models.war.stints import attach_shots, season_stints

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "models" / "rosteriq-war-v0"
MIN_TOI_MIN = 200  # 5v5 minutes to be listed
F_SLOTS, D_SLOTS, G_SLOTS = 13, 7, 2


def bios(season: int) -> pd.DataFrame:
    rows = {}
    for g in season_games(season):
        if g.get("gameType") != 2:
            continue
        ab = {int(g["homeTeam"]["id"]): g["homeTeam"]["abbrev"], int(g["awayTeam"]["id"]): g["awayTeam"]["abbrev"]}
        for r in g.get("rosterSpots", []):
            pos = r.get("positionCode")
            rows[int(r["playerId"])] = {
                "player_id": int(r["playerId"]),
                "name": f'{r["firstName"]["default"]} {r["lastName"]["default"]}',
                "pos": "G" if pos == "G" else ("D" if pos == "D" else "F"),
                "team": ab.get(int(r["teamId"])),
            }
    return pd.DataFrame(rows.values()).set_index("player_id")


def penalties(season: int) -> tuple[pd.DataFrame, int]:
    drawn: dict[int, int] = {}
    taken: dict[int, int] = {}
    for g in season_games(season):
        if g.get("gameType") != 2:
            continue
        for p in g.get("plays", []):
            d = p.get("details") or {}
            if p.get("typeDescKey") == "penalty" and d.get("typeCode") in ("MIN", "MAJ"):
                if d.get("committedByPlayerId"):
                    taken[int(d["committedByPlayerId"])] = taken.get(int(d["committedByPlayerId"]), 0) + 1
                if d.get("drawnByPlayerId"):
                    drawn[int(d["drawnByPlayerId"])] = drawn.get(int(d["drawnByPlayerId"]), 0) + 1
    df = pd.DataFrame({"pen_drawn": pd.Series(drawn), "pen_taken": pd.Series(taken)}).fillna(0)
    return df, int(df["pen_taken"].sum())


def replacement(df: pd.DataFrame, value: str, weight: str) -> dict[str, float]:
    """TOI-weighted mean of `value` for players outside the top F_SLOTS/D_SLOTS per team (by total TOI)."""
    out = {}
    teams = df["team"].nunique()
    for pos, slots in (("F", F_SLOTS), ("D", D_SLOTS)):
        g = df[df["pos"] == pos].sort_values("toi_all", ascending=False)
        rep = g.iloc[slots * teams :]
        rep = rep[rep[weight] > 0]
        out[pos] = float(np.average(rep[value], weights=rep[weight])) if len(rep) else 0.0
    return out


def split_half(ev: pd.DataFrame, alpha: float) -> dict:
    """Odd vs even games: correlation of per-60 RAPM, for players with 300+ 5v5 minutes in each half."""
    from sklearn.linear_model import Ridge

    res = {}
    halves = []
    for parity in (0, 1):
        h = ev[(ev["game_id"] % 2) == parity]
        X, y, w, _, pl = design(h)
        m = Ridge(alpha=alpha, solver="sparse_cg", max_iter=4000, tol=1e-7).fit(X, y, sample_weight=w)
        c = coefficients(m, pl).set_index("player_id")
        c["toi"] = toi(h) / 60
        halves.append(c[c["toi"] >= 300])
    both = halves[0].join(halves[1], lsuffix="_a", rsuffix="_b", how="inner")
    for k in ("off", "def"):
        r = float(np.corrcoef(both[f"{k}_a"], both[f"{k}_b"])[0, 1])
        res[k] = {"players": int(len(both)), "r_half": round(r, 3), "r_full_spearman_brown": round(2 * r / (1 + r), 3)}
    return res


def season_war(season: int, goals_per_win: float) -> tuple[pd.DataFrame, dict]:
    shots = scored_shots(season)
    shots = shots[shots["modelled"] & (shots["game_type"] == 2)]
    home = {int(g["id"]): g["homeTeam"]["abbrev"] for g in season_games(season)}
    st, quality = attach_shots(season_stints(season), shots, home)
    st = score_states(st[st["dur"] > 0])
    b = bios(season)

    ev = st[st["ev5"]]
    X, y, w, g, pl = design(ev)
    m_ev, a_ev, cv_ev = fit(X, y, w, g, alphas=(4000.0, 16000.0, 64000.0, 256000.0))
    c = coefficients(m_ev, pl).set_index("player_id")
    c["toi5"] = toi(ev) / 60

    # 5v4: power-play team attacking (both goalies in).
    pp_home = (st["n_home"] == 5) & (st["n_away"] == 4) & st["home_goalie"].notna() & st["away_goalie"].notna()
    pp_away = (st["n_home"] == 4) & (st["n_away"] == 5) & st["home_goalie"].notna() & st["away_goalie"].notna()
    Xh, yh, wh, gh, plh = design(st[pp_home], "home")
    Xa, ya, wa, ga, pla = design(st[pp_away], "away")
    # Merge the two designs on a shared player index.
    pp_players = sorted(set(plh) | set(pla))
    idx = {p: i for i, p in enumerate(pp_players)}

    def remap(Xs, pls):
        P, Q = len(pls), len(pp_players)
        from scipy import sparse

        Xc = Xs.tocoo()
        cols = np.array([idx[pls[c]] if c < P else (Q + idx[pls[c - P]] if c < 2 * P else 2 * Q + (c - 2 * P)) for c in Xc.col])
        return sparse.csr_matrix((Xc.data, (Xc.row, cols)), shape=(Xs.shape[0], 2 * Q + 3))

    from scipy import sparse as sp

    Xpp = sp.vstack([remap(Xh, plh), remap(Xa, pla)]).tocsr()
    m_pp, a_pp, cv_pp = fit(Xpp, np.concatenate([yh, ya]), np.concatenate([wh, wa]), np.concatenate([gh, ga]), alphas=(1000.0, 4000.0, 16000.0, 64000.0))
    cpp = coefficients(m_pp, pp_players).set_index("player_id").rename(columns={"off": "pp_off", "def": "sh_def"})
    toi_pp = pd.concat([toi(st[pp_home]).rename(None), toi(st[pp_away]).rename(None)], axis=1)
    # PP minutes: on the 5-man side; SH minutes: on the 4-man side.
    pp_min, sh_min = {}, {}
    for mask, att, dfn in ((pp_home, "home_sk", "away_sk"), (pp_away, "away_sk", "home_sk")):
        for a_, d_, dur in zip(st.loc[mask, att], st.loc[mask, dfn], st.loc[mask, "dur"]):
            for p in a_:
                pp_min[p] = pp_min.get(p, 0) + dur / 60
            for p in d_:
                sh_min[p] = sh_min.get(p, 0) + dur / 60

    toi_all = toi(st) / 60
    pens, n_pen = penalties(season)
    # Net goal value of one minor: power-play goal differential per 60 × average power-play length.
    pp_st = st[pp_home | pp_away]
    pp_gf = float(np.where(pp_home[pp_home | pp_away], pp_st["home_g"], pp_st["away_g"]).sum())
    pp_ga = float(np.where(pp_home[pp_home | pp_away], pp_st["away_g"], pp_st["home_g"]).sum())
    pp_hours = float(pp_st["dur"].sum()) / 3600
    minutes_per_pen = pp_hours * 60 / max(n_pen, 1)
    pen_value = (pp_gf - pp_ga) / max(n_pen, 1)

    sk = shots[~shots["empty_net"]]
    fin = sk.groupby("shooter_id").agg(goals=("goal", "sum"), ixg=("xg", "sum"))
    gk = sk[sk["goalie_id"].notna()].groupby("goalie_id").agg(xg_faced=("xg", "sum"), ga=("goal", "sum"))
    gk.index = gk.index.astype(int)

    df = b.join(c, how="left").join(cpp, how="left").join(pens, how="left").join(fin, how="left")
    df["toi_all"] = toi_all
    df["toi_pp"] = pd.Series(pp_min)
    df["toi_sh"] = pd.Series(sh_min)
    df = df.fillna({k: 0.0 for k in ("off", "def", "pp_off", "sh_def", "toi5", "toi_all", "toi_pp", "toi_sh", "pen_drawn", "pen_taken", "goals", "ixg")})
    sk_df = df[df["pos"] != "G"].copy()
    sk_df["pen_net_60"] = (sk_df["pen_drawn"] - sk_df["pen_taken"]) / sk_df["toi_all"].where(sk_df["toi_all"] > 0) * 60
    sk_df["fin_60"] = (sk_df["goals"] - sk_df["ixg"]) / sk_df["toi_all"].where(sk_df["toi_all"] > 0) * 60
    sk_df = sk_df.fillna({"pen_net_60": 0.0, "fin_60": 0.0})
    rep = {
        "off": replacement(sk_df, "off", "toi5"),
        "def": replacement(sk_df, "def", "toi5"),
        "pp_off": replacement(sk_df, "pp_off", "toi_pp"),
        "sh_def": replacement(sk_df, "sh_def", "toi_sh"),
        "pen_net_60": replacement(sk_df, "pen_net_60", "toi_all"),
        "fin_60": replacement(sk_df, "fin_60", "toi_all"),
    }
    r = lambda k: sk_df["pos"].map(rep[k])  # noqa: E731
    sk_df["ev_off"] = (sk_df["off"] - r("off")) * sk_df["toi5"] / 60
    sk_df["ev_def"] = -(sk_df["def"] - r("def")) * sk_df["toi5"] / 60
    sk_df["pp"] = (sk_df["pp_off"] - r("pp_off")) * sk_df["toi_pp"] / 60
    sk_df["sh"] = -(sk_df["sh_def"] - r("sh_def")) * sk_df["toi_sh"] / 60
    sk_df["penalties"] = (sk_df["pen_net_60"] - r("pen_net_60")) * sk_df["toi_all"] / 60 * pen_value
    sk_df["finishing"] = (sk_df["fin_60"] - r("fin_60")) * sk_df["toi_all"] / 60
    comps = ["ev_off", "ev_def", "pp", "sh", "penalties", "finishing"]
    sk_df["gar"] = sk_df[comps].sum(axis=1)
    sk_df["war"] = sk_df["gar"] / goals_per_win

    g_df = df[df["pos"] == "G"].join(gk, how="inner")
    g_df["gsax"] = g_df["xg_faced"] - g_df["ga"]
    ranked = g_df.sort_values("xg_faced", ascending=False)
    rep_g = ranked.iloc[G_SLOTS * df["team"].nunique() :]
    rep_rate = float(rep_g["gsax"].sum() / rep_g["xg_faced"].sum()) if len(rep_g) else 0.0
    g_df["gar"] = g_df["gsax"] - rep_rate * g_df["xg_faced"]
    g_df["war"] = g_df["gar"] / goals_per_win

    card = {
        "season": season,
        "shots_matched_to_stints": quality,
        "ev5_hours": round(float(ev["dur"].sum()) / 3600, 1),
        "rapm": {
            "ev5": {"alpha": a_ev, "cv_weighted_mse": cv_ev, "intercept_xg60": round(float(m_ev.intercept_), 3), "home_trailing_leading_xg60": [round(float(x), 3) for x in m_ev.coef_[-3:]]},
            "pp5v4": {"alpha": a_pp, "cv_weighted_mse": cv_pp, "intercept_xg60": round(float(m_pp.intercept_), 3)},
        },
        "replacement": {k: {p: round(v, 4) for p, v in d.items()} for k, d in rep.items()},
        "goalie_replacement_gsax_per_xg": round(rep_rate, 4),
        "penalty_value_goals": round(pen_value, 4),
        "minutes_of_5v4_per_minor": round(minutes_per_pen, 3),
        "goals_per_win": round(goals_per_win, 3),
        "split_half_reliability_ev5": split_half(ev, a_ev),
    }
    cols = ["name", "team", "pos", "toi_all", "toi5", "toi_pp", "toi_sh", *comps, "gar", "war", "off", "def", "pp_off", "sh_def", "goals", "ixg", "pen_drawn", "pen_taken"]
    skaters = sk_df[sk_df["toi5"] >= MIN_TOI_MIN][cols].sort_values("war", ascending=False)
    goalies = g_df[["name", "team", "xg_faced", "ga", "gsax", "gar", "war"]].sort_values("war", ascending=False)
    return pd.concat([skaters.assign(kind="skater"), goalies.assign(kind="goalie")]), card


def goals_per_win(seasons: list[int]) -> float:
    """Slope of team wins on goal differential (shootout goals excluded), across the given seasons."""
    from rosteriq_models.games.build import load

    tg = load(seasons)
    t = tg[tg["game_type"] == 2].groupby(["season", "team"]).agg(w=("win", "sum"), gf=("goals", "sum"), ga=("goals_against", "sum"))
    slope = np.polyfit(t["gf"] - t["ga"], t["w"], 1)[0]
    return 1.0 / slope


def main(argv: list[str]) -> None:
    seasons = [int(a) for a in argv]
    gpw = goals_per_win(seasons)
    OUT.mkdir(parents=True, exist_ok=True)
    cards = {}
    for s in seasons:
        df, card = season_war(s, gpw)
        df.round(4).to_csv(OUT / f"war_{s}.csv", index_label="player_id")
        cards[str(s)] = card
        top = df[df["kind"] == "skater"].head(10)[["name", "team", "pos", "war"]]
        print(json.dumps(card, indent=1, default=str))
        print(top.round(2).to_string())
    (OUT / "metrics.json").write_text(json.dumps({"model": "rosteriq-war-v0", "seasons": cards}, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1:])
