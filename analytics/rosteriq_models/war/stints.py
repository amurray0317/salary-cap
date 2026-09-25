"""Stints: stretches of a game with the same skaters and goalies on the ice.

Built from the NHL shift charts (who was on the ice, by second) and joined
to the play-by-play shots scored by the RosterIQ xG model.

Conventions (the usual ones in public RAPM work):
  * a player is on the ice for a stint if a shift covers the whole stint;
  * an event at second t belongs to the stint (a, b] with a < t <= b, so a
    player who comes on at t is not on for an event at t (line changes on a
    whistle are credited to the players who were on for it);
  * goalies are recognised from the game's roster (positionCode G); a stint
    with no shift for a team's goalie is a pulled-goalie stint.

Quality check reported per season: the share of shots whose strength from
the shift charts (skaters and goalies on the ice) agrees with the
play-by-play situationCode for that shot.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from rosteriq_models.raw import RAW, read_gz, season_games


def _sec(mmss: str) -> int:
    m, s = mmss.split(":")
    return int(m) * 60 + int(s)


def game_stints(game: dict, shifts: list[dict]) -> list[dict]:
    home, away = int(game["homeTeam"]["id"]), int(game["awayTeam"]["id"])
    goalies = {int(r["playerId"]) for r in game.get("rosterSpots", []) if r.get("positionCode") == "G"}
    by_period: dict[int, list[tuple[int, int, int, int]]] = defaultdict(list)
    for r in shifts:
        if r.get("typeCode") != 517 or not r.get("startTime") or not r.get("endTime"):
            continue
        a, b = _sec(r["startTime"]), _sec(r["endTime"])
        if b > a:
            by_period[int(r["period"])].append((a, b, int(r["playerId"]), int(r["teamId"])))
    out = []
    for period, rows in sorted(by_period.items()):
        cuts = sorted({t for a, b, _, _ in rows for t in (a, b)})
        for a, b in zip(cuts[:-1], cuts[1:]):
            on = [(pid, team) for s, e, pid, team in rows if s <= a and e >= b]
            hs = tuple(sorted(p for p, t in on if t == home and p not in goalies))
            as_ = tuple(sorted(p for p, t in on if t == away and p not in goalies))
            hg = next((p for p, t in on if t == home and p in goalies), None)
            ag = next((p for p, t in on if t == away and p in goalies), None)
            if not hs and not as_:
                continue
            out.append({"game_id": int(game["id"]), "period": period, "start": a, "end": b, "dur": b - a,
                        "home_sk": hs, "away_sk": as_, "home_goalie": hg, "away_goalie": ag})
    return out


def season_stints(season: int) -> pd.DataFrame:
    folder = RAW / "nhl" / "shifts" / str(season)
    rows = []
    for game in season_games(season):
        if game.get("gameType") != 2:
            continue
        f = folder / f"{game['id']}.json.gz"
        if not f.exists():
            continue
        rows.extend(game_stints(game, read_gz(f)["data"]))
    df = pd.DataFrame(rows)
    df["n_home"] = df["home_sk"].map(len)
    df["n_away"] = df["away_sk"].map(len)
    df["ev5"] = (df["n_home"] == 5) & (df["n_away"] == 5) & df["home_goalie"].notna() & df["away_goalie"].notna()
    return df


def attach_shots(stints: pd.DataFrame, shots: pd.DataFrame, home_team: dict[int, str]) -> tuple[pd.DataFrame, dict]:
    """Sum xG and goals for/against each side of every stint. `shots` = modelled shots with xg.
    Returns stints with home_xg, away_xg, home_g, away_g, and the strength-agreement check."""
    st = stints.sort_values(["game_id", "period", "start"]).reset_index(drop=True)
    st[["home_xg", "away_xg", "home_g", "away_g"]] = 0.0
    idx = {k: g.index.to_numpy() for k, g in st.groupby(["game_id", "period"])}
    ends = {k: st.loc[v, "end"].to_numpy() for k, v in idx.items()}
    starts = {k: st.loc[v, "start"].to_numpy() for k, v in idx.items()}
    agree = total = 0
    hx, ax, hg, ag = (np.zeros(len(st)) for _ in range(4))
    for s in shots.itertuples():
        k = (int(s.game_id), int(s.period))
        if k not in idx:
            continue
        t = int(s.game_seconds) - (int(s.period) - 1) * 1200
        j = np.searchsorted(ends[k], t, side="left")  # first stint with end >= t
        if j >= len(ends[k]) or not (starts[k][j] < t <= ends[k][j]):
            continue
        row = idx[k][j]
        is_home = home_team.get(int(s.game_id)) == s.team
        (hx if is_home else ax)[row] += float(s.xg)
        (hg if is_home else ag)[row] += float(s.goal)
        # Strength agreement: skaters on the ice per side vs the shot's situation.
        n_for, n_against = (st.at[row, "n_home"], st.at[row, "n_away"]) if is_home else (st.at[row, "n_away"], st.at[row, "n_home"])
        total += 1
        agree += int(n_for == s.shooting_skaters and n_against == s.defending_skaters)
    st["home_xg"], st["away_xg"], st["home_g"], st["away_g"] = hx, ax, hg, ag
    return st, {"shots_matched": total, "strength_agreement": round(agree / max(total, 1), 4)}
