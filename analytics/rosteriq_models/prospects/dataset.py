"""One row per drafted skater: what was known at the draft, and what
happened next.

Draft-year season (D0) is the season that ends in the draft year (2005
draft -> 2004-05). Features use D0 and the season before (D-1) only.

Outcome: NHL regular-season games in the seven seasons after the draft
(D+1..D+7). `nhl_regular` = at least REGULAR_GP of them. Drafts without
seven completed seasons have no label (`label_mature` False); they are
scored, never trained on.

Goalies are excluded (their draft-year numbers are not points).
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from rosteriq_models.prospects.careers import age_on, season_id

REGULAR_GP = 200
OUTCOME_SEASONS = 7

LEAGUE_GROUPS = {
    "CHL": {"OHL", "WHL", "QMJHL"},
    "NCAA": {"NCAA"},
    "USHL/USNTDP": {"USHL", "NTDP"},
    "Europe pro": {"KHL", "Russia", "SHL", "Liiga", "Czechia", "NL", "DEL", "Slovakia", "ICEHL"},
    "Europe second tier": {"VHL", "HockeyAllsvenskan", "Mestis", "Czechia2", "Swiss-B", "DEL2", "Slovakia2"},
    "Europe junior": {
        "MHL", "Russia-Jr.", "J20 Nationell", "U20 SM-sarja", "Czechia U20", "U20-Elit", "Slovakia U20",
        "J18 Nationell", "J18 Elit", "J18 Allsvenskan", "Swe-U18", "U18 SM-sarja", "Czechia U18", "Slovakia U18",
        "Russia U18", "Russia-3",
    },
}


def league_group(league: object) -> str:
    # No draft-year season at all arrives as a missing value (NaN).
    if not isinstance(league, str) or not league:
        return "none"
    for g, members in LEAGUE_GROUPS.items():
        if league in members:
            return g
    if league.startswith(("High-", "USHS")) or league in {"BCHL", "AJHL", "SJHL", "OJHL", "CCHL", "MJHL", "EJHL", "NAHL"}:
        return "North America junior A / high school"
    return "other"


def _season_summary(lines: pd.DataFrame, factors: dict[str, float]) -> pd.DataFrame:
    """Per player+season: GP, points, raw PPG, NHLe PPG (GP-weighted over
    leagues that have a factor), share of GP in leagues with a factor, and
    the league with the most games."""
    d = lines.copy()
    d["mult"] = d["league"].map(factors)
    d["nhle_pts"] = d["points"] * d["mult"]
    d["gp_known"] = np.where(d["mult"].notna(), d["gp"], 0)
    g = d.groupby(["player_id", "season"])
    out = pd.DataFrame({
        "gp": g["gp"].sum(),
        "points": g["points"].sum(),
        "goals": g["goals"].sum(),
        "nhle_points": g["nhle_pts"].sum(min_count=1),
        "gp_known": g["gp_known"].sum(),
    })
    out["ppg"] = out["points"] / out["gp"].where(out["gp"] > 0)
    out["gpg"] = out["goals"] / out["gp"].where(out["gp"] > 0)
    out["nhle_ppg"] = out["nhle_points"] / out["gp_known"].where(out["gp_known"] > 0)
    out["known_share"] = out["gp_known"] / out["gp"].where(out["gp"] > 0)
    main = d.sort_values("gp", ascending=False).drop_duplicates(["player_id", "season"]).set_index(["player_id", "season"])["league"]
    out["main_league"] = main
    return out.reset_index()


def build(picks: pd.DataFrame, bio: pd.DataFrame, lines: pd.DataFrame, factors: dict[str, float], last_complete_season: int) -> pd.DataFrame:
    df = picks[picks["player_id"].notna()].copy()
    df["player_id"] = df["player_id"].astype(int)
    df = df.merge(bio, on="player_id", how="left")
    df = df[df["draft_position"] != "G"].copy()
    df["pos"] = df["draft_position"].map({"D": "D"}).fillna("F")
    df["age_at_draft"] = [age_on(b, dt.date(y, 9, 15)) for b, y in zip(df["birth_date"], df["draft_year"])]

    summ = _season_summary(lines, factors).set_index(["player_id", "season"])
    for tag, offset in (("d0", -1), ("dm1", -2)):
        keys = list(zip(df["player_id"], [season_id(y + offset) for y in df["draft_year"]]))
        s = summ.reindex(keys)
        for c in ("gp", "points", "ppg", "gpg", "nhle_ppg", "known_share", "main_league"):
            df[f"{tag}_{c}"] = s[c].to_numpy()
    df["d0_league_group"] = df["d0_main_league"].map(league_group)

    nhl = lines[lines["league"] == "NHL"].groupby(["player_id", "season"])["gp"].sum()
    gp7, gp_to_date = [], []
    for pid, y in zip(df["player_id"], df["draft_year"]):
        window = [season_id(y + k) for k in range(OUTCOME_SEASONS)]
        s = nhl.get(pid)
        gp7.append(int(s.reindex(window).fillna(0).sum()) if s is not None else 0)
        gp_to_date.append(int(s.sum()) if s is not None else 0)
    df["nhl_gp_7"] = gp7
    df["nhl_gp_to_date"] = gp_to_date
    # Seven seasons after the draft = D+1 .. D+7 = season ids draft_year .. draft_year+6.
    df["label_mature"] = [season_id(y + OUTCOME_SEASONS - 1) <= last_complete_season for y in df["draft_year"]]
    df["nhl_regular"] = (df["nhl_gp_7"] >= REGULAR_GP).astype(int)
    return df.reset_index(drop=True)
