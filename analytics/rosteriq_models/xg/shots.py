"""Parse NHL play-by-play (api-web.nhle.com /v1/gamecenter/{id}/play-by-play)
into one row per unblocked shot attempt (shot on goal, missed shot, goal).

Conventions, all checked against real games (see tests):
  * Coordinates are feet from centre ice. Each row is normalised so the
    shooting team attacks the net at (+89, 0). Direction comes from the
    feed's `homeTeamDefendingSide`. When the feed omits it, direction is
    inferred from where that team's shots cluster in that period, and the
    row says so in `direction_source`.
  * `situationCode` is four digits: away goalie in net, away skaters,
    home skaters, home goalie in net.
  * A blocked shot's `eventOwnerTeamId` is the SHOOTING team.
  * Score state is the score BEFORE the shot (a goal's own score fields are
    the score after it).

Rows are never dropped silently: anything that cannot be parsed is returned
in `rejects` with a reason.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median
from typing import Any

FENWICK = {"shot-on-goal", "missed-shot", "goal"}
ATTEMPTS = FENWICK | {"blocked-shot"}
NET_X = 89.0
OFFENSIVE_BLUE_LINE_X = 25.0
REBOUND_SECONDS = 3
RUSH_SECONDS = 4
# A rush is a transition off live play: the previous event is a turnover,
# hit, block or shot outside the offensive zone. Faceoffs and stoppages are
# excluded (in 2025-26, 488 attempts within 4 s of a non-offensive-zone
# faceoff produced no goals).
RUSH_PREV_EVENTS = {"takeaway", "giveaway", "hit", "blocked-shot", "missed-shot", "shot-on-goal"}


@dataclass
class ParsedGame:
    shots: list[dict[str, Any]] = field(default_factory=list)
    rejects: list[dict[str, Any]] = field(default_factory=list)


def game_seconds(play: dict[str, Any]) -> int:
    period = int(play["periodDescriptor"]["number"])
    m, s = str(play["timeInPeriod"]).split(":")
    return (period - 1) * 1200 + int(m) * 60 + int(s)


def parse_situation(code: Any) -> tuple[int, int, int, int] | None:
    """-> (away_goalie, away_skaters, home_skaters, home_goalie) or None."""
    if not isinstance(code, str) or len(code) != 4 or not code.isdigit():
        return None
    return int(code[0]), int(code[1]), int(code[2]), int(code[3])


def _feed_sign(play: dict[str, Any], shooter_is_home: bool) -> int | None:
    side = play.get("homeTeamDefendingSide")
    if side not in ("left", "right"):
        return None
    home_attacks_right = side == "left"
    attacks_right = home_attacks_right if shooter_is_home else not home_attacks_right
    return 1 if attacks_right else -1


def _signed_angle(xn: float, yn: float) -> float:
    return math.degrees(math.atan2(yn, NET_X - xn))


def parse_game(game: dict[str, Any], handedness: dict[int, str] | None = None) -> ParsedGame:
    handedness = handedness or {}
    out = ParsedGame()
    game_id = int(game["id"])
    home_id = int(game["homeTeam"]["id"])
    away_id = int(game["awayTeam"]["id"])
    positions = {int(r["playerId"]): r.get("positionCode") for r in game.get("rosterSpots", [])}
    plays = sorted(game.get("plays", []), key=lambda p: p.get("sortOrder", 0))

    # Fallback direction per (period, team): median x of that team's attempts.
    xs: dict[tuple[int, int], list[float]] = {}
    for p in plays:
        d = p.get("details") or {}
        if p.get("typeDescKey") in ATTEMPTS and "xCoord" in d and "eventOwnerTeamId" in d:
            xs.setdefault((p["periodDescriptor"]["number"], int(d["eventOwnerTeamId"])), []).append(float(d["xCoord"]))
    inferred = {k: (1 if median(v) >= 0 else -1) for k, v in xs.items() if v}

    home_score = away_score = 0
    prev: dict[str, Any] | None = None
    for p in plays:
        kind = p.get("typeDescKey")
        d = p.get("details") or {}
        period_type = (p.get("periodDescriptor") or {}).get("periodType")
        if kind in FENWICK and period_type != "SO":
            row = _shot_row(p, d, prev, game, game_id, home_id, away_id, home_score, away_score, positions, handedness, inferred)
            (out.shots if "reject_reason" not in row else out.rejects).append(row)
        if kind == "goal" and period_type != "SO":
            home_score = int(d.get("homeScore", home_score))
            away_score = int(d.get("awayScore", away_score))
        if kind not in ("period-end", "game-end"):
            prev = p
    return out


def _shot_row(p, d, prev, game, game_id, home_id, away_id, home_score, away_score, positions, handedness, inferred):
    kind = p["typeDescKey"]
    base = {"game_id": game_id, "event_id": p.get("eventId"), "sort_order": p.get("sortOrder"), "event": kind}
    shooter = d.get("scoringPlayerId") if kind == "goal" else d.get("shootingPlayerId")
    team = d.get("eventOwnerTeamId")
    if shooter is None or team is None:
        return {**base, "reject_reason": "missing shooter or team"}
    if "xCoord" not in d or "yCoord" not in d:
        return {**base, "reject_reason": "missing coordinates"}
    team = int(team)
    if team not in (home_id, away_id):
        return {**base, "reject_reason": "event team is neither home nor away"}
    is_home = team == home_id
    period = int(p["periodDescriptor"]["number"])

    sign = _feed_sign(p, is_home)
    direction_source = "feed"
    if sign is None:
        sign = inferred.get((period, team))
        direction_source = "inferred"
    if sign is None:
        return {**base, "reject_reason": "attack direction unknown"}

    xn, yn = sign * float(d["xCoord"]), sign * float(d["yCoord"])
    sit = parse_situation(p.get("situationCode"))
    if sit is None:
        return {**base, "reject_reason": "missing situation code"}
    away_g, away_sk, home_sk, home_g = sit
    shoot_sk, def_sk = (home_sk, away_sk) if is_home else (away_sk, home_sk)
    def_goalie_in = (away_g if is_home else home_g) == 1
    shoot_goalie_in = (home_g if is_home else away_g) == 1
    t = game_seconds(p)

    # Previous event context (same period only).
    prev_kind = prev_team_same = prev_dt = prev_xn = prev_yn = None
    if prev is not None and prev["periodDescriptor"]["number"] == period:
        pd_ = prev.get("details") or {}
        prev_kind = prev.get("typeDescKey")
        if pd_.get("eventOwnerTeamId") is not None:
            prev_team_same = int(pd_["eventOwnerTeamId"]) == team
        prev_dt = t - game_seconds(prev)
        if "xCoord" in pd_ and "yCoord" in pd_:
            prev_xn, prev_yn = sign * float(pd_["xCoord"]), sign * float(pd_["yCoord"])

    distance = math.hypot(NET_X - xn, yn)
    angle_signed = _signed_angle(xn, yn)
    is_rebound = bool(prev_kind in ATTEMPTS and prev_team_same and prev_dt is not None and prev_dt <= REBOUND_SECONDS)
    is_rush = bool(
        prev_kind in RUSH_PREV_EVENTS
        and prev_xn is not None
        and prev_xn < OFFENSIVE_BLUE_LINE_X
        and prev_dt is not None
        and prev_dt <= RUSH_SECONDS
    )
    prev_dist = math.hypot(xn - prev_xn, yn - prev_yn) if prev_xn is not None else None
    angle_change = None
    if is_rebound and prev_xn is not None:
        angle_change = abs(angle_signed - _signed_angle(prev_xn, prev_yn))

    shooter = int(shooter)
    hand = handedness.get(shooter)
    pos = positions.get(shooter)
    score_for, score_against = (home_score, away_score) if is_home else (away_score, home_score)
    return {
        **base,
        "season": int(game["season"]),
        "game_type": int(game["gameType"]),
        "period": period,
        "period_type": p["periodDescriptor"].get("periodType"),
        "game_seconds": t,
        "team_id": team,
        "is_home": is_home,
        "shooter_id": shooter,
        "shooter_position": pos,
        "shooter_hand": hand,
        "goalie_id": d.get("goalieInNetId"),
        "x": xn,
        "y": yn,
        "direction_source": direction_source,
        "distance": distance,
        "angle": abs(angle_signed),
        "angle_signed": angle_signed,
        "shot_type": d.get("shotType") or "unknown",
        "shooting_skaters": shoot_sk,
        "defending_skaters": def_sk,
        "empty_net": not def_goalie_in,
        "shooting_goalie_pulled": not shoot_goalie_in,
        "score_diff": score_for - score_against,
        "prev_event": prev_kind,
        "prev_team_same": prev_team_same,
        "prev_dt": prev_dt,
        "prev_distance": prev_dist,
        "rebound": is_rebound,
        "rush": is_rush,
        "rebound_angle_change": angle_change,
        "on_goal": kind in ("shot-on-goal", "goal"),
        "goal": kind == "goal",
    }
