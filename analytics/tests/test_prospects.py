"""Prospect pipeline maths on controlled inputs (the real-data run is
checked by the train step's report and the model card)."""
import numpy as np
import pandas as pd

from rosteriq_models.prospects import dataset, nhle
from rosteriq_models.prospects.careers import clean_lines, season_id


def _simulated_careers(rng, true_f, growth=0.15, players=600):
    """Players move up a ladder of leagues at varied ages; PPG in a league =
    talent * exp(f_league) * exp(growth * years played). Birth years and the
    season of each move vary, so development and league difficulty can be
    told apart (as in real careers, where same-league seasons occur at
    every age)."""
    ladder = list(true_f)
    lines, bios = [], []
    for pid in range(players):
        talent = rng.lognormal(-0.6, 0.3)
        birth = int(rng.integers(1993, 1998))
        first = int(rng.integers(2012, 2016))
        level = int(rng.integers(0, len(ladder) - 1))
        switch = int(rng.integers(1, 4))
        bios.append({"player_id": pid, "birth_date": f"{birth}-06-01"})
        for k in range(5):
            lg = ladder[min(level + (k >= switch), len(ladder) - 1)]
            gp = int(rng.integers(40, 70))
            ppg = talent * np.exp(true_f[lg] + growth * k) * rng.lognormal(0, 0.1)
            lines.append({"player_id": pid, "season": season_id(first + k), "league": lg, "gp": gp, "goals": 0, "assists": 0, "points": int(round(ppg * gp))})
    return pd.DataFrame(bios), pd.DataFrame(lines)


def test_nhle_recovers_known_league_factors():
    rng = np.random.default_rng(7)
    true_f = {"JR": 2.0, "MID": 1.0, "NHL": 0.0}
    bio, lines = _simulated_careers(rng, true_f)
    table, report = nhle.estimate(nhle.build_pairs(lines, bio))
    got = dict(zip(table["league"], table["f"]))
    assert abs(got["JR"] - 2.0) < 0.1
    assert abs(got["MID"] - 1.0) < 0.1
    assert got["NHL"] == 0.0
    assert report["leagues_without_factor"] == []


def test_league_with_no_path_to_the_nhl_gets_no_factor():
    rng = np.random.default_rng(3)
    bio, lines = _simulated_careers(rng, {"JR": 2.0, "MID": 1.0, "NHL": 0.0})
    island = pd.DataFrame(
        [{"player_id": 10_000 + i, "season": season_id(2013 + k), "league": "ISLAND", "gp": 30, "goals": 0, "assists": 0, "points": 10}
         for i in range(40) for k in range(2)]
    )
    bio2 = pd.concat([bio, pd.DataFrame({"player_id": range(10_000, 10_040), "birth_date": "1995-06-01"})])
    table, report = nhle.estimate(nhle.build_pairs(pd.concat([lines, island]), bio2))
    assert "ISLAND" not in set(table["league"])
    assert "ISLAND" in report["leagues_without_factor"]


def test_clean_lines_merges_aliases_and_drops_tournaments():
    ln = pd.DataFrame([
        {"player_id": 1, "season": 20102011, "league": "Sweden", "gp": 20, "goals": 2, "assists": 3, "points": 5},
        {"player_id": 1, "season": 20102011, "league": "SHL", "gp": 10, "goals": 1, "assists": 1, "points": 2},
        {"player_id": 1, "season": 20102011, "league": "WJC-A", "gp": 6, "goals": 4, "assists": 2, "points": 6},
    ])
    out = clean_lines(ln)
    assert out.to_dict(orient="records") == [
        {"player_id": 1, "season": 20102011, "league": "SHL", "gp": 30, "goals": 3, "assists": 4, "points": 7}
    ]


