"""Benchmark the prospect model against NHL Central Scouting's final
rankings — the consensus available BEFORE the draft, so the fair baseline
for pre-draft use (draft position does not exist yet then).

    python -m rosteriq_models.prospects.css --train 2008-2015 --test 2016-2019

Population: drafted skaters with a known outcome (the only players with
outcomes). Central Scouting rows are linked to them by normalised full
name + exact birth date (fallback: normalised last name + birth date + draft
year); drafted skaters without a final rank are "unranked", which is itself
information. Central Scouting ranks North American and International skaters
on separate lists, so the rank model has one slope per list.

Compared on the test drafts (same players, paired bootstrap):
  * Central Scouting rank only
  * RosterIQ stats only (the production recipe, refitted on the train drafts)
  * RosterIQ stats + Central Scouting (logistic regression on the stats
    model's logit and the rank features; the stats logit for training rows
    is out-of-fold within the train drafts, so no test data leaks in)
Results are written into the committed prospect model card
(models/<version>/metrics.json → benchmark_css), so run it after export.
"""
from __future__ import annotations

import argparse
import difflib
import json
import unicodedata

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from rosteriq_models import explainable as ex
from rosteriq_models.prospects import dataset, nhle
from rosteriq_models.prospects.careers import load_careers, load_picks
from rosteriq_models.prospects.model import MODEL_VERSION, recipe
from rosteriq_models.prospects.train import LAST_COMPLETE_SEASON, bootstrap_vs, pick_only, scores, years
from rosteriq_models.export import MODELS
from rosteriq_models.raw import RAW, read_gz

CATEGORIES = {1: "north_american", 2: "international"}
NAME_SIMILARITY = 0.7


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return " ".join("".join(c if c.isalpha() else " " for c in s).split())


def load_rankings(yrs: list[int]) -> pd.DataFrame:
    rows = []
    for y in yrs:
        for cat, key in CATEGORIES.items():
            f = RAW / "nhl" / "rankings" / f"rankings_{y}_{cat}.json.gz"
            if not f.exists():
                raise FileNotFoundError(f"{f} missing; run npm run data:fetch -- --rankings {y}-{y}")
            for r in read_gz(f).get("rankings", []):
                rows.append({
                    "draft_year": y,
                    "css_list": key,
                    "css_name": f'{r.get("firstName", "")} {r.get("lastName", "")}',
                    "css_last": r.get("lastName", ""),
                    "birth_date": r.get("birthDate"),
                    "css_final": r.get("finalRank"),
                    "css_midterm": r.get("midtermRank"),
                })
    return pd.DataFrame(rows)


def link(players: pd.DataFrame, css: pd.DataFrame, require: str = "final") -> tuple[pd.DataFrame, dict]:
    """Adds css_list / css_final / css_midterm to drafted players. A ranking
    row links to at most one player; ambiguous matches are left unlinked and
    counted. require="final" uses only rows with a final rank (the benchmark
    above); "any" also uses rows with only a midterm rank."""
    keep = css["css_final"].notna() if require == "final" else css["css_final"].notna() | css["css_midterm"].notna()
    css = css[keep].copy()
    css["k_full"] = css["css_name"].map(norm) + "|" + css["birth_date"].fillna("")
    css["k_last"] = css["css_last"].map(norm) + "|" + css["birth_date"].fillna("") + "|" + css["draft_year"].astype(str)
    p = players.copy()
    p["k_full"] = p["name"].map(norm) + "|" + p["birth_date"].fillna("")
    p["k_last"] = p["name"].map(lambda n: norm(n).split(" ")[-1] if n else "") + "|" + p["birth_date"].fillna("") + "|" + p["draft_year"].astype(str)
    out = p.assign(css_list=None, css_final=np.nan, css_midterm=np.nan, css_linked=False)
    used = set()
    counts = {"linked_full_name": 0, "linked_last_name": 0, "ambiguous": 0}
    for key, via in (("k_full", "linked_full_name"), ("k_last", "linked_last_name")):
        grp = css.groupby(key)
        for i, row in out[~out["css_linked"]].iterrows():
            if row[key] not in grp.groups:
                continue
            cand = css.loc[grp.groups[row[key]]]
            cand = cand[~cand.index.isin(used) & (cand["draft_year"] <= row["draft_year"])]
            # A player can appear on a list in an earlier year and be drafted later (overager);
            # use his ranking in the year he was drafted when present, else the latest before it.
            same = cand[cand["draft_year"] == row["draft_year"]]
            cand = same if len(same) else cand.sort_values("draft_year").tail(1)
            if len(cand) != 1:
                counts["ambiguous"] += int(len(cand) > 1)
                continue
            c = cand.iloc[0]
            used.add(c.name)
            _set(out, i, c)
            counts[via] += 1
    # Third pass: exact birth date + similar name (transliterations such as
    # Voynov / Voinov, Trunev / Trunyov). Accepted only when exactly one
    # remaining ranking row qualifies.
    free = css[~css.index.isin(used)]
    by_bd = free.groupby("birth_date")
    counts["linked_similar_name"] = 0
    for i, row in out[~out["css_linked"]].iterrows():
        if not row["birth_date"] or row["birth_date"] not in by_bd.groups:
            continue
        cand = free.loc[by_bd.groups[row["birth_date"]]]
        cand = cand[~cand.index.isin(used) & (cand["draft_year"] <= row["draft_year"])]
        pn = norm(row["name"])
        ok = [
            idx for idx, c in cand.iterrows()
            if max(
                difflib.SequenceMatcher(None, pn.split(" ")[-1], norm(c["css_last"])).ratio(),
                difflib.SequenceMatcher(None, pn, norm(c["css_name"])).ratio(),
            ) >= NAME_SIMILARITY
        ]
        if len(ok) != 1:
            counts["ambiguous"] += int(len(ok) > 1)
            continue
        used.add(ok[0])
        _set(out, i, css.loc[ok[0]])
        counts["linked_similar_name"] += 1
    counts["css_final_rows" if require == "final" else "css_ranked_rows"] = int(len(css))
    counts["css_rows_linked_share"] = round(len(used) / max(len(css), 1), 4)
    return out, counts


