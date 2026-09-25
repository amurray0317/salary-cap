"""One row per team per game, from cached NHL play-by-play plus RosterIQ xG.

    python -m rosteriq_models.games.build 20212022 20222023 ... (writes .data/games/<season>.csv.gz)

Sources, per column:
  * result, goals, events (faceoffs, hits, takeaways, giveaways, blocks,
    penalties): the play-by-play events themselves. Goals come from goal
    events, not from the xG shot table (a few goals have no coordinates and
    are dropped there). Shootout attempts are excluded from every count;
    the shootout decides `win` only.
  * xG: every unblocked attempt the xG model scores (goalie in net, not a
    penalty shot), from the production model. Note: that model was fitted on
    these seasons' shots, so team xG here is in-sample for the shot model
    (it never sees game results, and one game's shots barely move it).
  * strength: from each event's situationCode (5v5 = both goalies in, five
    skaters a side). PP goals = scored with more skaters than the opponent.
  * starting goalie: the goalie in net for the first shot on goal against.
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from rosteriq_models.raw import season_games
from rosteriq_models.xg import model as xgm
from rosteriq_models.xg.build import build_season
from rosteriq_models.xg.features import modelled
from rosteriq_models.xg.shots import parse_situation

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".data" / "games"
MODELS = ROOT / "models"

PENALTY_TYPES = {"MIN", "MAJ", "BEN"}  # penalties that put a team shorthanded (misconducts do not)


def _team_side(sit: tuple[int, int, int, int], is_home: bool) -> tuple[int, int, bool, bool]:
    away_g, away_sk, home_sk, home_g = sit
    return (home_sk, away_sk, home_g == 1, away_g == 1) if is_home else (away_sk, home_sk, away_g == 1, home_g == 1)


def _events(game: dict) -> list[dict]:
    """Per-team event counts, goals by strength, first goalies, and the result for one game."""
    home, away = int(game["homeTeam"]["id"]), int(game["awayTeam"]["id"])
    ab = {home: game["homeTeam"]["abbrev"], away: game["awayTeam"]["abbrev"]}
    c: dict[int, Counter] = {home: Counter(), away: Counter()}
    first_goalie: dict[int, int | None] = {home: None, away: None}
    first_goal: int | None = None
    for p in game.get("plays", []):
        kind = p.get("typeDescKey")
        d = p.get("details") or {}
        if (p.get("periodDescriptor") or {}).get("periodType") == "SO":
            continue
        owner = d.get("eventOwnerTeamId")
        owner = int(owner) if owner is not None else None
        if owner not in c:
            continue
        other = away if owner == home else home
        if kind == "faceoff":
            c[owner]["fo_won"] += 1
            c[other]["fo_lost"] += 1
        elif kind in ("hit", "takeaway", "giveaway"):
            c[owner][kind + "s"] += 1
        elif kind == "blocked-shot":
            c[owner]["blocks"] += 1  # owner = the blocking team
        elif kind == "penalty" and d.get("typeCode") in PENALTY_TYPES:
            c[owner]["pen_taken"] += 1
            c[other]["pen_drawn"] += 1
        elif kind in ("shot-on-goal", "goal"):
            c[owner]["sog"] += 1
            c[other]["sog_against"] += 1
            if first_goalie[other] is None and d.get("goalieInNetId"):
                first_goalie[other] = int(d["goalieInNetId"])
            if kind == "goal":
                if first_goal is None:
                    first_goal = owner
                sit = parse_situation(p.get("situationCode"))
                c[owner]["goals"] += 1
                c[other]["goals_against"] += 1
                if sit is not None:
                    my_sk, opp_sk, my_g, opp_g = _team_side(sit, owner == home)
                    if my_sk == 5 and opp_sk == 5 and my_g and opp_g:
                        c[owner]["goals_5v5"] += 1
                        c[other]["goals_against_5v5"] += 1
                    if my_sk > opp_sk and my_g and opp_g:  # man advantage, both goalies in (not 6v5 with a pulled goalie)
                        c[owner]["pp_goals"] += 1
                        c[other]["pp_goals_against"] += 1
                    if not opp_g:
                        c[owner]["en_goals"] += 1
    last = (game.get("gameOutcome") or {}).get("lastPeriodType") or "REG"
    hs, as_ = int(game["homeTeam"].get("score") or 0), int(game["awayTeam"].get("score") or 0)
    rows = []
    for t, opp in ((home, away), (away, home)):
        is_home = t == home
        won = (hs > as_) if is_home else (as_ > hs)
        rows.append({
            "game_id": int(game["id"]),
            "season": int(game["season"]),
            "game_type": int(game["gameType"]),
            "date": game["gameDate"],
            "team": ab[t],
            "opp": ab[opp],
            "is_home": is_home,
            "win": bool(won),
            "decision": last,
            "points": 2 if won else (1 if last in ("OT", "SO") else 0),
            "scored_first": first_goal == t,
            "starter": first_goalie[t],
            **{k: int(c[t][k]) for k in (
                "goals", "goals_against", "goals_5v5", "goals_against_5v5", "pp_goals", "pp_goals_against", "en_goals",
                "sog", "sog_against", "fo_won", "fo_lost", "hits", "takeaways", "giveaways", "blocks", "pen_taken", "pen_drawn",
            )},
        })
    return rows


def scored_shots(season: int, model=None) -> pd.DataFrame:
    """Unblocked attempts of `season` (shootouts excluded) with RosterIQ xG where the model applies (`modelled`)."""
    model = model or xgm.load(MODELS / xgm.MODEL_VERSION / "production")
    shots, _, _ = build_season(season)
    shots = shots[shots["period_type"] != "SO"].copy()
    mask = modelled(shots)
    ex = xgm.explain(model, shots[mask].reset_index(drop=True))
    shots["xg"] = np.nan
    shots.loc[mask, "xg"] = ex["xg"].to_numpy()
    shots["modelled"] = mask
    return shots


def team_games(season: int, model=None) -> pd.DataFrame:
    """Every completed regular-season and playoff game of `season`, two rows per game."""
    shots = scored_shots(season, model)
    mask = shots["modelled"]
    s5 = (shots["shooting_skaters"] == 5) & (shots["defending_skaters"] == 5) & ~shots["empty_net"] & ~shots["shooting_goalie_pulled"]

    agg = defaultdict(lambda: defaultdict(float))
    for (gid, team), g in shots[mask].groupby(["game_id", "team"]):
        agg[(gid, team)]["xgf"] = g["xg"].sum()
        agg[(gid, team)]["fenwick"] = len(g)
    for (gid, team), g in shots[mask & s5].groupby(["game_id", "team"]):
        agg[(gid, team)]["xgf_5v5"] = g["xg"].sum()
    # Goalie results: xG faced and goals allowed with that goalie in net (for GSAx).
    faced = shots[mask & shots["goalie_id"].notna()].groupby(["game_id", "opp_team", "goalie_id"]).agg(xg_faced=("xg", "sum"), ga=("goal", "sum")).reset_index()

    rows = [r for game in season_games(season) if game.get("gameType") in (2, 3) and game.get("gameState") in ("OFF", "FINAL") for r in _events(game)]
    df = pd.DataFrame(rows)
    for col in ("xgf", "fenwick", "xgf_5v5"):
        df[col] = [agg[(g, t)].get(col, 0.0) for g, t in zip(df["game_id"], df["team"])]
    opp = df[["game_id", "team", "xgf", "fenwick", "xgf_5v5"]].rename(columns={"team": "opp", "xgf": "xga", "fenwick": "fenwick_against", "xgf_5v5": "xga_5v5"})
    df = df.merge(opp, on=["game_id", "opp"], how="left")
    g = faced.rename(columns={"opp_team": "team", "goalie_id": "goalie"})
    g["goalie"] = g["goalie"].astype(int)
    df = df.merge(g.rename(columns={"goalie": "starter", "xg_faced": "starter_xg_faced", "ga": "starter_ga"}), on=["game_id", "team", "starter"], how="left")
    df[["starter_xg_faced", "starter_ga"]] = df[["starter_xg_faced", "starter_ga"]].fillna(0.0)
    return df.sort_values(["date", "game_id", "is_home"]).reset_index(drop=True)


def load(seasons: list[int]) -> pd.DataFrame:
    frames = []
    for s in seasons:
        f = OUT / f"{s}.csv.gz"
        if not f.exists():
            raise FileNotFoundError(f"{f} missing; run python -m rosteriq_models.games.build {s}")
        frames.append(pd.read_csv(f))
    return pd.concat(frames, ignore_index=True)


def main(argv: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    model = xgm.load(MODELS / xgm.MODEL_VERSION / "production")
    for s in [int(a) for a in argv]:
        df = team_games(s, model)
        df.to_csv(OUT / f"{s}.csv.gz", index=False)
        reg = df[df["game_type"] == 2]
        print({"season": s, "games": int(df["game_id"].nunique()), "regular": int(reg["game_id"].nunique()),
               "home_win_pct": round(float(reg.loc[reg["is_home"], "win"].mean()), 4),
               "goals_per_game": round(float(reg["goals"].sum() / reg["game_id"].nunique()), 3),
               "xg_per_game": round(float(reg["xgf"].sum() / reg["game_id"].nunique()), 3)})


if __name__ == "__main__":
    main(sys.argv[1:])
