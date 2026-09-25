"""Game tables, pre-game features (no look-ahead), stints and RAPM, on small hand-made inputs."""
import numpy as np
import pandas as pd

from rosteriq_models.games.build import _events
from rosteriq_models.games.evaluate import RATES, pregame
from rosteriq_models.war.rapm import coefficients, design, fit
from rosteriq_models.war.stints import attach_shots, game_stints

HOME, AWAY = 1, 2


def play(kind, owner, period=1, t="05:00", sit="1551", ptype="REG", **details):
    return {"typeDescKey": kind, "timeInPeriod": t, "situationCode": sit, "periodDescriptor": {"number": period, "periodType": ptype},
            "details": {"eventOwnerTeamId": owner, **details}}


def game(plays, home_score, away_score, last="REG"):
    return {"id": 2025020001, "season": 20252026, "gameType": 2, "gameDate": "2025-10-07", "gameState": "OFF",
            "homeTeam": {"id": HOME, "abbrev": "HOM", "score": home_score}, "awayTeam": {"id": AWAY, "abbrev": "AWY", "score": away_score},
            "gameOutcome": {"lastPeriodType": last}, "plays": plays}


def test_events_strengths_shootout_and_first_goal():
    plays = [
        play("faceoff", HOME),
        play("shot-on-goal", AWAY, goalieInNetId=31),  # home goalie 31 faces the first shot
        play("goal", AWAY, sit="1551", goalieInNetId=31),  # 5v5, scored first
        play("penalty", AWAY, typeCode="MIN", duration=2),
        play("goal", HOME, sit="1451", goalieInNetId=30),  # home 5 vs away 4: power play
        play("goal", HOME, sit="1560", goalieInNetId=None),  # home 6 skaters, own goalie pulled: not PP
        play("penalty", HOME, typeCode="MIS", duration=10),  # misconduct: no power play
        play("goal", HOME, period=5, ptype="SO", goalieInNetId=30),  # shootout: never counted
    ]
    rows = {r["team"]: r for r in _events(game(plays, 3, 1, "SO"))}
    h, a = rows["HOM"], rows["AWY"]
    assert (h["goals"], a["goals"]) == (2, 1)
    assert (a["goals_5v5"], h["pp_goals"], a["pp_goals_against"]) == (1, 1, 1)
    assert h["pen_drawn"] == 1 and h["pen_taken"] == 0
    assert a["scored_first"] and not h["scored_first"]
    assert h["win"] and h["points"] == 2 and a["points"] == 1 and h["decision"] == "SO"
    assert h["starter"] == 31 and h["fo_won"] == 1 and a["fo_lost"] == 1


def _team_games(n=6):
    rows = []
    for season, month in ((20242025, "10"), (20252026, "11")):
        for i in range(n):
            for team, opp, home in (("AAA", "BBB", True), ("BBB", "AAA", False)):
                win = (team == "AAA") == (i % 2 == 0)
                rows.append({"game_id": season * 100 + i, "season": season, "game_type": 2, "date": f"{season // 10000}-{month}-{10 + 2 * i:02d}",
                             "team": team, "opp": opp, "is_home": home, "win": win, "points": 2 if win else 0, "goals": 3 if win else 1,
                             "goals_against": 1 if win else 3, "xgf": 3.0, "xga": 2.0, "xgf_5v5": 2.0, "xga_5v5": 1.5, "pp_goals": 1, "pp_goals_against": 0,
                             "pen_drawn": 3, "pen_taken": 2, "fo_won": 30, "fo_lost": 25, "sog": 30, "sog_against": 25,
                             "starter": 31 if team == "AAA" else 32, "starter_xg_faced": 2.0, "starter_ga": 1})
    return pd.DataFrame(rows)


def test_pregame_features_never_look_ahead():
    """In any season after the first (the ones that are ever tested), a game's pre-game features
    depend only on earlier games: changing the season's last game changes nothing before it."""
    tg = _team_games()
    before = pregame(tg)
    changed = tg.copy()
    last = changed["game_id"] == changed["game_id"].max()
    changed.loc[last, ["goals", "xgf", "points"]] = [9, 9.0, 2]
    after = pregame(changed)
    cols = [*RATES, "goalie_sax_rate"]
    pd.testing.assert_frame_equal(before[cols].reset_index(drop=True), after[cols].reset_index(drop=True))
    assert before.iloc[0]["rest"] == 4  # first game: capped rest


def test_stints_and_event_at_a_change_goes_to_the_players_already_on():
    g = {"id": 7, "homeTeam": {"id": HOME}, "awayTeam": {"id": AWAY},
         "rosterSpots": [{"playerId": 30, "positionCode": "G"}, {"playerId": 31, "positionCode": "G"}]}
    shifts = [
        {"typeCode": 517, "period": 1, "startTime": "00:00", "endTime": "20:00", "playerId": 30, "teamId": HOME},
        {"typeCode": 517, "period": 1, "startTime": "00:00", "endTime": "20:00", "playerId": 31, "teamId": AWAY},
        {"typeCode": 517, "period": 1, "startTime": "00:00", "endTime": "00:40", "playerId": 11, "teamId": HOME},
        {"typeCode": 517, "period": 1, "startTime": "00:40", "endTime": "01:30", "playerId": 12, "teamId": HOME},
        {"typeCode": 517, "period": 1, "startTime": "00:00", "endTime": "01:30", "playerId": 21, "teamId": AWAY},
    ]
    st = pd.DataFrame(game_stints(g, shifts))
    assert list(zip(st["start"], st["end"], st["home_sk"])) == [(0, 40, (11,)), (40, 90, (12,))]
    st["n_home"], st["n_away"] = st["home_sk"].map(len), st["away_sk"].map(len)
    shots = pd.DataFrame([{"game_id": 7, "period": 1, "game_seconds": 40, "team": "HOM", "xg": 0.3, "goal": False, "shooting_skaters": 1, "defending_skaters": 1}])
    out, q = attach_shots(st, shots, {7: "HOM"})
    assert out.loc[0, "home_xg"] == 0.3 and out.loc[1, "home_xg"] == 0.0  # shot at 0:40 → player 11's stint
    assert q == {"shots_matched": 1, "strength_agreement": 1.0}


def test_rapm_finds_the_player_who_drives_chances():
    rng = np.random.default_rng(1)
    pool_h, pool_a = list(range(1, 11)), list(range(11, 21))
    rows = []
    for i in range(4000):
        hs, as_ = tuple(rng.choice(pool_h, 5, replace=False)), tuple(rng.choice(pool_a, 5, replace=False))
        dur = 60
        rate_h = 2.4 + (1.5 if 3 in hs else 0.0)  # player 3 adds 1.5 xG/60 for his team
        rows.append({"game_id": i // 40, "home_sk": hs, "away_sk": as_, "dur": dur, "diff": 0,
                     "home_xg": rng.poisson(rate_h * dur / 3600 * 20) / 20, "away_xg": rng.poisson(2.4 * dur / 3600 * 20) / 20})
    X, y, w, g, pl = design(pd.DataFrame(rows))
    m, alpha, _ = fit(X, y, w, g, alphas=(10.0, 100.0, 1000.0))
    c = coefficients(m, pl).set_index("player_id")
    assert c["off"].idxmax() == 3 and c.loc[3, "off"] > 0.5
