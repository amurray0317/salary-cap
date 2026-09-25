"""NHL usage tiers from regular-season ice time.

A skater has a "top-of-lineup season" when, among skaters of his position
group (forwards / defence) who played at least half the season, his time on
ice per game ranks inside the league's top-6 forwards or top-4 defence:
rank <= teams x 6 (forwards) or teams x 4 (defence). The count of teams and
the season length come from the data itself (shortened seasons: 2012-13,
2019-20, 2020-21).

Why ice time: it is the coaches' own ranking of who plays in the top of the
lineup, available for every season and every skater from the free NHL stats
API. It also rewards defensive / penalty-kill roles, not only scoring.

Input: .data/raw/nhl/skater_summary/summary_<season>.json.gz, written by
    npm run data:fetch -- --nhl-seasons 2005-2025
"""
from __future__ import annotations

import pandas as pd

from rosteriq_models.raw import RAW, read_gz

SLOTS = {"F": 6, "D": 4}
MIN_SHARE_OF_SEASON = 0.5


def load_summaries(first_start: int, last_start: int) -> pd.DataFrame:
    rows = []
    for y in range(first_start, last_start + 1):
        season = y * 10000 + y + 1
        f = RAW / "nhl" / "skater_summary" / f"summary_{season}.json.gz"
        if not f.exists():
            raise FileNotFoundError(f"{f} missing; run npm run data:fetch -- --nhl-seasons {y}-{y}")
        data = read_gz(f).get("data", [])
        if not data:
            raise ValueError(f"{f} has no rows")
        for r in data:
            rows.append({
                "player_id": int(r["playerId"]),
                "season": int(r["seasonId"]),
                "pos": "D" if r["positionCode"] == "D" else "F",
                "gp": int(r.get("gamesPlayed") or 0),
                "toi_per_gp": float(r.get("timeOnIcePerGame") or 0.0),
                "teams": r.get("teamAbbrevs") or "",
            })
    return pd.DataFrame(rows)


def season_usage(summ: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """-> (per player-season with top_lineup flag, per-season report)."""
    out, report = [], []
    for season, s in summ.groupby("season"):
        single = s[~s["teams"].str.contains(",")]
        n_teams = single["teams"].nunique()
        season_games = int(single["gp"].max())
        qual = s[s["gp"] >= MIN_SHARE_OF_SEASON * season_games].copy()
        qual["toi_rank"] = qual.groupby("pos")["toi_per_gp"].rank(ascending=False, method="first")
        qual["slots"] = qual["pos"].map(SLOTS) * n_teams
        qual["top_lineup"] = qual["toi_rank"] <= qual["slots"]
        s = s.merge(qual[["player_id", "toi_rank", "top_lineup"]], on="player_id", how="left")
        s["top_lineup"] = s["top_lineup"].fillna(False).astype(bool)
        out.append(s)
        cut = qual[qual["top_lineup"]].groupby("pos")["toi_per_gp"].min() / 60
        report.append({
            "season": int(season),
            "teams": int(n_teams),
            "season_games": season_games,
            "qualified": int(len(qual)),
            "top_forwards": int(qual[(qual["pos"] == "F") & qual["top_lineup"]].shape[0]),
            "top_defence": int(qual[(qual["pos"] == "D") & qual["top_lineup"]].shape[0]),
            "toi_cutoff_min_F": round(float(cut.get("F", float("nan"))), 2),
            "toi_cutoff_min_D": round(float(cut.get("D", float("nan"))), 2),
        })
    return pd.concat(out, ignore_index=True), pd.DataFrame(report)
