"""Build the per-season shot table from cached play-by-play.

    python -m rosteriq_models.xg.build 20242025 20252026

Writes .data/models/xg/shots_{season}.parquet plus a JSON report of game
counts, rejects by reason and the direction source mix.
"""
from __future__ import annotations

import json
import sys
from collections import Counter

import pandas as pd

from rosteriq_models.raw import OUT, season_games, season_handedness
from rosteriq_models.xg.shots import parse_game


def build_season(season: int) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    hands = season_handedness(season)
    rows, rejects, games = [], Counter(), 0
    names: dict[int, dict] = {}
    last_date = None
    for game in season_games(season):
        games += 1
        if game.get("gameDate") and (last_date is None or game["gameDate"] > last_date):
            last_date = game["gameDate"]
        abbrev = {int(game["homeTeam"]["id"]): game["homeTeam"]["abbrev"], int(game["awayTeam"]["id"]): game["awayTeam"]["abbrev"]}
        for r in game.get("rosterSpots", []):
            names[int(r["playerId"])] = {
                "player_id": int(r["playerId"]),
                "name": f'{r["firstName"]["default"]} {r["lastName"]["default"]}',
                "position": r.get("positionCode"),
                "last_team": abbrev.get(int(r["teamId"])),
            }
        parsed = parse_game(game, hands)
        for s_ in parsed.shots:
            s_["team"] = abbrev[s_["team_id"]]
            s_["opp_team"] = next(a for t, a in abbrev.items() if t != s_["team_id"])
        rows.extend(parsed.shots)
        rejects.update(r["reject_reason"] for r in parsed.rejects)
    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError(f"no shots parsed for {season}")
    # Off-wing: in the normalised frame a positive signed angle is the
    # shooter's left side (checked against MoneyPuck's shotAngle sign).
    # Dead-centre shots (y == 0; the feed's coordinates are whole feet) have
    # no wing, so they are "centre" rather than forced onto a side.
    side = df["angle_signed"].apply(lambda a: "L" if a > 0 else "R")
    df["off_wing"] = "unknown"
    known = df["shooter_hand"].isin(["L", "R"])
    df.loc[known, "off_wing"] = (side[known] != df.loc[known, "shooter_hand"]).map({True: "off", False: "on"})
    df.loc[known & (df["y"] == 0), "off_wing"] = "centre"
    report = {
        "season": season,
        "games": games,
        "shots": int(len(df)),
        "goals": int(df["goal"].sum()),
        "rejects": dict(rejects),
        "direction_source": df["direction_source"].value_counts().to_dict(),
        "handedness_missing": int((~known).sum()),
        "empty_net_shots": int(df["empty_net"].sum()),
        "last_game_date": last_date,
    }
    return df, pd.DataFrame(list(names.values())), report


def main(argv: list[str]) -> None:
    out = OUT / "xg"
    out.mkdir(parents=True, exist_ok=True)
    for s in argv:
        df, players, report = build_season(int(s))
        df.to_parquet(out / f"shots_{s}.parquet", index=False)
        players.to_parquet(out / f"players_{s}.parquet", index=False)
        (out / f"shots_{s}.report.json").write_text(json.dumps(report, indent=1))
        print(json.dumps(report))


if __name__ == "__main__":
    main(sys.argv[1:])
