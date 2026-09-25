"""Draft-class report: every first-time-eligible skater in the OHL, WHL, QMJHL
and USHL, projected from what is known BEFORE his draft season starts.

    python -m rosteriq_models.prospects.draft_class --draft 2027 --train 2006-2015 --test 2016-2019

Why a separate model. rosteriq-prospects-v1 and the v2 research use
draft-year (D0) production and, at their best, Central Scouting's lists.
In September of the draft year neither exists yet: the D0 season has barely
started and Central Scouting publishes its midterm list in January. This
model uses only the D-1 season (the season before the draft year), the
D-2 season when there is one, age, size, position and league.

Population (per past draft year Y). First-time eligible = born Sept 16 of
Y-19 through Sept 15 of Y-18 (NHL CBA: 18 by Sept 15 of the draft year; a
player born after Sept 15 waits a year). Every such skater with at least
MIN_GP games in one of the four leagues in the D-1 season, drafted or not.

Outcome. NHL games in the seven seasons after the draft (D+1..D+7): an NHL
regular = 200+ games scaled to the games scheduled (prospects v2); top of
lineup = a regular with 2+ seasons as a top-6 F / top-4 D by ice time. NHL
ids come from the drafted-player records (every draft 2005-2026, any year,
so late and overage picks count) matched by name + exact birth date.
Limitation: a player never drafted who later made the NHL is counted as a
non-regular (the v2 ranked population had 3 such regulars in 2,147).

Validation. Train on the earlier drafts, test on 2016-2019 (outcomes
complete through 2025-26). Benchmarks on the same players: base rate; a
points-per-game baseline (D-1 league-relative PPG, position, age); and, as
a reference that uses information from the END of the draft season, where
players were actually drafted (undrafted = pick 260). Paired bootstrap 95%
intervals. The tiers shown to readers are checked on the test drafts: what
share of each tier actually became NHL regulars.

Outputs (models/rosteriq-draft-<Y>/): board.csv (first-time eligible, with
projections, drivers and five historical comparables), older.csv (older
eligible players not yet drafted, stats only this edition), metrics.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from rosteriq_models import explainable as ex
from rosteriq_models.export import MODELS
from rosteriq_models.prospects import lineup
from rosteriq_models.prospects.careers import age_on, load_careers, load_picks, season_id
from rosteriq_models.prospects.hockeytech import MIN_GP, load as load_ht
from rosteriq_models.prospects.train import LAST_COMPLETE_SEASON, scores, years
from rosteriq_models.prospects.v2 import add_tiers, bootstrap, norm, regular_bar, season_label, top_seasons

LEAGUES = ("OHL", "WHL", "QMJHL", "USHL")
UNDRAFTED_PICK = 260
C_GRID = (0.01, 0.03, 0.1, 0.3, 1.0)
# Tiers shown to readers, on P(NHL regular). Checked on the test drafts: a
# finer split of the middle (8-20% vs 20-40%) did not hold up (players in the
# two bands became regulars at about the same rate), so it is one tier.
TIERS = [(0.40, 1, "Likely NHL player"), (0.08, 2, "Real chance"), (0.0, 3, "Unlikely on current numbers")]

# name, plain-language label, how to read a positive contribution
FEATURES = [
    ("dm1_ppg_rel", "scoring rate last season vs his league"),
    ("dm1_es_ppg_rel", "even-strength scoring vs his league"),
    ("dm1_pp_ppg_rel", "power-play scoring vs his league"),
    ("dm1_gpg_rel", "goal rate vs his league"),
    ("dm1_team_goal_share", "share of his team's goals he had a point on"),
    ("dm1_log_gp", "games played last season"),
    ("dm2_ppg_rel", "scoring two seasons ago vs his league"),
    ("dm2_missing", "no season in these leagues two years ago"),
    ("age", "age on draft day (older = less time to grow)"),
    ("is_d", "defenceman"),
    ("d_x_ppg", "scoring rate, as a defenceman"),
    ("young_x_ppg", "scoring rate, given how young he is"),
    ("log_ppg", "scoring rate (diminishing returns at the top)"),
    ("height_in", "height"),
    ("weight_lb", "weight"),
    ("size_missing", "height/weight not listed"),
    ("lg_ohl", "played in the OHL"),
    ("lg_whl", "played in the WHL"),
    ("lg_qmjhl", "played in the QMJHL"),
]
FEATURE_NAMES = [f for f, _ in FEATURES]
LABELS = dict(FEATURES)


def first_eligible_window(draft_year: int) -> tuple[str, str]:
    """Birth dates of first-time-eligible players for a draft (NHL CBA 18-by-Sept-15 rule)."""
    return (dt.date(draft_year - 19, 9, 16).isoformat(), dt.date(draft_year - 18, 9, 15).isoformat())


def older_eligible_window(draft_year: int) -> tuple[str, str]:
    """North American players older than first-time eligible who have not turned 21 by Dec 31 of the draft year."""
    return (dt.date(draft_year - 20, 1, 1).isoformat(), dt.date(draft_year - 19, 9, 15).isoformat())


def main_lines(ht: pd.DataFrame, season: str) -> pd.DataFrame:
    """One line per person (name + birth date) for a season: the league where he played the most games."""
    s = ht[(ht["season"] == season) & ht["birth_date"].notna()].copy()
    s["person"] = s["name"].map(norm) + "|" + s["birth_date"]
    return s.sort_values("gp", ascending=False).drop_duplicates("person").set_index("person")


def cohort(ht: pd.DataFrame, draft_year: int, window: tuple[str, str]) -> pd.DataFrame:
    """Players born in `window` with a D-1 line; D-2 line attached where it exists."""
    dm1 = main_lines(ht, season_label(draft_year - 2))
    dm1 = dm1[(dm1["birth_date"] >= window[0]) & (dm1["birth_date"] <= window[1])]
    dm2 = main_lines(ht, season_label(draft_year - 3))
    out = pd.DataFrame({
        "draft_year": draft_year,
        "name": dm1["name"],
        "birth_date": dm1["birth_date"],
        "ht_id": dm1["ht_id"],
        "league": dm1["league"],
        "position": dm1["position"],
        "height_in": dm1["height_in"],
        "weight_lb": dm1["weight_lb"],
        "shoots": dm1["shoots"],
    })
    for c in ("gp", "goals", "assists", "points", "pp_points", "ppg", "es_ppg", "pp_ppg", "gpg", "shots_pg", "team_goal_share",
              "ppg_rel", "es_ppg_rel", "pp_ppg_rel", "gpg_rel", "shots_pg_rel", "teams"):
        out[f"dm1_{c}"] = dm1[c]
    d2 = dm2.reindex(out.index)
    ok2 = d2["gp"] >= MIN_GP
    for c in ("league", "gp", "points", "ppg", "ppg_rel"):
        out[f"dm2_{c}"] = d2[c].where(ok2)
    out["enough_games"] = out["dm1_gp"] >= MIN_GP
    return out.reset_index(names="person")


def features(df: pd.DataFrame, fill: dict[str, float]) -> np.ndarray:
    """Model inputs. `fill` = training medians for missing values (never test data)."""
    is_d = (df["position"] == "D").astype(float)
    ppg = df["dm1_ppg_rel"].clip(upper=4)
    size_missing = (df["height_in"].isna() | df["weight_lb"].isna()).astype(float)
    cols = {
        "dm1_ppg_rel": ppg,
        "dm1_es_ppg_rel": df["dm1_es_ppg_rel"].clip(upper=4),
        "dm1_pp_ppg_rel": df["dm1_pp_ppg_rel"].fillna(0).clip(upper=6),
        "dm1_gpg_rel": df["dm1_gpg_rel"].clip(upper=5),
        "dm1_team_goal_share": df["dm1_team_goal_share"].fillna(fill["dm1_team_goal_share"]).clip(upper=0.6),
        "dm1_log_gp": np.log1p(df["dm1_gp"]),
        "dm2_ppg_rel": df["dm2_ppg_rel"].fillna(0).clip(upper=4),
        "dm2_missing": df["dm2_ppg_rel"].isna().astype(float),
        "age": df["age"],
        "is_d": is_d,
        "d_x_ppg": is_d * ppg,
        # The same scoring at a younger age is a stronger signal (centred at 18.5).
        "young_x_ppg": (18.5 - df["age"]) * ppg,
        "log_ppg": np.log(ppg.clip(lower=0.05)),
        "height_in": df["height_in"].fillna(fill["height_in"]).clip(64, 80),
        "weight_lb": df["weight_lb"].fillna(fill["weight_lb"]).clip(140, 250),
        "size_missing": size_missing,
        "lg_ohl": (df["league"] == "OHL").astype(float),
        "lg_whl": (df["league"] == "WHL").astype(float),
        "lg_qmjhl": (df["league"] == "QMJHL").astype(float),
    }
    return np.column_stack([cols[f] for f in FEATURE_NAMES]).astype(float)


class Scaled:
    """Standardised logistic regression with per-feature contributions (logit points)."""

    def __init__(self, C: float):
        self.scaler, self.lr = StandardScaler(), LogisticRegression(C=C, max_iter=5000)

    def fit(self, X: np.ndarray, y: np.ndarray) -> "Scaled":
        self.lr.fit(self.scaler.fit_transform(X), y)
        return self

    def p(self, X: np.ndarray) -> np.ndarray:
        return self.lr.predict_proba(self.scaler.transform(X))[:, 1]

    def contributions(self, X: np.ndarray) -> np.ndarray:
        return self.scaler.transform(X) * self.lr.coef_[0]


def choose_C(df: pd.DataFrame, X: np.ndarray, label: str) -> tuple[float, dict]:
    """Leave-one-draft-year-out log loss inside the training drafts."""
    y = df[label].to_numpy(int)
    res = {}
    for C in C_GRID:
        pred = np.zeros(len(df))
        for yr in df["draft_year"].unique():
            te = (df["draft_year"] == yr).to_numpy()
            if y[~te].sum() == 0:
                continue
            pred[te] = Scaled(C).fit(X[~te], y[~te]).p(X[te])
        res[C] = round(ex.logloss(y, np.clip(pred, 1e-6, 1 - 1e-6)), 5)
    return min(res, key=res.get), {str(k): v for k, v in res.items()}


class TierModel:
    def __init__(self, c_reg: float, c_top: float):
        self.c_reg, self.c_top = c_reg, c_top

    def fit(self, df: pd.DataFrame, X: np.ndarray) -> "TierModel":
        self.reg = Scaled(self.c_reg).fit(X, df["nhl_regular"].to_numpy(int))
        r = (df["nhl_regular"] == 1).to_numpy()
        self.top = Scaled(self.c_top).fit(X[r], df.loc[r, "top_lineup"].to_numpy(int))
        return self

    def p(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        pr = self.reg.p(X)
        return pr, pr * self.top.p(X)


def tier_of(p: float) -> tuple[int, str]:
    for cut, n, name in TIERS:
        if p >= cut:
            return n, name
    return TIERS[-1][1], TIERS[-1][2]


def outcomes(df: pd.DataFrame, drafted: pd.DataFrame, nhl_gp: pd.Series, top: pd.Series, season_games: dict[int, int], label: bool = True) -> pd.DataFrame:
    """NHL id (via drafted players, name + birth date, full name or unique last name), draft pick and, when
    `label` (the seven-season window is complete), D+1..D+7 games and tiers."""
    d = drafted.dropna(subset=["birth_date"])
    full = {(norm(n), b): (int(p), int(y), int(k)) for n, b, p, y, k in zip(d["name"], d["birth_date"], d["player_id"], d["draft_year"], d["overall_pick"])}
    last: dict[tuple[str, str], list] = {}
    for n, b, p, y, k in zip(d["name"], d["birth_date"], d["player_id"], d["draft_year"], d["overall_pick"]):
        last.setdefault((norm(n).split(" ")[-1], b), []).append((int(p), int(y), int(k)))
    pid, dyear, pick, via = [], [], [], []
    for n, b in zip(df["name"], df["birth_date"]):
        hit = full.get((norm(n), b))
        how = "full_name"
        if hit is None:
            c = {x[0]: x for x in last.get((norm(n).split(" ")[-1], b), [])}
            hit, how = (next(iter(c.values())), "last_name") if len(c) == 1 else (None, None)
        pid.append(hit[0] if hit else None)
        dyear.append(hit[1] if hit else None)
        pick.append(hit[2] if hit else None)
        via.append(how)
    out = df.copy()
    out["player_id"], out["drafted_year"], out["drafted_pick"], out["link_via"] = pid, dyear, pick, via
    out["pick_first_year"] = np.where(out["drafted_year"] == out["draft_year"], out["drafted_pick"], UNDRAFTED_PICK).astype(float)
    if not label:
        return out
    played = set(nhl_gp.index.get_level_values(0))
    gp7 = []
    for p, y in zip(out["player_id"], out["draft_year"]):
        if p is None or pd.isna(p) or int(p) not in played:
            gp7.append(0)
            continue
        s = nhl_gp.loc[int(p)]
        gp7.append(int(s.reindex([season_id(y + k) for k in range(7)]).fillna(0).sum()))
    out["nhl_gp_7"] = gp7
    out["nhl_regular"] = (out["nhl_gp_7"] >= [regular_bar(season_games, y) for y in out["draft_year"]]).astype(int)
    return add_tiers(out, top, "draft_year", "nhl_regular")


def comparables(target: pd.DataFrame, pool: pd.DataFrame, k: int = 5) -> list[list[dict]]:
    """Five past players (same position group) with the most similar season before their draft year."""
    cols = ["dm1_ppg_rel", "dm1_es_ppg_rel", "dm1_team_goal_share", "age", "height_in"]
    P = pool.dropna(subset=["dm1_ppg_rel", "age"]).reset_index(drop=True)
    fillv = {c: float(P[c].median()) for c in cols}
    A = P[cols].fillna(fillv).to_numpy(float)
    mu, sd = A.mean(0), A.std(0) + 1e-9
    w = np.array([2.0, 1.0, 1.0, 1.5, 0.5])  # scoring and age matter most
    A = (A - mu) / sd * w
    T = (target[cols].fillna(fillv).to_numpy(float) - mu) / sd * w
    out = []
    for i, pos in enumerate((target["position"] == "D").to_numpy()):
        same = ((P["position"] == "D").to_numpy() == pos)
        dist = np.where(same, np.sqrt(((A - T[i]) ** 2).sum(1)), np.inf)
        idx = np.argsort(dist)[:k]
        out.append([{
            "name": P.at[j, "name"], "draft_year": int(P.at[j, "draft_year"]), "league": P.at[j, "league"],
            "dm1_ppg": round(float(P.at[j, "dm1_ppg"]), 2), "age": round(float(P.at[j, "age"]), 1),
            "pick": None if pd.isna(P.at[j, "drafted_pick"]) else int(P.at[j, "drafted_pick"]),
            "drafted_year": None if pd.isna(P.at[j, "drafted_year"]) else int(P.at[j, "drafted_year"]),
            "nhl_gp_7": int(P.at[j, "nhl_gp_7"]), "regular": bool(P.at[j, "nhl_regular"]), "top_lineup": bool(P.at[j, "top_lineup"]),
        } for j in idx])
    return out


def drivers(model: Scaled, X: np.ndarray, n: int = 3) -> list[dict]:
    """Largest plus and minus contributions per player, in plain words (logit points)."""
    C = model.contributions(X)
    out = []
    for row in C:
        order = np.argsort(row)
        up = [{"feature": FEATURE_NAMES[j], "label": LABELS[FEATURE_NAMES[j]], "effect": round(float(row[j]), 2)} for j in order[::-1][:n] if row[j] > 0.05]
        down = [{"feature": FEATURE_NAMES[j], "label": LABELS[FEATURE_NAMES[j]], "effect": round(float(row[j]), 2)} for j in order[:n] if row[j] < -0.05]
        out.append({"up": up, "down": down})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--draft", type=int, required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--test", required=True)
    a = ap.parse_args()
    tr_y, te_y = years(a.train), years(a.test)
    hist_years = tr_y + te_y
    target_year = a.draft

    ht = load_ht()
    ht = ht[ht["league"].isin(LEAGUES)]
    missing_bd = ht[ht["birth_date"].isna()]
    data_coverage = {
        "seasons": sorted(ht["season"].unique())[-1],
        "player_seasons": int(len(ht)),
        "player_seasons_without_birth_date": int(len(missing_bd)),
        "without_birth_date_10plus_gp": int((missing_bd["gp"] >= MIN_GP).sum()),
    }

    # Drafted players (every draft 2005-2026) with NHL ids and birth dates, for outcomes.
    picks = load_picks(list(range(2005, 2027)))
    linked = picks[picks["player_id"].notna()].copy()
    bio, _ = load_careers(sorted({int(i) for i in linked["player_id"]}))
    drafted = linked.merge(bio[["player_id", "birth_date"]], on="player_id", how="left")
    usage, usage_report = lineup.season_usage(lineup.load_summaries(2005, LAST_COMPLETE_SEASON // 10000))
    nhl_gp = usage.groupby(["player_id", "season"])["gp"].sum()
    top = top_seasons(usage)
    season_games = dict(zip(usage_report["season"], usage_report["season_games"]))

    hist = pd.concat([cohort(ht, y, first_eligible_window(y)) for y in hist_years], ignore_index=True)
    hist = hist[hist["enough_games"]].copy()
    hist["age"] = [age_on(b, dt.date(y, 9, 15)) for b, y in zip(hist["birth_date"], hist["draft_year"])]
    hist = outcomes(hist, drafted, nhl_gp, top, season_games)
    # Drafted players (in their first year) the name + birth date match must find: a recall check.
    recall_rows = []
    for y in hist_years:
        lo, hi = first_eligible_window(y)
        d = drafted[(drafted["draft_year"] == y) & drafted["amateur_league"].isin(LEAGUES) & drafted["birth_date"].between(lo, hi)
                    & (drafted["draft_position"] != "G")]
        found = set(hist.loc[hist["draft_year"] == y, "player_id"].dropna().astype(int))
        dm1_all = main_lines(ht, season_label(y - 2))
        few = set(dm1_all.index[dm1_all["gp"] < MIN_GP])
        hit = d["player_id"].astype(int).isin(found).to_numpy()
        short = ~hit & np.array([(norm(n) + "|" + str(b)) in few for n, b in zip(d["name"], d["birth_date"])], dtype=bool)
        recall_rows.append({"draft_year": y, "drafted_skaters_from_these_leagues": int(len(d)), "found_in_population": int(hit.sum()),
                            "fewer_than_min_games_season_before": int(short.sum()),
                            "not_in_these_leagues_season_before": int((~hit & ~short).sum())})
    recall = pd.DataFrame(recall_rows)

    fill = {c: float(hist.loc[hist["draft_year"].isin(tr_y), c].median()) for c in ("dm1_team_goal_share", "height_in", "weight_lb")}
    X = features(hist, fill)
    tr = hist["draft_year"].isin(tr_y).to_numpy()
    te = hist["draft_year"].isin(te_y).to_numpy()
    c_reg, sel_reg = choose_C(hist[tr].reset_index(drop=True), X[tr], "nhl_regular")
    regs = tr & (hist["nhl_regular"] == 1).to_numpy()
    c_top, sel_top = choose_C(hist[regs].reset_index(drop=True), X[regs], "top_lineup")
    tm = TierModel(c_reg, c_top).fit(hist[tr].reset_index(drop=True), X[tr])
    p_reg, p_top = tm.p(X[te])
    test = hist[te].reset_index(drop=True)

    # Baselines, fitted on the same training drafts.
    def simple(cols: list[str], label: str) -> np.ndarray:
        f = lambda d: np.column_stack([d[c].astype(float) for c in cols])  # noqa: E731
        m = Scaled(1.0).fit(f(hist[tr]), hist.loc[tr, label].to_numpy(int))
        return m.p(f(test))
    hist["is_d"] = (hist["position"] == "D").astype(float)
    hist["log_pick"] = np.log(hist["pick_first_year"])
    test = hist[te].reset_index(drop=True)
    res, boots, tier_check, topk = {}, {}, {}, {}
    for label, p_model in (("nhl_regular", p_reg), ("top_lineup", p_top)):
        y = test[label].to_numpy(int)
        preds = {
            "base_rate": np.full(len(y), hist.loc[tr, label].mean()),
            "points_per_game_baseline": simple(["dm1_ppg_rel", "is_d", "age"], label),
            "rosteriq_preseason": p_model,
            "reference_actual_draft_position": simple(["log_pick"], label),
        }
        res[label] = {k: scores(y, v) for k, v in preds.items()}
        boots[label] = bootstrap(y, {k: preds[k] for k in ("points_per_game_baseline", "rosteriq_preseason", "reference_actual_draft_position")},
                                 "points_per_game_baseline", {"all": np.ones(len(y), bool)})
        # Top 32 of each class: how many became regulars / top-of-lineup, model vs actual draft order.
        rows = []
        for yr in te_y:
            m = (test["draft_year"] == yr).to_numpy()
            by_model = np.argsort(-p_model[m])[:32]
            by_pick = np.argsort(test.loc[m, "pick_first_year"].to_numpy())[:32]
            rows.append({"draft_year": yr, "model_top32": int(y[m][by_model].sum()), "actual_draft_order_top32": int(y[m][by_pick].sum())})
        topk[label] = rows
    tiers_te = pd.Series([tier_of(p)[0] for p in p_reg])
    for n, name in [(t[1], t[2]) for t in TIERS]:
        m = (tiers_te == n).to_numpy()
        tier_check[name] = {"players": int(m.sum()), "became_regulars": int(test.loc[m, "nhl_regular"].sum()),
                            "share": round(float(test.loc[m, "nhl_regular"].mean()), 3) if m.any() else None,
                            "model_expected_share": round(float(p_reg[m].mean()), 3) if m.any() else None}
    calib = pd.DataFrame({"p": p_reg, "y": test["nhl_regular"]}).assign(bin=lambda d: pd.qcut(d["p"].rank(method="first"), 10, labels=False))
    calibration = calib.groupby("bin").agg(players=("y", "size"), expected=("p", "sum"), actual=("y", "sum")).round(1).reset_index().to_dict(orient="records")

    # Final model on every labelled draft, then the target class.
    fill_all = {c: float(hist[c].median()) for c in ("dm1_team_goal_share", "height_in", "weight_lb")}
    X_all = features(hist, fill_all)
    final = TierModel(c_reg, c_top).fit(hist, X_all)
    coefs = {FEATURE_NAMES[i]: round(float(v), 3) for i, v in enumerate(final.reg.lr.coef_[0])}

    board = cohort(ht, target_year, first_eligible_window(target_year))
    board["age"] = [age_on(b, dt.date(target_year, 9, 15)) for b in board["birth_date"]]
    ok = board["enough_games"].to_numpy()
    Xb = features(board, fill_all)
    pr, pt = final.p(Xb)
    board["p_regular"] = np.where(ok, pr, np.nan)
    board["p_top_lineup"] = np.where(ok, pt, np.nan)
    board["tier"] = [tier_of(p)[0] if o else None for p, o in zip(pr, ok)]
    board["tier_name"] = [tier_of(p)[1] if o else f"Not projected: fewer than {MIN_GP} games last season" for p, o in zip(pr, ok)]
    board["drivers"] = [json.dumps(d) if o else None for d, o in zip(drivers(final.reg, Xb), ok)]
    board["comparables"] = [json.dumps(c) for c in comparables(board, hist)]
    board["age_rank_pct"] = board["birth_date"].rank(pct=True).round(3)  # 1.0 = youngest in the class
    board = board.sort_values(["p_regular"], ascending=False, na_position="last").reset_index(drop=True)
    board["rank"] = np.where(board["p_regular"].notna(), np.arange(1, len(board) + 1), None)

    # Older eligible players (born Jan 1 Y-20 .. Sept 15 Y-19) not yet drafted: listed with stats only.
    older = cohort(ht, target_year, older_eligible_window(target_year))
    older = older[older["enough_games"]].copy()
    older["age"] = [age_on(b, dt.date(target_year, 9, 15)) for b in older["birth_date"]]
    dk = set(zip(drafted["name"].map(norm), drafted["birth_date"]))
    older = older[[(norm(n), b) not in dk for n, b in zip(older["name"], older["birth_date"])]]
    older = older.sort_values("dm1_ppg_rel", ascending=False)

    # Sanity check on the most recent completed draft: the same pre-season model vs where players went.
    last = target_year - 1
    prev = cohort(ht, last, first_eligible_window(last))
    prev = prev[prev["enough_games"]].copy()
    prev["age"] = [age_on(b, dt.date(last, 9, 15)) for b in prev["birth_date"]]
    prev = outcomes(prev, drafted, nhl_gp, top, season_games, label=False)
    pp, _ = final.p(features(prev, fill_all))
    drafted_prev = prev["drafted_year"] == last
    rank_corr = float(pd.Series(pp[drafted_prev.to_numpy()]).rank().corr(pd.Series(-prev.loc[drafted_prev, "drafted_pick"].to_numpy()).rank()))
    top32_prev = int((prev.assign(p=pp).nlargest(32, "p")["drafted_year"] == last).sum())

    out_dir = MODELS / f"rosteriq-draft-{target_year}"
    out_dir.mkdir(parents=True, exist_ok=True)
    keep = ["rank", "tier", "tier_name", "p_regular", "p_top_lineup", "name", "ht_id", "league", "position", "shoots", "birth_date", "age", "age_rank_pct",
            "height_in", "weight_lb", "dm1_gp", "dm1_goals", "dm1_assists", "dm1_points", "dm1_ppg", "dm1_ppg_rel", "dm1_es_ppg", "dm1_pp_ppg",
            "dm1_team_goal_share", "dm1_shots_pg", "dm1_teams", "dm2_league", "dm2_gp", "dm2_points", "dm2_ppg", "enough_games", "drivers", "comparables"]
    board[keep].to_csv(out_dir / "board.csv", index=False, float_format="%.4g")
    older[["name", "ht_id", "league", "position", "birth_date", "age", "dm1_gp", "dm1_goals", "dm1_assists", "dm1_points", "dm1_ppg", "dm1_ppg_rel",
           "dm2_league", "dm2_gp", "dm2_points"]].to_csv(out_dir / "older.csv", index=False, float_format="%.4g")
    fe = first_eligible_window(target_year)
    card = {
        "model": f"rosteriq-draft-{target_year}",
        "edition": "preseason",
        "built": dt.date.today().isoformat(),
        "data_through": f"{season_label(target_year - 2)} regular season (the season before the draft year); {season_label(target_year - 1)} not yet included",
        "eligibility": {"first_time_birth_dates": fe, "older_birth_dates": older_eligible_window(target_year),
                        "rule": "NHL CBA: 18 by Sept 15 of the draft year; North American players must not turn 21 by Dec 31 of the draft year"},
        "leagues": list(LEAGUES),
        "not_covered": ["Europe (Sweden, Finland, Czechia, Slovakia, Switzerland, Russia, Germany)", "NCAA", "US high school and USHL-affiliated NTDP games outside the USHL",
                        "Canadian junior A (BCHL, AJHL, ...)", "goaltenders (not modelled)"],
        "class": {
            "first_time_eligible_players": int(len(board)),
            "projected": int(board["p_regular"].notna().sum()),
            "fewer_than_min_games": int((~board["enough_games"]).sum()),
            "by_league": board.groupby("league").size().to_dict(),
            "older_eligible_not_drafted": int(len(older)),
            "expected_regulars_in_class": round(float(board["p_regular"].sum()), 1),
        },
        "training": {
            "drafts": hist_years, "train": tr_y, "test": te_y, "players": int(len(hist)),
            "regulars": int(hist["nhl_regular"].sum()), "top_lineup": int(hist["top_lineup"].sum()),
            "players_per_draft": hist.groupby("draft_year").size().to_dict(),
            "linked_to_nhl_id": int(hist["player_id"].notna().sum()),
            "drafted_player_recall": {**{c: int(recall[c].sum()) for c in recall.columns if c != "draft_year"},
                                      "note": "drafted skaters (first eligible year, drafted out of these leagues) and why the pre-season population misses some: "
                                              "they joined these leagues in the draft season (Junior A, U18 AAA, high school, Europe) or played under the "
                                              "minimum games the season before; a name spelled differently in the two sources also lands here",
                                      "by_year": recall.to_dict(orient="records")},
            "chosen_C": {"regular": c_reg, "top_given_regular": c_top}, "selection_log_loss": {"regular": sel_reg, "top_given_regular": sel_top},
        },
        "test": res, "bootstrap_vs_points_per_game_baseline": boots, "top32_per_class": topk, "tiers": {"definition": TIERS, "test_check": tier_check},
        "calibration_test_deciles": calibration,
        "sanity_last_draft": {"draft": last, "players": int(len(prev)), "drafted_that_year": int(drafted_prev.sum()),
                              "spearman_model_vs_pick_among_drafted": round(rank_corr, 3), "model_top32_who_were_drafted": top32_prev},
        "coefficients_regular_standardised": coefs,
        "data_coverage": data_coverage,
    }
    (out_dir / "metrics.json").write_text(json.dumps(card, indent=1, default=str))
    print(json.dumps({k: card[k] for k in ("class", "training", "test", "bootstrap_vs_points_per_game_baseline", "top32_per_class", "tiers", "calibration_test_deciles", "sanity_last_draft")}, indent=1, default=str))


if __name__ == "__main__":
    main()
