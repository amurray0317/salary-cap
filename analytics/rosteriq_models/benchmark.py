"""MoneyPuck shot-level data, used ONLY as the external benchmark for our xG
model (never as a training feature or label source).

Data: MoneyPuck.com — free for non-commercial use with clear credit
(https://moneypuck.com/data.htm). Files are the season zips MoneyPuck links
to on peter-tanner.com; `season` is the start year (2025 = 2025-26).

    python -m rosteriq_models.benchmark 2024 2025
"""
from __future__ import annotations

import io
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from rosteriq_models.raw import RAW

HOST = "peter-tanner.com"
MIN_INTERVAL_S = 2.0
UA = "RosterIQ/0.1 (+https://github.com/amurray0317/salary-cap; model benchmark)"
CREDIT = "Data: MoneyPuck.com"
_last = 0.0


def shots_path(season: int) -> Path:
    return RAW / "moneypuck" / f"shots_{season}.csv"


def fetch_shots(season: int) -> Path:
    global _last
    out = shots_path(season)
    if out.exists():
        return out
    url = f"https://{HOST}/moneypuck/downloads/shots_{season}.zip"
    wait = _last + MIN_INTERVAL_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as res:
        body = res.read()
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        names = [n for n in z.namelist() if n.endswith(".csv")]
        if len(names) != 1:
            raise ValueError(f"{url}: expected one CSV in the zip, found {names}")
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp")
        tmp.write_bytes(z.read(names[0]))
        tmp.rename(out)
    return out


BENCH_COLS = [
    "id", "game_id", "season", "isPlayoffGame", "time", "period", "event", "goal", "shooterPlayerId",
    "shotOnEmptyNet", "offWing", "shotRebound", "shotRush", "shotDistance", "shotType", "xGoal", "teamCode",
    "homeSkatersOnIce", "awaySkatersOnIce", "isHomeTeam",
]


def load_shots(season: int) -> pd.DataFrame:
    df = pd.read_csv(fetch_shots(season), usecols=BENCH_COLS)
    # MoneyPuck game_id is the 5/6-digit suffix; rebuild the NHL game id.
    game_type = df["isPlayoffGame"].astype(int).map({0: 2, 1: 3})
    df["nhl_game_id"] = season * 1_000_000 + game_type * 10_000 + df["game_id"].astype(int) % 10_000
    df["game_seconds"] = df["time"].astype(int)
    df["shooter_id"] = df["shooterPlayerId"].fillna(-1).astype(int)
    # Order of repeated (game, second, shooter) keys, by MoneyPuck's event number.
    df = df.sort_values(["nhl_game_id", "id"])
    df["key_seq"] = df.groupby(["nhl_game_id", "game_seconds", "shooter_id"]).cumcount()
    return df


if __name__ == "__main__":
    for s in sys.argv[1:]:
        print(fetch_shots(int(s)))
