"""Train RosterIQ xG, evaluate it against MoneyPuck, export season totals.

    python -m rosteriq_models.xg.train \
        --train 20212022,20222023,20232024 --valid 20242025 --test 20252026

Steps
  A. Selection: fit on --train, choose LR C and the number of trees on --valid.
  B. Test: refit on train+valid, score --test (never seen before), compare
     with MoneyPuck's xGoal on the same shots.
  C. Season totals: each season is scored by a model trained on the OTHER
     seasons (leave-one-season-out), so every exported total is
     out-of-sample. For the test season this is exactly the step-B model.
  D. Production model: refit on every season, for scoring future games.

Outputs go to .data/models/xg/<version>/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, roc_auc_score

from rosteriq_models import benchmark
from rosteriq_models.raw import OUT
from rosteriq_models.xg import model as m
from rosteriq_models.xg.build import build_season
from rosteriq_models.xg.features import GROUPS, modelled, strength_label

GROUP_COLS = list(GROUPS)


def load(season: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    folder = OUT / "xg"
    f, pf = folder / f"shots_{season}.parquet", folder / f"players_{season}.parquet"
    if not f.exists() or not pf.exists():
        df, players, report = build_season(season)
        folder.mkdir(parents=True, exist_ok=True)
        df.to_parquet(f, index=False)
        players.to_parquet(pf, index=False)
        (folder / f"shots_{season}.report.json").write_text(json.dumps(report, indent=1))
    return pd.read_parquet(f), pd.read_parquet(pf)


def scores(y: np.ndarray, p: np.ndarray) -> dict:
    return {
        "shots": int(len(y)),
        "goals": int(y.sum()),
        "xg": round(float(p.sum()), 1),
        "xg_per_goal": round(float(p.sum() / y.sum()), 4),
        "log_loss": round(m.logloss(y, p), 5),
        "auc": round(float(roc_auc_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 5),
    }


def join_moneypuck(df: pd.DataFrame, season: int) -> tuple[pd.DataFrame, dict]:
    """Attach MoneyPuck xGoal on (game, game-second, shooter). Reports match rates both ways."""
    mp = benchmark.load_shots(season // 10000)
    # Two attempts by one shooter in the same game-second are told apart by
    # their order (our sort order, MoneyPuck's event number).
    key = ["nhl_game_id", "game_seconds", "shooter_id", "key_seq"]
    ours = df.rename(columns={"game_id": "nhl_game_id"}).sort_values(["nhl_game_id", "sort_order"])
    ours["key_seq"] = ours.groupby(key[:3]).cumcount()
    ours = ours.sort_index()
    dup_mp = int(mp.duplicated(key).sum())
    dup_ours = int(ours.duplicated(key).sum())
    j = ours.merge(mp[key + ["xGoal", "goal", "shotOnEmptyNet", "offWing", "shotRebound", "shotRush"]], on=key, how="left", suffixes=("", "_mp"))
    matched = j["xGoal"].notna()
    report = {
        "our_shots": int(len(ours)),
        "moneypuck_shots": int(len(mp)),
        "matched": int(matched.sum()),
        "matched_share_of_ours": round(float(matched.mean()), 4),
        "matched_share_of_moneypuck": round(float(matched.sum() / max(len(mp), 1)), 4),
        # When only modelled shots are passed (goalie in net), compare with
        # MoneyPuck's goalie-in-net shots too.
        "matched_share_of_moneypuck_goalie_in_net": round(float(matched.sum() / max(int((mp["shotOnEmptyNet"] == 0).sum()), 1)), 4),
        "duplicate_keys": {"moneypuck": dup_mp, "ours": dup_ours},
        "goal_label_agreement": round(float((j.loc[matched, "goal"].astype(int) == j.loc[matched, "goal_mp"].astype(int)).mean()), 5),
        "empty_net_agreement": round(float((j.loc[matched, "empty_net"].astype(int) == j.loc[matched, "shotOnEmptyNet"].astype(int)).mean()), 5),
    }
    known = matched & j["off_wing"].isin(["on", "off"])
    report["off_wing_agreement"] = round(float(((j.loc[known, "off_wing"] == "off").astype(int) == j.loc[known, "offWing"].astype(int)).mean()), 4)
    report["rebound_agreement"] = round(float((j.loc[matched, "rebound"].astype(int) == j.loc[matched, "shotRebound"].astype(int)).mean()), 4)
    report["rush_agreement"] = round(float((j.loc[matched, "rush"].astype(int) == j.loc[matched, "shotRush"].astype(int)).mean()), 4)
    return j.drop(columns=["key_seq"]).rename(columns={"nhl_game_id": "game_id", "xGoal": "mp_xg"}), report


def calibration(df: pd.DataFrame, by: pd.Series, name: str) -> list[dict]:
    rows = []
    for lvl, g in df.groupby(by, observed=True):
        rows.append({
            name: str(lvl),
            "shots": int(len(g)),
            "goal_rate": round(float(g["goal"].mean()), 4),
            "rosteriq": round(float(g["xg"].mean()), 4),
            "moneypuck": round(float(g["mp_xg"].mean()), 4) if "mp_xg" in g and g["mp_xg"].notna().all() else None,
        })
    return rows


def situations_for_shooter(df: pd.DataFrame) -> pd.Series:
    return df["shooting_skaters"].astype(str) + "on" + df["defending_skaters"].astype(str)


def season_totals(df: pd.DataFrame, ex: pd.DataFrame, players: pd.DataFrame, season: int) -> dict[str, pd.DataFrame]:
    """Aggregates per player / team / goalie. `df` is ALL unblocked attempts
    (incl. empty-net); `ex` is the explanation for the modelled subset."""
    mod = modelled(df)
    d = df.copy()
    d["xg"] = np.nan
    d.loc[mod, "xg"] = ex["xg"].to_numpy()
    for g in GROUP_COLS:
        d[f"c_{g}"] = 0.0
        d.loc[mod, f"c_{g}"] = ex[g].to_numpy()
    d["baseline_xg"] = 0.0
    d.loc[mod, "baseline_xg"] = ex["baseline_xg"].to_numpy()
    d["modelled"] = mod
    out = {"player": [], "team": [], "goalie": []}
    for game_type, label_gt in ((2, "regular"), (3, "playoffs")):
        part = d[d["game_type"] == game_type]
        if part.empty:
            continue
        res = _totals_for(part, players)
        for k, v in res.items():
            v.insert(0, "game_type", label_gt)
            v.insert(0, "season", season)
            out[k].append(v)
    return {k: pd.concat(v, ignore_index=True) for k, v in out.items()}


def _totals_for(d: pd.DataFrame, players: pd.DataFrame) -> dict[str, pd.DataFrame]:
    sit = situations_for_shooter(d)
    frames = {"all": d, "5on5": d[sit == "5on5"], "5on4": d[sit == "5on4"], "4on5": d[sit == "4on5"]}

    player_rows, team_rows, goalie_rows = [], [], []
    for label, f in frames.items():
        fm = f[f["modelled"]]
        pg = fm.groupby("shooter_id")
        agg = pd.DataFrame({
            "shots": pg.size(),
            "goals": pg["goal"].sum(),
            "ixg": pg["xg"].sum(),
            "baseline_xg": pg["baseline_xg"].sum(),
            **{f"ixg_from_{g}": pg[f"c_{g}"].sum() for g in GROUP_COLS},
        })
        en = f[f["empty_net"]].groupby("shooter_id")
        agg["empty_net_shots"] = en.size()
        agg["empty_net_goals"] = en["goal"].sum()
        agg = agg.fillna({"empty_net_shots": 0, "empty_net_goals": 0, "shots": 0, "goals": 0})
        agg["situation"] = label
        player_rows.append(agg.reset_index().rename(columns={"shooter_id": "player_id"}))

        for side, team_col in (("for", "team"), ("against", "opp_team")):
            tg = fm.groupby(team_col)
            t = pd.DataFrame({f"shots_{side}": tg.size(), f"goals_{side}": tg["goal"].sum(), f"xg_{side}": tg["xg"].sum()})
            t.index.name = "team"
            team_rows.append((label, side, t))

        gg = fm[fm["goalie_id"].notna()].groupby("goalie_id")
        gl = pd.DataFrame({"shots_against": gg.size(), "goals_against": gg["goal"].sum(), "xg_against": gg["xg"].sum()})
        gl["gsax"] = gl["xg_against"] - gl["goals_against"]
        gl["situation"] = label
        goalie_rows.append(gl.reset_index().rename(columns={"goalie_id": "player_id"}))

    player = pd.concat(player_rows, ignore_index=True)
    player["goals_minus_ixg"] = player["goals"] - player["ixg"]
    player = player.merge(players[["player_id", "name", "position", "last_team"]], on="player_id", how="left")

    teams = []
    for label in frames:
        # A team's 5on4 "against" shots are the opponent's 4on5 shots, so
        # pair each situation with its mirror on the defending side.
        mirror = {"all": "all", "5on5": "5on5", "5on4": "4on5", "4on5": "5on4"}[label]
        f_ = next(t for (l, s, t) in team_rows if l == label and s == "for")
        a_ = next(t for (l, s, t) in team_rows if l == mirror and s == "against")
        t = f_.join(a_, how="outer").fillna(0)
        t["situation"] = label
        teams.append(t.reset_index())
    team = pd.concat(teams, ignore_index=True)

    goalie = pd.concat(goalie_rows, ignore_index=True)
    goalie["player_id"] = goalie["player_id"].astype(int)
    goalie = goalie.merge(players[["player_id", "name", "last_team"]], on="player_id", how="left")
    return {"player": player, "team": team, "goalie": goalie}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--valid", required=True)
    ap.add_argument("--test", required=True)
    a = ap.parse_args()
    train_s = [int(s) for s in a.train.split(",")]
    valid_s, test_s = int(a.valid), int(a.test)
    all_s = train_s + [valid_s, test_s]

    data = {s: load(s) for s in all_s}
    shots = {s: data[s][0] for s in all_s}
    mod = {s: shots[s][modelled(shots[s])].reset_index(drop=True) for s in all_s}
    cat = lambda ss: pd.concat([mod[s] for s in ss], ignore_index=True)  # noqa: E731

    start = lambda s: s // 10000  # noqa: E731

    # A. selection: recency half-life, LR C and number of trees, all on the
    #    validation season. (C barely matters here: 0.01–1.0 were within
    #    0.00002 log loss in the first run, so two values are tried.)
    yv = mod[valid_s]["goal"].to_numpy(int)
    candidates = {}
    for hl in (None, 2.0, 1.0):
        mdl, log = m.fit(cat(train_s), mod[valid_s], C_grid=(0.1, 1.0), half_life=hl, target_start=start(valid_s))
        log["valid_scores"] = {"lr_only": scores(yv, mdl.lr_predict(mod[valid_s])), "lr_plus_gbm": scores(yv, mdl.predict(mod[valid_s]))}
        candidates["none" if hl is None else str(hl)] = log
        print(f"half-life {hl}:", json.dumps(log["valid_scores"]["lr_plus_gbm"]))
    best_key = min(candidates, key=lambda k: candidates[k]["valid_scores"]["lr_plus_gbm"]["log_loss"])
    sel_log = {**candidates[best_key], "half_life": None if best_key == "none" else float(best_key), "half_life_candidates": candidates}
    C, n_trees, hl = sel_log["chosen_C"], sel_log["gbm_trees"], sel_log["half_life"]
    print("selection:", json.dumps({k: sel_log[k] for k in ("half_life", "chosen_C", "gbm_trees")}))

    # B. test
    test_model = m.refit(cat(train_s + [valid_s]), C, n_trees, hl, start(test_s))
    t = mod[test_s].copy()
    t["xg"] = test_model.predict(t)
    t["xg_lr"] = test_model.lr_predict(t)
    joined, join_report = join_moneypuck(t, test_s)
    both = joined[joined["mp_xg"].notna() & (joined["shotOnEmptyNet"] == 0)]
    y = both["goal"].to_numpy(int)
    train_rate = float(cat(train_s + [valid_s])["goal"].mean())
    test_report = {
        "join": join_report,
        "all_test_shots": scores(t["goal"].to_numpy(int), t["xg"].to_numpy()),
        "matched_shots": {
            "constant_rate": scores(y, np.full(len(y), train_rate)),
            "rosteriq_lr_only": scores(y, both["xg_lr"].to_numpy()),
            "rosteriq": scores(y, both["xg"].to_numpy()),
            "moneypuck": scores(y, both["mp_xg"].to_numpy()),
        },
        "calibration": {
            "distance": calibration(both, pd.cut(both["distance"], [0, 10, 20, 30, 40, 50, 60, 200], right=False), "distance_ft"),
            "shot_type": calibration(both, both["shot_type"], "shot_type"),
            "strength": calibration(both, strength_label(both), "strength"),
            "rebound": calibration(both, both["rebound"], "rebound"),
            "rush": calibration(both, both["rush"], "rush"),
        },
    }
    print("test:", json.dumps(test_report["matched_shots"]))

    # C. leave-one-season-out totals
    version_dir = OUT / "xg" / m.MODEL_VERSION
    version_dir.mkdir(parents=True, exist_ok=True)
    totals = {"player": [], "team": [], "goalie": []}
    reconcile = {}
    for s in all_s:
        others = [o for o in all_s if o != s]
        mdl = test_model if s == test_s else m.refit(cat(others), C, n_trees, hl, start(s))
        ex = m.explain(mdl, mod[s])
        full = shots[s][modelled(shots[s])].index  # same order as mod[s]
        assert len(full) == len(ex)
        st = season_totals(shots[s], ex.set_index(full), data[s][1], s)
        for k in totals:
            totals[k].append(st[k])
        # Reconcile season totals with MoneyPuck on the same shots.
        js, jr = join_moneypuck(mod[s].assign(xg=ex["xg"].to_numpy()), s)
        jm = js[js["mp_xg"].notna() & (js["shotOnEmptyNet"] == 0)]
        p_ours = jm.groupby("shooter_id")["xg"].sum()
        p_mp = jm.groupby("shooter_id")["mp_xg"].sum()
        big = p_mp[p_mp >= 5].index
        team_ours, team_mp = jm.groupby("team")["xg"].sum(), jm.groupby("team")["mp_xg"].sum()
        gap = (p_ours - p_mp).loc[big]
        reconcile[str(s)] = {
            "join_matched_share_of_ours": jr["matched_share_of_ours"],
            "season_xg": {"rosteriq": round(float(jm["xg"].sum()), 1), "moneypuck": round(float(jm["mp_xg"].sum()), 1), "goals": int(jm["goal"].sum())},
            "team_xgf_correlation": round(float(np.corrcoef(team_ours, team_mp.loc[team_ours.index])[0, 1]), 4),
            "player_ixg_correlation_min5": round(float(np.corrcoef(p_ours.loc[big], p_mp.loc[big])[0, 1]), 4),
            "players_min5": int(len(big)),
            "largest_player_gaps": [
                {"player_id": int(pid), "rosteriq": round(float(p_ours[pid]), 2), "moneypuck": round(float(p_mp[pid]), 2)}
                for pid in gap.abs().sort_values(ascending=False).index[:10]
            ],
        }
        print(f"season {s}:", json.dumps(reconcile[str(s)]["season_xg"]), "team r", reconcile[str(s)]["team_xgf_correlation"])

    for k, frames in totals.items():
        pd.concat(frames, ignore_index=True).to_csv(version_dir / f"{k}_seasons.csv", index=False)

    # D. production model
    # Production scores the coming season: weights centre on the season after the newest.
    prod = m.refit(cat(all_s), C, n_trees, hl, start(max(all_s)) + 1)
    meta = {
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "seasons": all_s,
        "selection": {"train": train_s, "valid": valid_s, **sel_log},
        "test_season": test_s,
        "source": "NHL play-by-play (api-web.nhle.com)",
        "benchmark": benchmark.CREDIT,
    }
    m.save(prod, version_dir / "production", meta)
    (version_dir / "metrics.json").write_text(json.dumps({"version": m.MODEL_VERSION, **meta, "test": test_report, "reconciliation": reconcile}, indent=1))
    print("wrote", version_dir)


if __name__ == "__main__":
    main()
