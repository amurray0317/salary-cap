import numpy as np
import pandas as pd

from rosteriq_models.prospects import draft_class as dc
from rosteriq_models.prospects.hockeytech import height_inches


def test_eligibility_windows_follow_the_sept_15_rule():
    # 2027: first eligible = born Sept 16, 2008 .. Sept 15, 2009; older North Americans from Jan 1, 2007.
    assert dc.first_eligible_window(2027) == ("2008-09-16", "2009-09-15")
    assert dc.older_eligible_window(2027) == ("2007-01-01", "2008-09-15")
    # The two windows meet without overlap.
    assert dc.older_eligible_window(2027)[1] < dc.first_eligible_window(2027)[0]


def test_height_formats_of_all_four_leagues():
    assert height_inches("6.01") == 73  # OHL
    assert height_inches("5'11\"") == 71  # WHL
    assert height_inches("6'02\"") == 74  # QMJHL
    assert height_inches("6'2.25\"") == 74  # USHL
    assert height_inches("") is None and height_inches(None) is None and height_inches("7'09\"") is None


def test_tiers_cover_every_probability():
    assert dc.tier_of(0.9) == (1, "Likely NHL player")
    assert dc.tier_of(0.40)[0] == 1
    assert dc.tier_of(0.39)[0] == 2
    assert dc.tier_of(0.08)[0] == 2
    assert dc.tier_of(0.079)[0] == 3
    assert dc.tier_of(0.0) == (3, "Unlikely on current numbers")


def _ht(rows):
    base = {"league": "OHL", "gp": 60, "goals": 20, "assists": 30, "points": 50, "pp_points": 10, "sh_points": 0, "shots": np.nan,
            "shots_gp": 0, "team_goal_share": 0.2, "teams": 1, "position": "C", "height_in": 72.0, "weight_lb": 180.0, "shoots": "L",
            "ppg": 50 / 60, "gpg": 20 / 60, "es_ppg": 40 / 60, "pp_ppg": 10 / 60, "shots_pg": np.nan, "ppg_rel": 2.0, "gpg_rel": 2.0,
            "es_ppg_rel": 2.0, "pp_ppg_rel": 2.0, "shots_pg_rel": np.nan}
    return pd.DataFrame([{**base, **r} for r in rows])


def test_cohort_keeps_first_time_eligible_with_a_prior_season_and_flags_short_seasons():
    ht = _ht([
        {"ht_id": "1", "name": "In Window", "birth_date": "2009-03-01", "season": "2025-26"},
        {"ht_id": "1", "name": "In Window", "birth_date": "2009-03-01", "season": "2024-25", "gp": 30, "ppg_rel": 1.1},
        {"ht_id": "2", "name": "Too Young", "birth_date": "2009-09-16", "season": "2025-26"},
        {"ht_id": "3", "name": "Too Old", "birth_date": "2008-09-15", "season": "2025-26"},
        {"ht_id": "4", "name": "Few Games", "birth_date": "2008-12-01", "season": "2025-26", "gp": 4},
        # Two leagues in one season: the one with more games is his season.
        {"ht_id": "5", "name": "Two Leagues", "birth_date": "2009-01-01", "season": "2025-26", "league": "USHL", "gp": 12},
        {"ht_id": "9", "name": "Two Leagues", "birth_date": "2009-01-01", "season": "2025-26", "league": "WHL", "gp": 40},
        {"ht_id": "6", "name": "No Birth Date", "birth_date": None, "season": "2025-26"},
    ])
    c = dc.cohort(ht, 2027, dc.first_eligible_window(2027)).set_index("name")
    assert set(c.index) == {"In Window", "Few Games", "Two Leagues"}
    assert c.loc["In Window", "dm2_ppg_rel"] == 1.1
    assert not c.loc["Few Games", "enough_games"]
    assert c.loc["Two Leagues", "league"] == "WHL"


def test_features_are_finite_and_complete():
    ht = _ht([{"ht_id": "1", "name": "A B", "birth_date": "2009-03-01", "season": "2025-26", "height_in": np.nan, "team_goal_share": np.nan}])
    c = dc.cohort(ht, 2027, dc.first_eligible_window(2027))
    c["age"] = 18.3
    X = dc.features(c, {"dm1_team_goal_share": 0.2, "height_in": 72.0, "weight_lb": 180.0})
    assert X.shape == (1, len(dc.FEATURE_NAMES))
    assert np.isfinite(X).all()
    assert X[0, dc.FEATURE_NAMES.index("size_missing")] == 1.0
