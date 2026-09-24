"""Score an in-progress season with the committed production model and
update the season-to-date totals in models/<version>/. Used nightly.

    python -m rosteriq_models.xg.score --season 20262027

  * The production model (trained on every completed season) is loaded
    from models/<version>/production and never refitted here.
  * Only games already cached by `npm run data:fetch -- --pbp <season>`
    are used; the fetcher only downloads completed games.
  * The season's rows in import_xg_{skaters,goalies,teams}.csv are
    replaced; other seasons are untouched.
  * Drift check: goals vs xG overall and by distance, as a Poisson z-score
    (goals − xG) / √xG. |z| > DRIFT_Z exits with code 2 so a scheduled run
    is marked failed (GitHub emails the owner). The files are still written.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys

import pandas as pd

from rosteriq_models.export import MODELS, write_xg_imports
from rosteriq_models.xg import model as m
from rosteriq_models.xg.build import build_season
from rosteriq_models.xg.features import modelled
from rosteriq_models.xg.train import season_totals

DRIFT_Z = 4.0
DISTANCE_BINS = [0, 10, 20, 30, 40, 50, 60, 200]


def drift(df: pd.DataFrame) -> dict:
    def z(g, x):
        return round((g - x) / math.sqrt(x), 2) if x > 0 else 0.0

    rows = [{"bin": "all", "shots": int(len(df)), "goals": int(df["goal"].sum()), "xg": round(float(df["xg"].sum()), 1)}]
    for lvl, g in df.groupby(pd.cut(df["distance"], DISTANCE_BINS, right=False), observed=True):
        rows.append({"bin": f"{lvl} ft", "shots": int(len(g)), "goals": int(g["goal"].sum()), "xg": round(float(g["xg"].sum()), 1)})
    for r in rows:
        r["z"] = z(r["goals"], r["xg"])
    flagged = [r for r in rows if abs(r["z"]) > DRIFT_Z]
    return {"threshold_abs_z": DRIFT_Z, "rows": rows, "flagged": flagged}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    season = ap.parse_args().season
    version_dir = MODELS / m.MODEL_VERSION
    card_path = version_dir / "metrics.json"
    card = json.loads(card_path.read_text())
    if season in card.get("seasons", []):
        # Off-season: the most recent season is already a training season.
        print(json.dumps({"season": season, "note": "training season; totals come from the train step, nothing to score"}))
        return 0

    try:
        df, players, report = build_season(season)
    except (FileNotFoundError, ValueError):
        # No folder yet, or no completed games in it (before opening night).
        print(json.dumps({"season": season, "games": 0, "note": "no completed games cached yet"}))
        return 0
    model = m.load(version_dir / "production")
    mod = df[modelled(df)]
    ex = m.explain(model, mod.reset_index(drop=True))
    totals = season_totals(df, ex.set_index(mod.index), players, season)
    counts = write_xg_imports(totals, season=season)

    scored = mod.assign(xg=ex["xg"].to_numpy())
    d = drift(scored)
    card.setdefault("in_season", {})[str(season)] = {
        "scored_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "games": report["games"],
        "through": report.get("last_game_date"),
        "unblocked_attempts": report["shots"],
        "model": "production (trained on every completed season; never refitted in-season)",
        "drift": d,
    }
    card["scored_seasons"] = sorted(set(card.get("seasons", [])) | {int(s) for s in card["in_season"]})
    card_path.write_text(json.dumps(card, indent=1))
    print(json.dumps({"season": season, "games": report["games"], "rows": counts, "drift_flagged": d["flagged"]}))
    return 2 if d["flagged"] else 0


if __name__ == "__main__":
    sys.exit(main())
