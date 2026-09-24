"""Model features for the xG model, and which shots are modelled.

Modelled population: unblocked attempts (shots on goal, misses, goals) with
a goalie in the defending net, excluding penalty shots (1 skater v 0).
Empty-net attempts are NOT modelled; they are reported separately.

Every model column belongs to one explanation GROUP. Per-shot contributions
are summed per group, so a shot's xG breaks down into a handful of readable
reasons (distance, angle, shot type, rebound, ...), not dozens of columns.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

PREV_EVENT_KEEP = ["faceoff", "hit", "giveaway", "takeaway", "blocked-shot", "missed-shot", "shot-on-goal", "stoppage", "delayed-penalty"]
STRENGTHS = ["5v5", "5v4", "4v5", "5v3", "4v4", "3v3", "6v5", "6v4", "3v4", "4v3"]
MIN_CATEGORY_COUNT = 300

GROUPS = {
    "distance": "Distance",
    "angle": "Angle",
    "shot_type": "Shot type",
    "rebound": "Rebound",
    "rush": "Rush",
    "prev_event": "Play before the shot",
    "strength": "Strength state",
    "score": "Score state",
    "off_wing": "Off-wing",
    "position": "Shooter position",
    "period": "Period",
    "venue": "Home/away",
}


def modelled(df: pd.DataFrame) -> pd.Series:
    penalty_shot = (df["shooting_skaters"] == 1) & (df["defending_skaters"] == 0)
    return ~df["empty_net"] & ~penalty_shot


def strength_label(df: pd.DataFrame) -> pd.Series:
    lab = df["shooting_skaters"].astype(str) + "v" + df["defending_skaters"].astype(str)
    return lab.where(lab.isin(STRENGTHS), "other")


@dataclass
class FeatureSpec:
    """Category levels learned from the training seasons (stored with the model)."""

    shot_types: list[str] = field(default_factory=list)
    prev_events: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)

    @classmethod
    def fit(cls, df: pd.DataFrame) -> "FeatureSpec":
        def levels(s: pd.Series) -> list[str]:
            vc = s.value_counts()
            return sorted(vc[vc >= MIN_CATEGORY_COUNT].index.tolist())

        return cls(
            shot_types=levels(df["shot_type"]),
            prev_events=levels(_prev_event(df)),
            strengths=levels(strength_label(df)),
        )

    def to_dict(self) -> dict:
        return {"shot_types": self.shot_types, "prev_events": self.prev_events, "strengths": self.strengths}


def _prev_event(df: pd.DataFrame) -> pd.Series:
    ev = df["prev_event"].fillna("none")
    ev = ev.where(ev.isin(PREV_EVENT_KEEP), "other")
    same = df["prev_team_same"].map({True: "own", False: "opp"}).fillna("na")
    # Who did the last event matters for shots, giveaways and takeaways.
    team_aware = ev.isin(["blocked-shot", "missed-shot", "shot-on-goal", "giveaway", "takeaway", "faceoff", "hit"])
    return ev.where(~team_aware, ev + "_" + same)


def design(df: pd.DataFrame, spec: FeatureSpec) -> tuple[pd.DataFrame, dict[str, str]]:
    """Returns (X, column -> group). Numeric columns are raw (no scaling);
    missing context gets an explicit indicator, never a silent fill."""
    X = pd.DataFrame(index=df.index)
    group: dict[str, str] = {}

    def add(name: str, values, g: str):
        X[name] = np.asarray(values, dtype=float)
        group[name] = g

    add("distance", df["distance"], "distance")
    add("angle", df["angle"], "angle")
    add("abs_y", df["y"].abs(), "angle")
    add("behind_net", (df["x"] > 89).astype(float), "angle")

    st = df["shot_type"].where(df["shot_type"].isin(spec.shot_types), "other")
    for lvl in spec.shot_types + ["other"]:
        add(f"type_{lvl}", st == lvl, "shot_type")

    add("rebound", df["rebound"].astype(float), "rebound")
    add("rebound_angle_change", df["rebound_angle_change"].fillna(0.0).clip(0, 180), "rebound")
    add("rush", df["rush"].astype(float), "rush")

    pe = _prev_event(df)
    pe = pe.where(pe.isin(spec.prev_events), "other")
    for lvl in spec.prev_events + ["other"]:
        add(f"prev_{lvl}", pe == lvl, "prev_event")
    has_dt = df["prev_dt"].notna()
    add("prev_dt_log", np.log1p(df["prev_dt"].fillna(0).clip(0, 300)), "prev_event")
    add("prev_dt_missing", ~has_dt, "prev_event")
    has_pd = df["prev_distance"].notna()
    add("prev_distance", df["prev_distance"].fillna(0).clip(0, 200), "prev_event")
    add("prev_distance_missing", ~has_pd, "prev_event")
    speed = (df["prev_distance"] / df["prev_dt"].where(df["prev_dt"] > 0)).clip(0, 200)
    add("prev_speed", speed.fillna(0), "prev_event")

    sl = strength_label(df)
    sl = sl.where(sl.isin(spec.strengths), "other")
    for lvl in spec.strengths + ["other"]:
        add(f"str_{lvl}", sl == lvl, "strength")
    add("shooting_goalie_pulled", df["shooting_goalie_pulled"].astype(float), "strength")

    add("score_diff", df["score_diff"].clip(-3, 3), "score")

    for lvl in ["on", "off", "centre", "unknown"]:
        add(f"wing_{lvl}", df["off_wing"] == lvl, "off_wing")

    pos = df["shooter_position"].map({"D": "D", "C": "F", "L": "F", "R": "F"}).fillna("unknown")
    for lvl in ["F", "D", "unknown"]:
        add(f"pos_{lvl}", pos == lvl, "position")

    per = df["period"].clip(1, 4)
    for lvl in [1, 2, 3, 4]:
        add(f"period_{lvl}", per == lvl, "period")

    add("is_home", df["is_home"].astype(float), "venue")
    return X, group
