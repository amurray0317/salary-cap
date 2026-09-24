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


# The NHL feed labels some leagues differently over time (sometimes both
# labels in the same seasons). Each alias maps to one current name. These
# are judgement calls, listed so they can be reviewed.
LEAGUE_ALIASES = {
    # Senior pro
    "Sweden": "SHL", "Finland": "Liiga", "CzRep": "Czechia", "Czech": "Czechia", "Swiss": "NL", "NLA": "NL",
    "Germany": "DEL", "EBEL": "ICEHL", "Rus-KHL": "KHL",
    "Sweden-2": "HockeyAllsvenskan", "Allsvenskan": "HockeyAllsvenskan", "Sweden-3": "HockeyEttan",
    "Russia-2": "VHL", "Finland-2": "Mestis", "Czech2": "Czechia2", "CzRep-2": "Czechia2", "German-2": "DEL2",
    "Russia3": "Russia-3",
    # NCAA: conference labels until 2015-16, one "NCAA" label after.
    "WCHA": "NCAA", "CCHA": "NCAA", "H-East": "NCAA", "ECAC": "NCAA", "NCHC": "NCAA", "Big Ten": "NCAA",
    # U.S. National Team Development Program
    "USDP": "NTDP", "U-18": "NTDP", "U-17": "NTDP",
    # European junior
    "Swe-Jr.": "J20 Nationell", "J20 SuperElit": "J20 Nationell", "U20 Nationell": "J20 Nationell",
    "Fin-Jr.": "U20 SM-sarja", "U20 SM-liiga": "U20 SM-sarja", "Fin-U18": "U18 SM-sarja",
    "CzRep-Jr.": "Czechia U20", "Czech U18": "Czechia U18", "CzR-U18": "Czechia U18",
    "CzR-U17": "Czechia U17", "Czech U16": "Czechia U16",
    "Swiss-Jr.": "U20-Elit", "Swiss-U17": "U17-Elit", "Slovak-Jr.": "Slovakia U20", "Svk-U18": "Slovakia U18",
    # North American junior / high school
    "OPJHL": "OJHL", "High-MN": "USHS-MN",
}

# Tournaments, cups, showcases and exhibitions are not leagues: excluded
# from careers used for NHLe and draft-year production (the train step
# reports how many lines were dropped).
TOURNAMENTS = {
    # International
    "WC", "WC-A", "WC-B", "WJC", "WJC-A", "WJC-B", "WJC-20", "WJC-18", "WJC-20 D1A", "WJC-18 D1A",
    "WJ18", "WJ18-A", "WJ18-B", "WJAC-19", "WHC-17", "U17-Dev", "OG", "Olympics", "OGQ", "OGC-16", "QGC-16",
    "WCup", "World Cup", "EHT", "International", "5 Nations", "4 Nations", "YOG", "EYOF", "CWG",
    "Hlinka Gretzky Cup", "Hlinka-Gretzky Cup", "Ivan Hlinka", "Ivan Hlinka Memorial",
    "USA-S15", "USA-S16", "USA-S17", "WSI U12", "WSI U13", "WSI U14", "WSI U15",
    # Club / junior cups and showcases
    "Champions HL", "Spengler Cup", "Continental Cup", "Memorial Cup", "OHL Cup", "M-Cup", "JCWC",
    "Prospects Challenge", "QC Int PW", "Brick Invitational", "TV-Pucken", "John Reid Memorial", "Alberta Cup",
    "MNHP", "JPL-Pro",
    # Qualification series and exhibitions
    "Sweden-Q", "Jr. C SM-sarja Q", "Exhib.",
}


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
    return pd.DataFrame(bios), clean_lines(pd.DataFrame(lines))


def clean_lines(ln: pd.DataFrame) -> pd.DataFrame:
    """Merge league aliases, drop tournaments, one line per player/season/league."""
    ln = ln.assign(league=ln["league"].replace(LEAGUE_ALIASES))
    ln = ln[~ln["league"].isin(TOURNAMENTS)]
    return ln.groupby(["player_id", "season", "league"], as_index=False)[["gp", "goals", "assists", "points"]].sum()


def tournament_lines(player_ids: list[int]) -> int:
    """How many regular-season lines are tournaments (for the run report)."""
    n = 0
    for pid in player_ids:
        for s in read_gz(RAW / "nhl" / "landing" / f"{pid}.json.gz").get("seasonTotals", []):
            n += s.get("gameTypeId") == 2 and s.get("leagueAbbrev") in TOURNAMENTS
    return n


def age_on(birth_date: str | None, when: dt.date) -> float | None:
    if not birth_date:
        return None
    b = dt.date.fromisoformat(birth_date)
    return (when - b).days / 365.25
