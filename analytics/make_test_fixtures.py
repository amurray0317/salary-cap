"""Trim the committed model outputs into app test fixtures
(tests/fixtures/models/<version>/). Whole rows are kept for a few players
and teams; no value is edited. Usage: python make_test_fixtures.py [models_root]"""
import json
import shutil
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "models"
DST = REPO / "tests" / "fixtures" / "models"
KEEP_PLAYERS = {8478402, 8476945}  # Connor McDavid, Connor Hellebuyck
KEEP_TEAMS = {"EDM", "WPG"}
KEEP_DRAFTS = {2015}
KEEP_LEAGUES = {"NHL", "AHL", "OHL", "WHL", "KHL", "SHL"}

manifest = []
for version_dir in sorted(p for p in SRC.iterdir() if p.is_dir() and p.name.startswith("rosteriq-")):
    out = DST / version_dir.name
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(version_dir.glob("import_*.csv")):
        d = pd.read_csv(f, dtype=str, keep_default_na=False)
        if "external_player_id" in d and "draft_year" in d:
            keep = d[d["draft_year"].astype(int).isin(KEEP_DRAFTS) & (d["overall_pick"].astype(int) <= 12)]
        elif "external_player_id" in d:
            keep = d[d["external_player_id"].astype(int).isin(KEEP_PLAYERS)]
        elif "team_abbrev" in d:
            keep = d[d["team_abbrev"].isin(KEEP_TEAMS)]
        else:
            keep = d[d["league"].isin(KEEP_LEAGUES)]
        keep.to_csv(out / f.name, index=False)
        manifest.append({"file": f"{version_dir.name}/{f.name}", "rows_kept": len(keep), "rows_in_source": len(d)})
    shutil.copy(version_dir / "metrics.json", out / "metrics.json")
(DST / "manifest.json").write_text(json.dumps({"source": str(SRC.relative_to(REPO)) if SRC.is_relative_to(REPO) else "scratch", "trimming": "whole rows kept for the listed players / teams / drafts / leagues; values unedited", "files": manifest}, indent=1) + "\n")
print(json.dumps(manifest))
