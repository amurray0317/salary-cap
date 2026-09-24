"""Model mechanics on the recorded real game. 90 shots is far too few to
judge accuracy (that is done on full seasons by the evaluate step); these
tests pin down the explanation maths, which must hold for any data."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from rosteriq_models.xg import model as m
from rosteriq_models.xg.build import build_season  # noqa: F401  (import check)
from rosteriq_models.xg.features import GROUPS, FeatureSpec, design, modelled
from rosteriq_models.xg.shots import parse_game

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def shots():
    df = pd.DataFrame(parse_game(json.loads((FIX / "nhl_pbp_2024020001.json").read_text())).shots)
    df["off_wing"] = "unknown"
    return df[modelled(df)].reset_index(drop=True)


@pytest.fixture(scope="module")
def fitted(shots):
    small = dict(m.GBM_PARAMS, min_child_weight=1)
    old = m.GBM_PARAMS
    m.GBM_PARAMS = small
    try:
        model, _ = m.fit(shots, shots, C_grid=(1.0,), max_trees=40)
    finally:
        m.GBM_PARAMS = old
    return model


def test_modelled_population_excludes_empty_net(shots):
    assert not shots["empty_net"].any()


def test_design_has_no_missing_values_and_every_column_has_a_group(shots):
    X, groups = design(shots, FeatureSpec.fit(shots))
    assert not X.isna().any().any()
    assert set(groups) == set(X.columns)
    assert set(groups.values()) <= set(GROUPS)


def test_fixture_model_exercises_the_boosted_trees(fitted):
    assert fitted.n_trees > 0 and fitted.booster is not None


def test_logit_contributions_sum_exactly_to_model_logit(fitted, shots):
    baseline, contrib = m.logit_contributions(fitted, shots)
    np.testing.assert_allclose(baseline + contrib.sum(axis=1).to_numpy(), fitted.logit(shots), atol=1e-4)


def test_goal_unit_contributions_sum_exactly_to_xg_minus_baseline(fitted, shots):
    e = m.explain(fitted, shots)
    parts = e[list(GROUPS)].sum(axis=1)
    np.testing.assert_allclose(parts + e["baseline_xg"], e["xg"], atol=1e-6)
    np.testing.assert_allclose(e["xg"], fitted.predict(shots), atol=1e-4)

