"""Shot parser tests on a recorded real game (NJD @ BUF, 2024-10-04, game
2024020001) cross-checked against MoneyPuck's shot file for the same game
(Data: MoneyPuck.com — tests/fixtures/moneypuck_shots_2024020001.csv holds
that game's 90 rows, a subset of columns, values unedited)."""
import csv
import json
from pathlib import Path

import pytest

from rosteriq_models.xg.shots import game_seconds, parse_game, parse_situation

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def parsed():
    return parse_game(json.loads((FIX / "nhl_pbp_2024020001.json").read_text()))


@pytest.fixture(scope="module")
def moneypuck():
    rows = list(csv.DictReader((FIX / "moneypuck_shots_2024020001.csv").open()))
    return {(int(float(r["time"])), int(float(r["shooterPlayerId"]))): r for r in rows}


def flag(r, k):
    return bool(int(float(r[k])))


def test_counts_match_moneypuck(parsed, moneypuck):
    assert parsed.rejects == []
    assert len(parsed.shots) == len(moneypuck) == 90
    assert sum(s["goal"] for s in parsed.shots) == 5


def test_every_shot_joins_on_game_second_and_shooter(parsed, moneypuck):
    keys = [(s["game_seconds"], s["shooter_id"]) for s in parsed.shots]
    assert len(set(keys)) == len(keys)
    assert all(k in moneypuck for k in keys)


def test_fields_agree_with_moneypuck(parsed, moneypuck):
    n = len(parsed.shots)
    agree = dict(goal=0, empty_net=0, skaters=0, rebound=0, rush=0, dist=0, side=0)
    for s in parsed.shots:
        r = moneypuck[(s["game_seconds"], s["shooter_id"])]
        agree["goal"] += s["goal"] == flag(r, "goal")
        agree["empty_net"] += s["empty_net"] == flag(r, "shotOnEmptyNet")
        hs, as_ = int(float(r["homeSkatersOnIce"])), int(float(r["awaySkatersOnIce"]))
        agree["skaters"] += (s["shooting_skaters"], s["defending_skaters"]) == ((hs, as_) if s["is_home"] else (as_, hs))
        agree["rebound"] += s["rebound"] == flag(r, "shotRebound")
        agree["rush"] += s["rush"] == flag(r, "shotRush")
        agree["dist"] += abs(s["distance"] - float(r["shotDistance"])) <= 2.0
        mp_angle = float(r["shotAngle"])
        agree["side"] += abs(mp_angle) < 1 or (s["angle_signed"] > 0) == (mp_angle > 0)
    # Exact fields must agree on every shot.
    assert agree["goal"] == agree["empty_net"] == agree["skaters"] == n
    # Derived fields: MoneyPuck's coordinates differ by up to ~1 ft from the
    # NHL feed and its event context is built from a different feed, so a
    # couple of edge cases differ (observed: 2 rebound, 1 rush, 1 distance).
    assert agree["rebound"] >= n - 3
    assert agree["rush"] >= n - 3
    assert agree["dist"] >= n - 2
    assert agree["side"] >= n - 3


def test_coordinates_are_normalised_to_attack_right(parsed):
    # Nearly every unblocked attempt comes from the attacking half.
    assert sum(s["x"] > 0 for s in parsed.shots) >= len(parsed.shots) - 3
    assert all(0 <= s["angle"] <= 180 for s in parsed.shots)


def test_score_state_is_before_the_shot(parsed):
    goals = [s for s in parsed.shots if s["goal"]]
    # First goal of the game is scored with the score tied 0-0.
    assert goals[0]["score_diff"] == 0


def test_helpers():
    assert parse_situation("1551") == (1, 5, 5, 1)
    assert parse_situation("0651") == (0, 6, 5, 1)
    assert parse_situation(None) is None
    assert game_seconds({"periodDescriptor": {"number": 2}, "timeInPeriod": "01:05"}) == 1265


def test_missing_coordinates_are_rejected_not_dropped():
    game = json.loads((FIX / "nhl_pbp_2024020001.json").read_text())
    first = next(p for p in game["plays"] if p["typeDescKey"] == "shot-on-goal")
    del first["details"]["xCoord"]
    res = parse_game(game)
    assert len(res.shots) == 89
    assert res.rejects[0]["reject_reason"] == "missing coordinates"
