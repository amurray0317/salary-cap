"""Write import-ready model outputs to models/<version>/ (committed).

    python -m rosteriq_models.export

Each import_*.csv has EXACTLY the app's import-definition field keys as its
header (src/lib/import/connectorDefinitions.ts); the app refuses a file
whose columns differ. metrics.json (the model card) and the production
model files are copied alongside.
"""
from __future__ import annotations

import json
import shutil

import numpy as np
import pandas as pd

from rosteriq_models.prospects.model import GROUPS_STATS, MODEL_VERSION as PROSPECT_VERSION
from rosteriq_models.raw import OUT, REPO
from rosteriq_models.xg.features import GROUPS as XG_GROUPS
from rosteriq_models.xg.model import MODEL_VERSION as XG_VERSION

MODELS = REPO / "models"
POSITION = {"C": "C", "L": "LW", "R": "RW", "D": "D", "G": "G"}
# Goalie rows are labelled from the goalie's team's point of view.
GOALIE_SITUATION = {"all": "all", "5on5": "5on5", "5on4": "4on5", "4on5": "5on4"}


def season_label(s: int) -> str:
    start = s // 10000
    return f"{start}-{(start + 1) % 100:02d}"


def _num(x, digits=4):
    return "" if pd.isna(x) else round(float(x), digits)


def _int(x):
    return "" if pd.isna(x) else int(x)


def export_xg() -> dict[str, int]:
    src = OUT / "xg" / XG_VERSION
    dst = MODELS / XG_VERSION
    dst.mkdir(parents=True, exist_ok=True)

    p = pd.read_csv(src / "player_seasons.csv")
    p = p[p["position"] != "G"]
    sk = pd.DataFrame({
        "external_player_id": p["player_id"].astype(int),
        "player_name": p["name"],
        "season": p["season"].map(season_label),
        "game_type": p["game_type"],
        "league": "NHL",
        "team_name": p["last_team"],
        "position": p["position"].map(POSITION),
        "situation": p["situation"],
        "goals": (p["goals"] + p["empty_net_goals"]).astype(int),
        "x_goals": p["ixg"].map(_num),
        "m_unblocked_attempts": p["shots"].astype(int),
        "m_goals_non_empty_net": p["goals"].astype(int),
        "m_goals_minus_xg": (p["goals"] - p["ixg"]).map(_num),
        "m_baseline_xg": p["baseline_xg"].map(_num),
        **{f"m_xg_from_{g}": p[f"ixg_from_{g}"].map(_num) for g in XG_GROUPS},
        "m_empty_net_attempts": p["empty_net_shots"].astype(int),
        "m_empty_net_goals": p["empty_net_goals"].astype(int),
    })
    sk.to_csv(dst / "import_xg_skaters.csv", index=False)

    g = pd.read_csv(src / "goalie_seasons.csv")
    go = pd.DataFrame({
        "external_player_id": g["player_id"].astype(int),
        "player_name": g["name"],
        "season": g["season"].map(season_label),
        "game_type": g["game_type"],
        "league": "NHL",
        "team_name": g["last_team"],
        "position": "G",
        "situation": g["situation"].map(GOALIE_SITUATION),
        "goals_against": g["goals_against"].astype(int),
        "x_goals": g["xg_against"].map(_num),
        "m_unblocked_shots_against": g["shots_against"].astype(int),
        "m_gsax": g["gsax"].map(_num),
    })
    go.to_csv(dst / "import_xg_goalies.csv", index=False)

    t = pd.read_csv(src / "team_seasons.csv")
    tot = t["xg_for"] + t["xg_against"]
    te = pd.DataFrame({
        "team_abbrev": t["team"],
        "season": t["season"].map(season_label),
        "game_type": t["game_type"],
        "situation": t["situation"],
        "goals_for": t["goals_for"].astype(int),
        "goals_against": t["goals_against"].astype(int),
        "x_goals_for": t["xg_for"].map(_num),
        "x_goals_against": t["xg_against"].map(_num),
        "x_goals_pct": (t["xg_for"] / tot.where(tot > 0)).map(_num),
        "m_unblocked_for": t["shots_for"].astype(int),
        "m_unblocked_against": t["shots_against"].astype(int),
    })
    te.to_csv(dst / "import_xg_teams.csv", index=False)

    shutil.copy(src / "metrics.json", dst / "metrics.json")
    if (dst / "production").exists():
        shutil.rmtree(dst / "production")
    shutil.copytree(src / "production", dst / "production")
    return {"skaters": len(sk), "goalies": len(go), "teams": len(te)}