def test_outcome_window_is_the_seven_seasons_after_the_draft():
    picks = pd.DataFrame([{
        "draft_year": 2010, "overall_pick": 50, "round": 2, "name": "Test Player", "draft_position": "C",
        "amateur_league": "OHL", "amateur_club": "X", "country": "CAN", "draft_height_in": 72, "draft_weight_lb": 190,
        "drafted_by": "CHI", "player_id": 1, "link_status": "linked",
    }])
    bio = pd.DataFrame([{"player_id": 1, "birth_date": "1992-05-01", "landing_position": "C", "shoots": "L"}])
    lines = pd.DataFrame(
        [{"player_id": 1, "season": season_id(2009), "league": "OHL", "gp": 60, "goals": 20, "assists": 30, "points": 50}]
        + [{"player_id": 1, "season": season_id(2010 + k), "league": "NHL", "gp": 30, "goals": 0, "assists": 0, "points": 0} for k in range(8)]
    )
    d = dataset.build(picks, bio, lines, {"OHL": 0.14, "NHL": 1.0}, last_complete_season=20252026)
    row = d.iloc[0]
    # 2010-11 .. 2016-17 count (7 x 30); 2017-18 does not.
    assert row["nhl_gp_7"] == 210 and row["nhl_regular"] == 1 and row["label_mature"]
    assert row["nhl_gp_to_date"] == 240
    assert abs(row["d0_nhle_ppg"] - 50 / 60 * 0.14) < 1e-9
    assert row["pos"] == "F"


def test_recent_drafts_have_no_label():
    picks = pd.DataFrame([{
        "draft_year": 2021, "overall_pick": 1, "round": 1, "name": "Recent", "draft_position": "D", "amateur_league": "WHL",
        "amateur_club": "X", "country": "CAN", "draft_height_in": 74, "draft_weight_lb": 200, "drafted_by": "BUF",
        "player_id": 2, "link_status": "linked",
    }])
    bio = pd.DataFrame([{"player_id": 2, "birth_date": "2003-01-01", "landing_position": "D", "shoots": "L"}])
    lines = pd.DataFrame([{"player_id": 2, "season": season_id(2020), "league": "WHL", "gp": 20, "goals": 5, "assists": 10, "points": 15}])
    d = dataset.build(picks, bio, lines, {"WHL": 0.14}, last_complete_season=20252026)
    assert not d.iloc[0]["label_mature"]


def test_central_scouting_linking_handles_transliterations_and_refuses_guesses():
    from rosteriq_models.prospects import css

    players = pd.DataFrame([
        {"draft_year": 2008, "name": "Slava Voynov", "birth_date": "1990-01-15"},     # transliteration
        {"draft_year": 2011, "name": "T.J. Tynan", "birth_date": "1992-02-25"},       # nickname, same last name
        {"draft_year": 2012, "name": "Some Player", "birth_date": "1994-03-03"},      # birthday twin, different name
    ])
    ranks = pd.DataFrame([
        {"draft_year": 2008, "css_list": "international", "css_name": "Vyacheslav Voinov", "css_last": "Voinov",
         "birth_date": "1990-01-15", "css_final": 8, "css_midterm": None},
        {"draft_year": 2011, "css_list": "north_american", "css_name": "Thomas Tynan", "css_last": "Tynan",
         "birth_date": "1992-02-25", "css_final": 210, "css_midterm": 150},
        {"draft_year": 2012, "css_list": "north_american", "css_name": "Other Person", "css_last": "Person",
         "birth_date": "1994-03-03", "css_final": 50, "css_midterm": 60},
    ])
    out, counts = css.link(players, ranks)
    assert out["css_final"].tolist()[:2] == [8.0, 210.0]
    assert pd.isna(out["css_final"].iloc[2])  # same birthday, dissimilar name: never linked
    assert counts["linked_last_name"] == 1 and counts["linked_similar_name"] == 1