def _set(out: pd.DataFrame, i, c: pd.Series) -> None:
    out.at[i, "css_list"] = c["css_list"]
    out.at[i, "css_final"] = float(c["css_final"]) if pd.notna(c["css_final"]) else np.nan
    out.at[i, "css_midterm"] = float(c["css_midterm"]) if pd.notna(c["css_midterm"]) else np.nan
    out.at[i, "css_linked"] = True


def css_features(df: pd.DataFrame, col: str = "css_final") -> np.ndarray:
    """One intercept shift and one log-rank slope per list; players without
    a rank in `col` are all zeros (the intercept)."""
    ranked = df[col].notna().to_numpy()
    na = ((df["css_list"] == "north_american").to_numpy() & ranked).astype(float)
    intl = ((df["css_list"] == "international").to_numpy() & ranked).astype(float)
    lr = np.log(df[col].fillna(1.0).clip(1, 300).to_numpy())
    return np.column_stack([na, intl, na * lr, intl * lr])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default="2008-2015")
    ap.add_argument("--test", default="2016-2019")
    a = ap.parse_args()
    tr_y, te_y = years(a.train), years(a.test)

    all_years = list(range(2005, max(te_y) + 1))
    picks = load_picks(all_years)
    ids = sorted({int(i) for i in picks["player_id"].dropna()})
    bio, lines = load_careers(ids)
    factors, _ = nhle.estimate(nhle.build_pairs(lines, bio))
    data = dataset.build(picks, bio, lines, dict(zip(factors["league"], factors["nhle_multiplier"])), LAST_COMPLETE_SEASON)
    data = data[data["label_mature"]].reset_index(drop=True)
    data, link_report = link(data, load_rankings(tr_y + te_y))
    train = data[data["draft_year"].isin(tr_y)].reset_index(drop=True)
    test = data[data["draft_year"].isin(te_y)].reset_index(drop=True)
    y_tr, y_te = train["nhl_regular"].to_numpy(int), test["nhl_regular"].to_numpy(int)

    card_path = MODELS / MODEL_VERSION / "metrics.json"
    card = json.loads(card_path.read_text())
    C, n_trees = card["chosen"]["stats"]["C"], card["chosen"]["stats"]["gbm_trees"]
    rec = recipe(False)
    # Stats model trained on drafts before the test drafts only (2005 onward).
    pre_test = data[data["draft_year"] < min(te_y)]
    stats_model = ex.refit(rec, pre_test.reset_index(drop=True), C, n_trees)
    p_stats_te = stats_model.predict(test)
    # Out-of-fold stats logits for the train drafts (each draft left out in turn, test drafts never used).
    oof = np.zeros(len(train))
    for y in tr_y:
        m = ex.refit(rec, pre_test[pre_test["draft_year"] != y].reset_index(drop=True), C, n_trees)
        idx = np.where(train["draft_year"] == y)[0]
        oof[idx] = m.logit(train.iloc[idx])

    css_lr = LogisticRegression(C=1.0, max_iter=2000).fit(css_features(train), y_tr)
    p_css_te = css_lr.predict_proba(css_features(test))[:, 1]
    stack = LogisticRegression(C=1.0, max_iter=2000).fit(np.column_stack([oof, css_features(train)]), y_tr)
    p_stack_te = stack.predict_proba(np.column_stack([stats_model.logit(test), css_features(test)]))[:, 1]
    p_pick_te = pick_only(train)(test)

    late = (test["round"] >= 2).to_numpy()
    preds = {"draft_position_only": p_css_te, "stats": p_stats_te, "stats_plus_css": p_stack_te}  # baseline slot = CSS
    result = {
        "question": "Before the draft, does the RosterIQ stats model add information beyond NHL Central Scouting's final rank?",
        "population": "drafted skaters with a known outcome",
        "train_drafts": tr_y,
        "test_drafts": te_y,
        "linking": link_report,
        "test_players": int(len(test)),
        "test_share_with_final_rank": round(float(test["css_final"].notna().mean()), 4),
        "test": {
            "central_scouting_only": scores(y_te, p_css_te),
            "stats_only": scores(y_te, p_stats_te),
            "stats_plus_central_scouting": scores(y_te, p_stack_te),
            "draft_position_only_reference": scores(y_te, p_pick_te),
        },
        "test_rounds_2_plus": {
            "central_scouting_only": scores(y_te[late], p_css_te[late]),
            "stats_only": scores(y_te[late], p_stats_te[late]),
            "stats_plus_central_scouting": scores(y_te[late], p_stack_te[late]),
        },
        # Differences are (model − Central Scouting only).
        "bootstrap_vs_central_scouting": bootstrap_vs(y_te, preds, late),
        "stack_coefficients": {
            "stats_logit": round(float(stack.coef_[0][0]), 4),
            "css": [round(float(c), 4) for c in stack.coef_[0][1:]],
        },
    }
    card["benchmark_css"] = result
    card_path.write_text(json.dumps(card, indent=1, default=str))
    print(json.dumps({k: result[k] for k in ("linking", "test_players", "test_share_with_final_rank", "test", "test_rounds_2_plus")}, indent=1))
    print(json.dumps(result["bootstrap_vs_central_scouting"], indent=1))


if __name__ == "__main__":
    main()
