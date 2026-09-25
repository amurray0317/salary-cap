"""Junior-league seasons from HockeyTech (OHL, WHL, QMJHL, USHL), cached by
    npm run data:fetch -- --ht ohl,whl,qmjhl,ushl --ht-years 2003-2025

One row per player and regular season (lines for several teams in one
season are combined), with the player's roster bio (name, birth date,
position). Unlike the NHL feed, this covers every player in the league,
drafted or not, which is what lets the ranked population carry real
draft-year production.

Derived per season:
  * points / goals / even-strength points per game (ES = points minus
    power-play and short-handed points)
  * shots per game where the league reports shots
  * share of team goals: the player's points divided by the goals of the
    team he played for (summed over his teams, weighted by games), a
    standard junior measure that adjusts for playing on a strong or weak team
  * era/league-relative rates (`<rate>_rel`): each rate divided by the mean
    of that league and season among players with at least MIN_GP games, so
    a 1.0 PPG in a high-scoring year counts for less than in a low one
    (junior scoring rose between the 2008-15 and 2016-19 draft classes)
"""
from __future__ import annotations

import pandas as pd

from rosteriq_models.raw import RAW, read_gz

HT_LEAGUES = {"ohl": "OHL", "whl": "WHL", "qmjhl": "QMJHL", "ushl": "USHL"}
MIN_GP = 10
RATES = ("ppg", "gpg", "es_ppg", "pp_ppg", "shots_pg")


def _lines(code: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    base = RAW / "ht" / code
    f = base / "seasons.json.gz"
    if not f.exists():
        raise FileNotFoundError(f"{f} missing; run npm run data:fetch -- --ht {code} --ht-years 2003-2025")
    seasons = {}
    for s in read_gz(f)["SiteKit"]["Seasons"]:
        if s.get("career") == "1" and s.get("playoff") == "0" and s.get("start_date"):
            y = int(s["start_date"][:4])
            seasons[str(s["season_id"])] = f"{y}-{(y + 1) % 100:02d}"
    lines, bios = [], []
    for sid, label in seasons.items():
        sdir = base / sid
        if not (sdir / "skaters.json.gz").exists():
            continue
        data = read_gz(sdir / "skaters.json.gz")[0]["sections"][0]["data"]
        for d in data:
            r = d.get("row", {})
            prop = d.get("prop", {})

            def num(k, default=0.0):
                v = r.get(k)
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return default

            lines.append({
                "league": HT_LEAGUES[code],
                "season": label,
                "ht_id": str(r.get("player_id")),
                "team": r.get("team_code"),
                "gp": num("games_played"),
                "goals": num("goals"),
                "assists": num("assists"),
                "points": num("points"),
                "pp_points": num("power_play_goals") + num("power_play_assists"),
                "sh_points": num("short_handed_goals") + num("short_handed_assists"),
                "shots": num("shots", float("nan")),
                "stat_name": r.get("name") or (prop.get("shortname") or {}).get("seoName") or r.get("shortname"),
            })
        for rf in sdir.glob("roster_*.json.gz"):
            for p in read_gz(rf)["SiteKit"]["Roster"]:
                if isinstance(p, dict) and p.get("player_id"):
                    bios.append({
                        "league": HT_LEAGUES[code],
                        "ht_id": str(p["player_id"]),
                        # First + last (the QMJHL's `name` is "Last, First").
                        "name": f'{p.get("first_name") or ""} {p.get("last_name") or ""}'.strip() or p.get("name"),
                        "birth_date": p.get("birthdate") if len(str(p.get("birthdate") or "")) == 10 else None,
                        "position": p.get("position"),
                    })
    return pd.DataFrame(lines), pd.DataFrame(bios)


def load(codes: list[str] | None = None) -> pd.DataFrame:
    """Per league, player and season: combined line + bio + derived rates."""
    frames = []
    for code in codes or list(HT_LEAGUES):
        lines, bios = _lines(code)
        if lines.empty:
            continue
        lines = lines[lines["gp"] > 0].copy()
        team_goals = lines.groupby(["season", "team"])["goals"].transform("sum")
        lines["team_goal_share"] = lines["points"] / team_goals.where(team_goals > 0)
        lines["shots_known"] = lines["shots"].notna()
        g = lines.groupby(["league", "ht_id", "season"])
        per = g[["gp", "goals", "assists", "points", "pp_points", "sh_points"]].sum()
        per["shots"] = g["shots"].sum(min_count=1)
        per["shots_gp"] = g.apply(lambda x: x.loc[x["shots_known"], "gp"].sum(), include_groups=False)
        per["team_goal_share"] = g.apply(lambda x: (x["team_goal_share"] * x["gp"]).sum() / x["gp"].sum(), include_groups=False)
        per["teams"] = g["team"].nunique()
        per = per.reset_index()
        bio = bios.dropna(subset=["name"]).sort_values("birth_date", na_position="last").drop_duplicates(["league", "ht_id"])
        frames.append(per.merge(bio, on=["league", "ht_id"], how="left"))
    d = pd.concat(frames, ignore_index=True)
    d["ppg"] = d["points"] / d["gp"]
    d["gpg"] = d["goals"] / d["gp"]
    d["es_ppg"] = (d["points"] - d["pp_points"] - d["sh_points"]) / d["gp"]
    d["pp_ppg"] = d["pp_points"] / d["gp"]
    d["shots_pg"] = d["shots"] / d["shots_gp"].where(d["shots_gp"] > 0)
    return add_relative_rates(d)


def add_relative_rates(d: pd.DataFrame) -> pd.DataFrame:
    """`<rate>_rel` = rate / mean rate of the same league and season (players with >= MIN_GP games)."""
    d = d.copy()
    for c in RATES:
        base = d[c].where(d["gp"] >= MIN_GP)
        d[f"{c}_rel"] = d[c] / base.groupby([d["league"], d["season"]]).transform("mean")
    return d