def export_prospects() -> dict[str, int]:
    src = OUT / "prospects" / PROSPECT_VERSION
    dst = MODELS / PROSPECT_VERSION
    dst.mkdir(parents=True, exist_ok=True)
    d = pd.read_csv(src / "prospects.csv")
    pr = pd.DataFrame({
        "external_player_id": d["player_id"].astype(int),
        "player_name": d["name"],
        "draft_year": d["draft_year"].astype(int),
        "overall_pick": d["overall_pick"].astype(int),
        "round": d["round"].map(_int),
        "position": d["pos"],
        "drafted_by": d["drafted_by"].fillna(""),
        "birth_date": d["birth_date"].fillna(""),
        "age_at_draft": d["age_at_draft"].map(lambda x: _num(x, 2)),
        "height_inches": d["draft_height_in"].map(_int),
        "weight_pounds": d["draft_weight_lb"].map(_int),
        "d0_league": d["d0_main_league"].fillna(""),
        "d0_league_group": d["d0_league_group"].fillna(""),
        "d0_games_played": d["d0_gp"].map(_int),
        "d0_points": d["d0_points"].map(_int),
        "d0_ppg": d["d0_ppg"].map(_num),
        "d0_nhle_ppg": d["d0_nhle_ppg"].map(_num),
        "dm1_league": d["dm1_main_league"].fillna(""),
        "dm1_games_played": d["dm1_gp"].map(_int),
        "dm1_points": d["dm1_points"].map(_int),
        "dm1_nhle_ppg": d["dm1_nhle_ppg"].map(_num),
        "p_nhl_regular": d["p_nhl_regular"].map(_num),
        "baseline_p": d["baseline_p"].map(_num),
        **{f"m_contrib_{g}": d[f"contrib_{g}"].map(_num) for g in GROUPS_STATS},
        "projection_kind": d["projection"],
        "label_mature": d["label_mature"].map({True: "true", False: "false"}),
        "nhl_regular": np.where(d["label_mature"], d["nhl_regular"].map({1: "true", 0: "false"}), ""),
        "nhl_gp_7": np.where(d["label_mature"], d["nhl_gp_7"].astype(int).astype(str), ""),
        "nhl_gp_to_date": d["nhl_gp_to_date"].astype(int),
        "model_version": PROSPECT_VERSION,
    })
    pr.to_csv(dst / "import_prospects.csv", index=False)

    f = pd.read_csv(src / "league_factors.csv")
    lf = pd.DataFrame({
        "league": f["league"],
        "multiplier": f["nhle_multiplier"].map(_num),
        "log_factor": f["f"].map(_num),
        "standard_error": f["se"].map(_num),
        "pairs": f["pairs"].astype(int),
        "model_version": PROSPECT_VERSION,
    })
    lf.to_csv(dst / "import_league_factors.csv", index=False)
    shutil.copy(src / "metrics.json", dst / "metrics.json")
    if (dst / "production").exists():
        shutil.rmtree(dst / "production")
    shutil.copytree(src / "production", dst / "production")
    return {"prospects": len(pr), "leagues": len(lf)}


if __name__ == "__main__":
    out = {}
    if (OUT / "xg" / XG_VERSION / "metrics.json").exists():
        out["xg"] = export_xg()
    if (OUT / "prospects" / PROSPECT_VERSION / "metrics.json").exists():
        out["prospects"] = export_prospects()
    if not out:
        raise SystemExit("nothing to export: run the xg and/or prospects train steps first")
    print(json.dumps(out))
