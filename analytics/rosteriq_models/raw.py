"""Read the gzip raw cache written by scripts/data/fetch-raw.ts (.data/raw)."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any, Iterator

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / ".data" / "raw"
OUT = REPO / ".data" / "models"


def read_gz(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def season_games(season: int) -> Iterator[dict[str, Any]]:
    folder = RAW / "nhl" / "pbp" / str(season)
    if not folder.is_dir():
        raise FileNotFoundError(f"no cached play-by-play for {season} in {folder}; run npm run data:fetch")
    for f in sorted(folder.glob("*.json.gz")):
        yield read_gz(f)


def season_handedness(season: int) -> dict[int, str]:
    """shootsCatches by player id from the cached skater bios (regular season + playoffs)."""
    hands: dict[int, str] = {}
    for game_type in (2, 3):
        f = RAW / "nhl" / "bios" / f"skaters_{season}_{game_type}.json.gz"
        if f.exists():
            for r in read_gz(f)["data"]:
                if r.get("shootsCatches") in ("L", "R"):
                    hands[int(r["playerId"])] = r["shootsCatches"]
    return hands
