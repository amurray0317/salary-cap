"""Prospect model v2 research: tiered outcomes, the full ranked population,
and benchmarks against draft position and NHL Central Scouting (final AND
midterm ranks).

    python -m rosteriq_models.prospects.v2 --train 2005-2013 --valid 2014-2015 --test 2016-2019

Needs (npm run data:fetch -- ...): --draft 2005-2026, --rankings 2008-2019,
--rank-links 2008-2019, --nhl-seasons 2005-2025.

1. Tiers (drafted skaters). Tier 1 "NHL regular": 200+ NHL regular-season
   games in the seven seasons after the draft (v1's outcome). Tier 2 "top of
   lineup": a regular who also had 2+ seasons in that window as a top-6
   forward / top-4 defenceman by ice time per game (prospects/lineup.py).
   P(top) = P(regular) x P(top | regular); both parts use the v1 recipe
   (LR + boosted trees, exact per-feature breakdowns), so P(top) <= P(regular)
   always.

2. Population. Everyone Central Scouting ranked (final or midterm), 2008-2019,
   one row per player at his first ranked year, linked to NHL ids by name +
   exact birth date. Unlinked = not in the NHL player index = never drafted
   or signed, so no NHL games. The false-unlinked rate is measured on ranked
   players known to be drafted. Draft-year production is NOT available for
   undrafted players from the NHL data (their landing pages don't exist), so
   the population model uses what Central Scouting publishes for everyone:
   list, rank, age, size, position. It measures how wrong a model trained on
   drafted players only is when it scores the whole ranked population, as
   live pre-draft scoring must.

3. Benchmarks on the test drafts (drafted skaters, same players, paired
   bootstrap): draft position; Central Scouting final and midterm rank;
   stats; stats + final rank; stats + midterm rank. Both tiers. Stats
   inputs for training rows are out-of-fold (leave-one-draft-out inside the
   pre-test drafts), so no test data leaks in.

Results go to the committed prospect card, key "v2_research".
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import unicodedata

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from rosteriq_models import explainable as ex
from rosteriq_models.export import MODELS
from rosteriq_models.prospects import css as cssmod
from rosteriq_models.prospects import dataset, lineup, nhle
from rosteriq_models.prospects.careers import age_on, load_careers, load_picks, season_id
from rosteriq_models.prospects.model import MODEL_VERSION, recipe
from rosteriq_models.prospects.train import LAST_COMPLETE_SEASON, scores, years
from rosteriq_models.raw import RAW, read_gz

TOP_SEASONS = 2
FULL_WINDOW_GAMES = 82 * dataset.OUTCOME_SEASONS
POP_YEARS = (2008, 2019)
CATEGORY = {1: "north_american", 2: "international"}
PICK_BINS = [0, 5, 10, 20, 31, 64, 100, 300]


def norm(s: str) -> str:
    return cssmod.norm(s)


# ------------------------------------------------------------------ tiers

def window_games(season_games: dict[int, int], start_year: int) -> int:
    """Games each team played in the seven seasons after a draft (D+1..D+7)."""
    return sum(season_games[season_id(start_year + k)] for k in range(dataset.OUTCOME_SEASONS))


def regular_bar(season_games: dict[int, int], start_year: int) -> float:
    """REGULAR_GP scaled to the games actually scheduled in the window, so a
    window with a lockout or a shortened season is not held to the full
    bar (200 of 574 games; 187 in windows with 2019-20 and 2020-21)."""
    return dataset.REGULAR_GP * window_games(season_games, start_year) / FULL_WINDOW_GAMES

def top_seasons(usage: pd.DataFrame) -> pd.Series:
    return usage[usage["top_lineup"]].groupby("player_id")["season"].apply(set)


def add_tiers(df: pd.DataFrame, top: pd.Series, year_col: str, regular_col: str) -> pd.DataFrame:
    """top_seasons_7 = top-of-lineup seasons in D+1..D+7; top_lineup = regular AND >= TOP_SEASONS of them."""
    n = [sum(season_id(y + k) in top.get(pid, set()) for k in range(dataset.OUTCOME_SEASONS)) if pd.notna(pid) else 0
         for pid, y in zip(df["player_id"], df[year_col])]
    return df.assign(top_seasons_7=n, top_lineup=((np.asarray(n) >= TOP_SEASONS) & (df[regular_col] == 1)).astype(int))


class TierModel:
    """P(regular), P(top | regular) and P(top) = product; one explainable model each."""

    def __init__(self, reg: ex.ExplainableModel, top: ex.ExplainableModel):
        self.reg, self.top = reg, top

    def p(self, df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        pr = self.reg.predict(df)
        return pr, pr * self.top.predict(df)


def fit_tiers(data: pd.DataFrame, reg_params: tuple[float, int], top_params: tuple[float, int]) -> TierModel:
    rec = recipe(False)
    reg = ex.refit(rec, data.reset_index(drop=True), *reg_params)
    regulars = data[data["nhl_regular"] == 1].reset_index(drop=True)
    top = ex.refit(dataclasses.replace(rec, label="top_lineup"), regulars, *top_params)
    return TierModel(reg, top)


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


# ------------------------------------------------------------- bootstrap

def bootstrap(y: np.ndarray, preds: dict[str, np.ndarray], baseline: str, subsets: dict[str, np.ndarray], B: int = 2000, seed: int = 7) -> dict:
    """95% intervals for (model - baseline) in AUC and log loss; same resampled players for every model."""
    from sklearn.metrics import roc_auc_score

    rng = np.random.default_rng(seed)
    out = {}
    for sub, mask in subsets.items():
        idx = np.where(mask)[0]
        draws = [rng.choice(idx, len(idx)) for _ in range(B)]
        draws = [s for s in draws if 0 < y[s].sum() < len(s)]
        for name, p in preds.items():
            if name == baseline:
                continue
            d_auc = [roc_auc_score(y[s], p[s]) - roc_auc_score(y[s], preds[baseline][s]) for s in draws]
            d_ll = [ex.logloss(y[s], p[s]) - ex.logloss(y[s], preds[baseline][s]) for s in draws]
            q = lambda x: [round(float(v), 4) for v in np.percentile(x, [2.5, 50, 97.5])]  # noqa: E731
            out[f"{sub}:{name}"] = {"auc_diff_ci95": q(d_auc), "log_loss_diff_ci95": q(d_ll), "resamples": len(draws)}
    return out


# ------------------------------------------------------------ population

def load_rank_links(yrs: list[int]) -> pd.DataFrame:
    rows = []
    for y in yrs:
        f = RAW / "nhl" / "rankings" / f"links_{y}.json"
        if not f.exists():
            raise FileNotFoundError(f"{f} missing; run npm run data:fetch -- --rank-links {y}-{y}")
        raw = {c: {(r["firstName"], r["lastName"], r["birthDate"]): r for r in read_gz(RAW / "nhl" / "rankings" / f"rankings_{y}_{c}.json.gz")["rankings"]}
               for c in CATEGORY}
        for item in json.loads(f.read_text()):
            r, o = item["row"], item["outcome"]
            src = raw[r["category"]].get((r["firstName"], r["lastName"], r["birthDate"]), {})
            rows.append({
                "rank_year": r["draftYear"],
                "css_list": CATEGORY[r["category"]],
                "name": f'{r["firstName"]} {r["lastName"]}',
                "last_name": r["lastName"],
                "birth_date": r["birthDate"],
                "css_final": r["finalRank"],
                "css_midterm": r["midtermRank"],
                "position": src.get("positionCode"),
                "height_in": src.get("heightInInches"),
                "css_league": src.get("lastAmateurLeague"),
                "weight_lb": src.get("weightInPounds"),
                "player_id": int(o["playerId"]) if o["status"] == "linked" else None,
                "link_status": o["status"],
                "link_reason": o.get("reason"),
            })
    return pd.DataFrame(rows)


def drafted_ids(ranked: pd.DataFrame, drafted: pd.DataFrame) -> pd.Series:
    """NHL id of the drafted skater each ranked row matches by (full name or,
    when unique, last name) + exact birth date; NaN when none."""
    d = drafted.dropna(subset=["birth_date"])
    full = {(norm(n), b): int(p) for n, b, p in zip(d["name"], d["birth_date"], d["player_id"])}
    last: dict[tuple[str, str], set[int]] = {}
    for n, b, p in zip(d["name"], d["birth_date"], d["player_id"]):
        last.setdefault((norm(n).split(" ")[-1], b), set()).add(int(p))
    out = []
    for r in ranked.itertuples():
        pid = full.get((norm(r.name), r.birth_date))
        if pid is None:
            cands = last.get((norm(r.last_name).split(" ")[-1], r.birth_date), set())
            pid = next(iter(cands)) if len(cands) == 1 else None
        out.append(pid)
    return pd.Series(out, index=ranked.index, dtype="Float64")


def linker_recall(ranked: pd.DataFrame, drafted: pd.DataFrame) -> dict:
    """On ranked rows that match a drafted skater by (full name or last name) +
    exact birth date: how often did the search linker find that same id?"""
    known = drafted_ids(ranked, drafted)
    k = ranked[known.notna()]
    kid = known[known.notna()].astype(int)
    same = int((k["player_id"] == kid).sum())
    missed = k[k["player_id"].isna()]["name"].tolist()
    other = int((k["player_id"].notna() & (k["player_id"] != kid)).sum())
    return {
        "ranked_rows_known_drafted": int(len(k)),
        "linked_to_same_id": same,
        "not_linked": len(missed),
        "linked_to_other_id": other,
        "recall": round(same / max(len(k), 1), 4),
        "not_linked_examples": missed[:15],
        "note": "rows the search linker missed (nickname spellings) are filled from this drafted-player match before outcomes are computed",
    }


def population(ranked: pd.DataFrame, drafted_year: dict[int, int], nhl_gp: pd.Series, top: pd.Series, season_games: dict[int, int]) -> pd.DataFrame:
    """One row per ranked player at his first ranked year, with outcomes."""
    r = ranked.copy()
    r["person"] = np.where(r["player_id"].notna(), "id:" + r["player_id"].astype("Int64").astype(str), "nb:" + r["name"].map(norm) + "|" + r["birth_date"])
    r = r.sort_values(["rank_year", "css_final"]).drop_duplicates("person", keep="first").reset_index(drop=True)
    gp7 = []
    played = set(nhl_gp.index.get_level_values(0))
    for pid, y in zip(r["player_id"], r["rank_year"]):
        if pd.isna(pid) or int(pid) not in played:
            gp7.append(0)
            continue
        s = nhl_gp.loc[int(pid)]
        gp7.append(int(s.reindex([season_id(y + k) for k in range(dataset.OUTCOME_SEASONS)]).fillna(0).sum()))
    r["nhl_gp_7"] = gp7
    r["nhl_regular"] = (r["nhl_gp_7"] >= [regular_bar(season_games, y) for y in r["rank_year"]]).astype(int)
    r = add_tiers(r, top, "rank_year", "nhl_regular")
    r["drafted_year"] = r["player_id"].map(lambda p: drafted_year.get(int(p)) if pd.notna(p) else None)
    r["drafted_this_year"] = r["drafted_year"] == r["rank_year"]
    r["drafted_ever"] = r["drafted_year"].notna()
    r["age_at_draft"] = [age_on(b, pd.Timestamp(y, 9, 15).date()) for b, y in zip(r["birth_date"], r["rank_year"])]
    return r


def pop_features(df: pd.DataFrame, col: str) -> np.ndarray:
    return np.column_stack([
        cssmod.css_features(df, col),
        df["age_at_draft"].fillna(18.5).clip(17.5, 21.5),
        df["height_in"].fillna(73).clip(64, 80),
        df["weight_lb"].fillna(190).clip(150, 260),
        (df["position"] == "D").astype(float),
    ])


def pop_bias(pop: pd.DataFrame, tr_years: list[int], te_years: list[int], col: str, label: str) -> dict:
    """Same features, two training sets: players drafted that year only (what a
    drafted-only model sees) vs everyone ranked. Scored on everyone ranked
    in the test years, overall and on those not drafted that year."""
    p = pop[pop[col].notna()]
    tr, te = p[p["rank_year"].isin(tr_years)], p[p["rank_year"].isin(te_years)].reset_index(drop=True)
    fit = lambda d: LogisticRegression(C=1.0, max_iter=5000).fit(pop_features(d, col), d[label])  # noqa: E731
    m_drafted, m_all = fit(tr[tr["drafted_this_year"]]), fit(tr)
    y = te[label].to_numpy(int)
    und = ~te["drafted_this_year"].to_numpy()
    out = {"train_rows_drafted_only": int(tr["drafted_this_year"].sum()), "train_rows_all_ranked": int(len(tr)), "test_rows": int(len(te)),
           "test_rows_not_drafted_that_year": int(und.sum())}
    for name, m in (("trained_on_drafted_only", m_drafted), ("trained_on_all_ranked", m_all)):
        pr = m.predict_proba(pop_features(te, col))[:, 1]
        out[name] = {"all_ranked": scores(y, pr), "not_drafted_that_year": scores(y[und], pr[und])}
    return out


# ------------------------------------------------- population + junior stats

# Era/league-relative rates (see hockeytech.py): raw PPG drifted upward across
# draft classes and made every model trained on older classes over-predict.
HT_STAT_COLS = ["d0_ppg_rel", "d0_es_ppg_rel", "d0_pp_ppg_rel", "d0_gpg_rel", "d0_team_goal_share", "d0_shots_pg_rel", "dm1_ppg_rel"]


def season_label(start_year: int) -> str:
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def attach_junior_stats(pop: pd.DataFrame, ht: pd.DataFrame) -> pd.DataFrame:
    """Draft-year (D0) and prior-season (D-1) HockeyTech lines for each ranked
    player, matched by normalised name + exact birth date. D0 = the league
    where he played the most games that season (at least MIN_GP)."""
    from rosteriq_models.prospects.hockeytech import MIN_GP

    h = ht.dropna(subset=["birth_date", "name"]).copy()
    h["key"] = h["name"].map(norm) + "|" + h["birth_date"]
    # Nicknames differ between lists (Alex / Alexander, Tim / Timothy): when
    # the full name does not match, last name + birth date is used if exactly
    # one junior player has it.
    h["last_key"] = h["name"].map(lambda n: norm(n).split(" ")[-1]) + "|" + h["birth_date"]
    people = h[["last_key", "key"]].drop_duplicates()
    counts = people["last_key"].value_counts()
    last_to_key = dict(people[people["last_key"].map(counts) == 1].itertuples(index=False, name=None))
    h = h.sort_values("gp", ascending=False).drop_duplicates(["key", "season"])
    by = h.set_index(["key", "season"])
    out = pop.copy()
    full = out["name"].map(norm) + "|" + out["birth_date"]
    known = set(h["key"])
    out["key"] = [
        k if k in known else last_to_key.get(norm(ln).split(" ")[-1] + "|" + bd, k)
        for k, ln, bd in zip(full, out["last_name"], out["birth_date"])
    ]
    for tag, off in (("d0", 1), ("dm1", 2)):
        keys = list(zip(out["key"], [season_label(y - off) for y in out["rank_year"]]))
        sub = by.reindex(keys)
        ok = (sub["gp"] >= MIN_GP).to_numpy()
        for c in ("league", "gp", "ppg", "es_ppg", "pp_ppg", "gpg", "team_goal_share", "shots_pg", "ppg_rel", "es_ppg_rel", "pp_ppg_rel", "gpg_rel", "shots_pg_rel"):
            if c not in sub:
                continue
            out[f"{tag}_{c}"] = np.where(ok, sub[c].to_numpy(), np.nan if c != "league" else None)
    return out


def junior_features(df: pd.DataFrame, col: str) -> np.ndarray:
    base = pop_features(df, col)
    cols = []
    for c in HT_STAT_COLS:
        v = df[c].astype(float)
        cols += [v.fillna(v.median() if v.notna().any() else 0.0).clip(upper=v.quantile(0.995) if v.notna().any() else None), v.isna().astype(float)]
    lg = [(df["d0_league"] == L).astype(float) for L in ("OHL", "WHL", "QMJHL")]  # USHL = reference
    return np.column_stack([base, *cols, *lg])


def junior_population(pop: pd.DataFrame, tr_years: list[int], te_years: list[int]) -> dict:
    """Ranked players whose draft-year league is OHL/WHL/QMJHL/USHL, drafted or
    not: Central Scouting inputs alone vs + real draft-year production."""
    ht_lg = {"OHL", "WHL", "QMJHL", "USHL"}
    listed = pop["css_league"].isin(ht_lg)
    cov = {
        "ranked_listed_in_these_leagues": int(listed.sum()),
        "matched_to_draft_year_line": int((listed & pop["d0_league"].notna()).sum()),
    }
    cov["match_rate"] = round(cov["matched_to_draft_year_line"] / max(cov["ranked_listed_in_these_leagues"], 1), 4)
    s = pop[pop["d0_league"].isin(ht_lg)]
    out = {"coverage": cov, "players": int(len(s)), "not_drafted_that_year": int((~s["drafted_this_year"]).sum())}
    fit = lambda X, y: make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=5000)).fit(X, y)  # noqa: E731
    for label in ("nhl_regular", "top_lineup"):
        for col in ("css_final", "css_midterm"):
            p = s[s[col].notna()]
            tr, te = p[p["rank_year"].isin(tr_years)], p[p["rank_year"].isin(te_years)].reset_index(drop=True)
            if te[label].sum() == 0 or tr[label].sum() == 0:
                continue
            y = te[label].to_numpy(int)
            und = ~te["drafted_this_year"].to_numpy()
            preds = {
                "css_only": fit(pop_features(tr, col), tr[label]).predict_proba(pop_features(te, col))[:, 1],
                "css_plus_junior_stats": fit(junior_features(tr, col), tr[label]).predict_proba(junior_features(te, col))[:, 1],
                "css_plus_junior_stats_drafted_only_training": fit(junior_features(tr[tr["drafted_this_year"]], col), tr.loc[tr["drafted_this_year"], label])
                .predict_proba(junior_features(te, col))[:, 1],
            }
            out[f"{label}:{col}"] = {
                "train_rows": int(len(tr)),
                "test_rows": int(len(te)),
                "test": {k: scores(y, v) for k, v in preds.items()},
                "test_not_drafted_that_year": {k: scores(y[und], v[und]) for k, v in preds.items()},
                "bootstrap_vs_css_only": bootstrap(y, {k: preds[k] for k in ("css_only", "css_plus_junior_stats")}, "css_only", {"all": np.ones(len(y), bool)}),
            }
    return out


# ------------------------------------------------------------------ main

def main() -> None:
    ap = argparse.ArgumentParser()
    for k in ("train", "valid", "test"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    tr_y, va_y, te_y = years(a.train), years(a.valid), years(a.test)
    pre_test = tr_y + va_y

    # Drafted skaters, v1 features, tiers.
    all_years = list(range(2005, 2027))
    picks = load_picks(all_years)
    ids = sorted({int(i) for i in picks["player_id"].dropna()})
    bio, lines = load_careers(ids)
    factors, _ = nhle.estimate(nhle.build_pairs(lines, bio))
    data = dataset.build(picks, bio, lines, dict(zip(factors["league"], factors["nhle_multiplier"])), LAST_COMPLETE_SEASON)
    usage, usage_report = lineup.season_usage(lineup.load_summaries(2005, LAST_COMPLETE_SEASON // 10000))
    top = top_seasons(usage)
    season_games = dict(zip(usage_report["season"], usage_report["season_games"]))
    mature = data["label_mature"].to_numpy()
    bars = np.array([regular_bar(season_games, y) if ok else np.nan for y, ok in zip(data["draft_year"], mature)])
    changed = int(((data["nhl_gp_7"] >= bars) != (data["nhl_regular"] == 1))[mature].sum())
    data["nhl_regular"] = np.where(mature, (data["nhl_gp_7"] >= bars).astype(int), data["nhl_regular"])
    data = add_tiers(data, top, "draft_year", "nhl_regular")
    lab = data[data["label_mature"]].reset_index(drop=True)
    lab["pick_bin"] = pd.cut(lab["overall_pick"], PICK_BINS).astype(str)
    rates = lab.groupby("pick_bin", observed=True, sort=False).agg(
        players=("nhl_regular", "size"), regular=("nhl_regular", "mean"), top_lineup=("top_lineup", "mean")).round(3)

    # Central Scouting ranks for drafted skaters (final and midterm).
    rk = cssmod.load_rankings(list(range(2008, max(te_y) + 1)))
    lab, css_link = cssmod.link(lab, rk, require="any")

    by = lambda ys: lab[lab["draft_year"].isin(ys)].reset_index(drop=True)  # noqa: E731
    train, valid, test = by(tr_y), by(va_y), by(te_y)
    card_path = MODELS / MODEL_VERSION / "metrics.json"
    card = json.loads(card_path.read_text())
    _, reg_log = ex.fit(recipe(False), train, valid, C_grid=(0.03, 0.1, 0.3, 1.0), max_trees=2000)
    reg_params = (reg_log["chosen_C"], reg_log["gbm_trees"])
    rec_top = dataclasses.replace(recipe(False), label="top_lineup")
    _, top_log = ex.fit(rec_top, train[train["nhl_regular"] == 1].reset_index(drop=True),
                        valid[valid["nhl_regular"] == 1].reset_index(drop=True), C_grid=(0.03, 0.1, 0.3, 1.0), max_trees=2000)
    top_params = (top_log["chosen_C"], top_log["gbm_trees"])

    pre = lab[lab["draft_year"].isin(pre_test)].reset_index(drop=True)
    tiers = fit_tiers(pre, reg_params, top_params)
    p_reg_te, p_top_te = tiers.p(test)

    # Out-of-fold stats logits for the pre-test drafts that have Central Scouting ranks.
    css_train = pre[pre["draft_year"] >= 2008].reset_index(drop=True)
    oof_reg, oof_top = np.zeros(len(css_train)), np.zeros(len(css_train))
    for y in sorted(css_train["draft_year"].unique()):
        m = fit_tiers(pre[pre["draft_year"] != y], reg_params, top_params)
        idx = np.where(css_train["draft_year"] == y)[0]
        oof_reg[idx], oof_top[idx] = (logit(v) for v in m.p(css_train.iloc[idx]))

    late = (test["round"] >= 2).to_numpy()
    results, boots = {}, {}
    for label, oof, p_stats in (("nhl_regular", oof_reg, p_reg_te), ("top_lineup", oof_top, p_top_te)):
        y_tr, y_te = css_train[label].to_numpy(int), test[label].to_numpy(int)
        pick_lr = LogisticRegression(C=1.0).fit(np.log(pre[["overall_pick"]].clip(1, 300)), pre[label])
        preds = {"draft_position_only": pick_lr.predict_proba(np.log(test[["overall_pick"]].clip(1, 300)))[:, 1], "stats_only": p_stats}
        for col, tag in (("css_final", "final"), ("css_midterm", "midterm")):
            only = LogisticRegression(C=1.0, max_iter=5000).fit(cssmod.css_features(css_train, col), y_tr)
            preds[f"css_{tag}_only"] = only.predict_proba(cssmod.css_features(test, col))[:, 1]
            stack = LogisticRegression(C=1.0, max_iter=5000).fit(np.column_stack([oof, cssmod.css_features(css_train, col)]), y_tr)
            preds[f"stats_plus_css_{tag}"] = stack.predict_proba(np.column_stack([logit(p_stats), cssmod.css_features(test, col)]))[:, 1]
        results[label] = {
            "all": {k: scores(y_te, v) for k, v in preds.items()},
            "rounds_2_plus": {k: scores(y_te[late], v[late]) for k, v in preds.items()},
        }
        subsets = {"all": np.ones(len(y_te), bool), "rounds_2_plus": late}
        boots[label] = {
            "vs_css_final": bootstrap(y_te, {k: preds[k] for k in ("css_final_only", "stats_only", "stats_plus_css_final")}, "css_final_only", subsets),
            "vs_css_midterm": bootstrap(y_te, {k: preds[k] for k in ("css_midterm_only", "stats_only", "stats_plus_css_midterm")}, "css_midterm_only", subsets),
            "vs_draft_position": bootstrap(y_te, {k: preds[k] for k in ("draft_position_only", "stats_only")}, "draft_position_only", subsets),
        }

    print(json.dumps({"test_players": int(len(test)), "test_regulars": int(test["nhl_regular"].sum()), "test_top_lineup": int(test["top_lineup"].sum()),
                      "top_given_regular_selection": top_log}, indent=1))
    for label in results:
        for sub in ("all", "rounds_2_plus"):
            print(label, sub, json.dumps({k: (v["log_loss"], v["auc"], v["expected"], v["regulars"]) for k, v in results[label][sub].items()}))
    print(json.dumps(boots, indent=1))

    # Population: everyone ranked.
    ranked = load_rank_links(list(range(POP_YEARS[0], POP_YEARS[1] + 1)))
    recall = linker_recall(ranked, data)
    fill = drafted_ids(ranked, data)
    filled = int((ranked["player_id"].isna() & fill.notna()).sum())
    ranked["player_id"] = pd.to_numeric(ranked["player_id"]).astype("Int64").fillna(fill.round().astype("Int64"))
    recall["filled_from_drafted_match"] = filled
    nhl_gp = usage.groupby(["player_id", "season"])["gp"].sum()
    drafted_year = {int(p): int(y) for p, y in zip(data["player_id"], data["draft_year"])}
    pop = population(ranked, drafted_year, nhl_gp, top, season_games)
    pop_tr = list(range(POP_YEARS[0], min(te_y)))
    pop_summary = {
        "ranked_players": int(len(pop)),
        "linked_to_nhl_id": int(pop["player_id"].notna().sum()),
        "drafted_that_year": int(pop["drafted_this_year"].sum()),
        "drafted_later": int((pop["drafted_ever"] & ~pop["drafted_this_year"]).sum()),
        "never_drafted": int((~pop["drafted_ever"]).sum()),
        "regulars": int(pop["nhl_regular"].sum()),
        "regulars_not_drafted_that_year": int(pop.loc[~pop["drafted_this_year"], "nhl_regular"].sum()),
        "regulars_never_drafted": int(pop.loc[~pop["drafted_ever"], "nhl_regular"].sum()),
        "top_lineup_never_drafted": int(pop.loc[~pop["drafted_ever"], "top_lineup"].sum()),
        "never_drafted_regular_examples": pop.loc[~pop["drafted_ever"] & (pop["nhl_regular"] == 1), "name"].head(20).tolist(),
    }
    bias = {f"{label}:{col}": pop_bias(pop, pop_tr, te_y, col, label)
            for label in ("nhl_regular", "top_lineup") for col in ("css_final", "css_midterm")}
    junior = None
    try:
        from rosteriq_models.prospects import hockeytech

        pop = attach_junior_stats(pop, hockeytech.load())
        junior = junior_population(pop, pop_tr, te_y)
    except FileNotFoundError as err:
        print(f"skipping junior-stats population analysis: {err}")

    result = {
        "question": "Tiered outcomes; the full Central Scouting-ranked population; benchmarks vs draft position and Central Scouting final and midterm rank.",
        "tiers": {
            "regular": f"{dataset.REGULAR_GP}+ NHL regular-season games in the {dataset.OUTCOME_SEASONS} seasons after the draft, scaled to the games "
                       f"scheduled in that window ({dataset.REGULAR_GP} of {FULL_WINDOW_GAMES}; 187-196 in windows with the 2012-13, 2019-20 or 2020-21 seasons)",
            "labels_changed_by_scaling": changed,
            "top_lineup": f"a regular with >= {TOP_SEASONS} seasons in that window as a top-{lineup.SLOTS['F']} forward / top-{lineup.SLOTS['D']} defenceman "
                          f"by ice time per game (league-wide rank <= teams x slots, among skaters with >= {lineup.MIN_SHARE_OF_SEASON:.0%} of the season's games)",
            "p_top": "P(regular) x P(top_lineup | regular)",
        },
        "lineup_seasons": usage_report.to_dict(orient="records"),
        "base_rates_by_pick": rates.reset_index().to_dict(orient="records"),
        "labelled_drafted_skaters": int(len(lab)),
        "regular_selection": reg_log,
        "top_given_regular_selection": top_log,
        "css_linking_drafted": css_link,
        "test_drafts": te_y,
        "test_players": int(len(test)),
        "test_regulars": int(test["nhl_regular"].sum()),
        "test_top_lineup": int(test["top_lineup"].sum()),
        "test": results,
        "bootstrap": boots,
        "population": {"years": list(POP_YEARS), "linker_recall_on_known_drafted": recall, "summary": pop_summary, "drafted_only_bias": bias,
                       "with_junior_stats": junior},
    }
    card["v2_research"] = result
    card_path.write_text(json.dumps(card, indent=1, default=str))
    print(json.dumps(result["population"], indent=1, default=str))


if __name__ == "__main__":
    main()
