"""Draft picks linked to NHL player ids, and full careers from landing pages.

Inputs come from scripts/data/fetch-raw.ts (.data/raw/nhl/draft/links_*.json
and .data/raw/nhl/landing/*.json.gz). Only regular-season lines
(gameTypeId 2) are used. A player who played for two teams in one league in
one season gets one combined line.
"""
from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from rosteriq_models.raw import RAW, read_gz


def season_id(start_year: int) -> int:
    return start_year * 10000 + start_year + 1


def load_picks(years: list[int]) -> pd.DataFrame:
    rows = []
    for y in years:
        f = RAW / "nhl" / "draft" / f"links_{y}.json"
        if not f.exists():
            raise FileNotFoundError(f"{f} missing; run npm run data:fetch -- --draft {y}-{y}")
        for item in json.loads(f.read_text()):
            p, o = item["pick"], item["outcome"]
            rows.append({
                "draft_year": p["draftYear"],
                "overall_pick": p["overallPick"],
                "round": p["round"],
                "name": f'{p["firstName"]} {p["lastName"]}',
                "draft_position": p["positionCode"],
                "amateur_league": p["amateurLeague"],
                "amateur_club": p["amateurClubName"],
                "country": p["countryCode"],
                "draft_height_in": p["heightInches"],
                "draft_weight_lb": p["weightPounds"],
                "drafted_by": p["teamAbbrev"],
                "player_id": int(o["playerId"]) if o["status"] == "linked" else None,
                "link_status": o["status"],
            })
    return pd.DataFrame(rows)


def load_careers(player_ids: list[int]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """-> (bio per player, regular-season lines per player/season/league)."""
    bios, lines = [], []
    for pid in player_ids:
        f = RAW / "nhl" / "landing" / f"{pid}.json.gz"
        if not f.exists():
            raise FileNotFoundError(f"landing page for {pid} not cached")
        L = read_gz(f)
        bios.append({
            "player_id": pid,
            "birth_date": L.get("birthDate"),
            "landing_position": L.get("position"),
            "shoots": L.get("shootsCatches"),
        })
        for s in L.get("seasonTotals", []):
            if s.get("gameTypeId") != 2:
                continue
            lines.append({
                "player_id": pid,
                "season": int(s["season"]),
                "league": s["leagueAbbrev"],
                "gp": int(s.get("gamesPlayed") or 0),
                "goals": int(s.get("goals") or 0),
                "assists": int(s.get("assists") or 0),
                "points": int(s.get("points") or 0),
            })
    bio = pd.DataFrame(bios)
    ln = pd.DataFrame(lines)
    ln = ln.groupby(["player_id", "season", "league"], as_index=False)[["gp", "goals", "assists", "points"]].sum()
    return bio, ln


def age_on(birth_date: str | None, when: dt.date) -> float | None:
    if not birth_date:
        return None
    b = dt.date.fromisoformat(birth_date)
    return (when - b).days / 365.25
