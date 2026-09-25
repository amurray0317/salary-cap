"""The season's running tab: frozen pre-game win probabilities, scored after the finals.

    python -m rosteriq_models.games.predict --season 20262027 --date 2026-10-06   # predict that day's games
    python -m rosteriq_models.games.predict --season 20262027 --score             # score every finished game

Runs from committed files only (models/rosteriq-games-v0/model.json and
priors.json, written by games.evaluate) plus the season's own game table
(games.build on the season's cached play-by-play), so the nightly job needs
no history download.

Freezing: a game's row is written once, before puck drop, and never
rewritten; its `made_at` timestamp is kept. The starting goalie is not
known at 10:00 UTC, so the expected starter is used: the goalie with the
most starts in the team's last 10 games (at season start, last season's
most-used goalie). Scored against home ice only and Elo (same settings as
the backtest), both also frozen at prediction time.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.request

import numpy as np
import pandas as pd

from rosteriq_models.games.build import OUT as GAMES_DIR
from rosteriq_models.games.evaluate import CARD_DIR, elo, log_loss, matchups, pregame

UA = {"User-Agent": "RosterIQ-nightly (personal analytics; contact via repository)"}
FIELDS = ["game_id", "date", "home", "away", "made_at", "p_home", "p_elo", "p_home_only", "home_starter", "away_starter"]


def _schedule(date: str) -> list[dict]:
    req = urllib.request.Request(f"https://api-web.nhle.com/v1/schedule/{date}", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    day = next((d for d in data.get("gameWeek", []) if d.get("date") == date), None)
    return [g for g in (day or {}).get("games", []) if g.get("gameType") == 2]


def _season_table(season: int) -> pd.DataFrame:
    f = GAMES_DIR / f"{season}.csv.gz"
    return pd.read_csv(f) if f.exists() else pd.DataFrame()


def _expected_starter(played: pd.DataFrame, team: str, fallback: dict) -> float:
    t = played[played["team"] == team].sort_values("date").tail(10)
    if len(t) and t["starter"].notna().any():
        return float(t["starter"].mode().iloc[0])
    v = fallback.get(team)
    return float(v) if v is not None else np.nan


def predict(season: int, date: str, games: list[dict] | None = None) -> pd.DataFrame:
    model = json.loads((CARD_DIR / "model.json").read_text())
    priors = json.loads((CARD_DIR / "priors.json").read_text())
    played = _season_table(season)
    if len(played):
        played = played[(played["game_type"] == 2) & (played["date"] < date)]
    games = games if games is not None else _schedule(date)
    if not games:
        return pd.DataFrame(columns=FIELDS)
    zero = {c: 0 for c in played.columns} if len(played) else {}
    rows = []
    for g in games:
        h, a = g["homeTeam"]["abbrev"], g["awayTeam"]["abbrev"]
        for team, opp, home in ((h, a, True), (a, h, False)):
            rows.append({**zero, "game_id": int(g["id"]), "season": season, "game_type": 2, "date": date, "team": team, "opp": opp, "is_home": home,
                         "win": False, "starter": _expected_starter(played, team, priors.get("team_starters", {})),
                         "starter_xg_faced": 0.0, "starter_ga": 0.0})
    table = pd.concat([played, pd.DataFrame(rows)], ignore_index=True) if len(played) else pd.DataFrame(rows)
    for c in ("points", "goals", "goals_against", "xgf", "xga", "xgf_5v5", "xga_5v5", "pp_goals", "pp_goals_against", "pen_drawn", "pen_taken",
              "fo_won", "fo_lost", "sog", "sog_against"):
        if c not in table:
            table[c] = 0.0
        table[c] = table[c].fillna(0.0)
    m = matchups(pregame(table, seed=priors))
    m["date"] = m["date"].dt.strftime("%Y-%m-%d")
    new_ids = {int(g["id"]) for g in games}
    X = np.column_stack([m[f"d_{f}"] for f in model["features"]])
    z = (X - np.asarray(model["scaler_mean"])) / np.asarray(model["scaler_scale"])
    p = 1 / (1 + np.exp(-(z @ np.asarray(model["coef"]) + model["intercept"])))
    e = model["elo"]
    p_elo = elo(m, e["k"], e["home_advantage_elo"], e["season_carryover"], ratings=e["ratings"], seasons=e["season_of"])
    starters = table.set_index(["game_id", "team"])["starter"]
    out = m.assign(p_home=p, p_elo=p_elo, p_home_only=model["home_win_rate"])
    out = out[out["game_id"].isin(new_ids)].copy()
    out["made_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out["home_starter"] = [starters.get((gid, t)) for gid, t in zip(out["game_id"], out["home"])]
    out["away_starter"] = [starters.get((gid, t)) for gid, t in zip(out["game_id"], out["away"])]
    return out[FIELDS]


def freeze(season: int, preds: pd.DataFrame) -> int:
    """Append predictions for games not already in the season's log; returns rows added."""
    f = CARD_DIR / f"predictions_{season}.csv"
    old = pd.read_csv(f) if f.exists() else pd.DataFrame(columns=FIELDS)
    new = preds[~preds["game_id"].isin(set(old["game_id"]))]
    if len(new):
        pd.concat([old, new], ignore_index=True).to_csv(f, index=False)
    return int(len(new))


def score(season: int) -> dict:
    f = CARD_DIR / f"predictions_{season}.csv"
    if not f.exists():
        return {"season": season, "games": 0}
    preds = pd.read_csv(f)
    played = _season_table(season)
    if not len(played):
        return {"season": season, "predicted": int(len(preds)), "games": 0}
    res = played[(played["game_type"] == 2) & played["is_home"]][["game_id", "win"]]
    j = preds.merge(res, on="game_id", how="inner")
    y = j["win"].astype(int).to_numpy()
    out = {"season": season, "predicted": int(len(preds)), "games": int(len(j)), "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    if len(j):
        for k in ("p_home", "p_elo", "p_home_only"):
            pk = j[k].to_numpy(float)
            out[k] = {"log_loss": round(log_loss(y, pk), 5), "brier": round(float(np.mean((pk - y) ** 2)), 5), "accuracy": round(float(np.mean((pk > 0.5) == (y == 1))), 4)}
    card_f = CARD_DIR / "metrics.json"
    card = json.loads(card_f.read_text())
    card.setdefault("running", {})[str(season)] = out
    card_f.write_text(json.dumps(card, indent=1))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (NHL game day); predicts that day's games")
    ap.add_argument("--score", action="store_true")
    a = ap.parse_args()
    if a.date:
        added = freeze(a.season, predict(a.season, a.date))
        print(json.dumps({"season": a.season, "date": a.date, "frozen": added}))
    if a.score:
        print(json.dumps(score(a.season)))


if __name__ == "__main__":
    main()