def test_top_of_lineup_uses_league_wide_toi_rank_by_position_and_season_length():
    from rosteriq_models.prospects import lineup

    rows = []
    # Two teams, 10-game season: top-of-lineup = rank <= 2 x 6 forwards, 2 x 4 defence.
    for i in range(14):
        rows.append({"player_id": i, "season": 20202021, "pos": "F", "gp": 10, "toi_per_gp": 1000 - i, "teams": "AAA" if i % 2 else "BBB"})
    for i in range(10):
        rows.append({"player_id": 100 + i, "season": 20202021, "pos": "D", "gp": 10, "toi_per_gp": 1500 - i, "teams": "AAA" if i % 2 else "BBB"})
    # Most ice time of all but only 4 of 10 games: not qualified, so not top.
    rows.append({"player_id": 999, "season": 20202021, "pos": "F", "gp": 4, "toi_per_gp": 5000, "teams": "AAA"})
    # Traded mid-season: counts once, team list is not a team.
    rows.append({"player_id": 998, "season": 20202021, "pos": "F", "gp": 6, "toi_per_gp": 4000, "teams": "AAA,BBB"})
    usage, report = lineup.season_usage(pd.DataFrame(rows))
    top = set(usage.loc[usage["top_lineup"], "player_id"])
    assert top == set(range(11)) | {998} | set(range(100, 108))
    r = report.iloc[0]
    assert (r["teams"], r["season_games"], r["top_forwards"], r["top_defence"]) == (2, 10, 12, 8)


def test_junior_stats_match_by_birth_date_with_nickname_fallback_and_no_guessing():
    from rosteriq_models.prospects import v2

    ht = pd.DataFrame([
        # Draft-year (2015-16) and prior-season lines for a player listed as "Alex".
        {"league": "OHL", "ht_id": "1", "season": "2015-16", "name": "Alex Debrincat", "birth_date": "1997-12-18", "gp": 60, "ppg": 1.68, "es_ppg": 1.1, "pp_ppg": 0.5, "gpg": 0.8, "team_goal_share": 0.36, "shots_pg": 4.0},
        {"league": "OHL", "ht_id": "1", "season": "2014-15", "name": "Alex Debrincat", "birth_date": "1997-12-18", "gp": 68, "ppg": 1.51, "es_ppg": 1.0, "pp_ppg": 0.4, "gpg": 0.75, "team_goal_share": 0.3, "shots_pg": 3.5},
        # Two different players share a last name and birth date: never guessed.
        {"league": "WHL", "ht_id": "2", "season": "2015-16", "name": "Sam Smith", "birth_date": "1998-01-01", "gp": 60, "ppg": 1.0, "es_ppg": 0.8, "pp_ppg": 0.2, "gpg": 0.4, "team_goal_share": 0.2, "shots_pg": 2.0},
        {"league": "WHL", "ht_id": "3", "season": "2015-16", "name": "Jon Smith", "birth_date": "1998-01-01", "gp": 55, "ppg": 0.5, "es_ppg": 0.4, "pp_ppg": 0.1, "gpg": 0.2, "team_goal_share": 0.1, "shots_pg": 1.0},
        # Too few games to count as a draft-year line.
        {"league": "USHL", "ht_id": "4", "season": "2015-16", "name": "Short Season", "birth_date": "1998-05-05", "gp": 6, "ppg": 2.0, "es_ppg": 2.0, "pp_ppg": 0.0, "gpg": 1.0, "team_goal_share": 0.1, "shots_pg": 3.0},
    ])
    pop = pd.DataFrame([
        {"name": "Alexander DeBrincat", "last_name": "DeBrincat", "birth_date": "1997-12-18", "rank_year": 2016},
        {"name": "Samuel Smith", "last_name": "Smith", "birth_date": "1998-01-01", "rank_year": 2016},
        {"name": "Short Season", "last_name": "Season", "birth_date": "1998-05-05", "rank_year": 2016},
    ])
    out = v2.attach_junior_stats(pop, ht)
    assert out.loc[0, "d0_league"] == "OHL" and out.loc[0, "d0_ppg"] == 1.68 and out.loc[0, "dm1_ppg"] == 1.51
    assert pd.isna(out.loc[1, "d0_ppg"])  # ambiguous last name + birth date
    assert pd.isna(out.loc[2, "d0_ppg"])  # under MIN_GP
