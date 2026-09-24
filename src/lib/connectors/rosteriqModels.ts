/**
 * RosterIQ model outputs: import-ready files written by the offline
 * modelling pipeline (analytics/, `python -m rosteriq_models.export`) into
 * models/<version>/. Each CSV's header is exactly the import definition's
 * field keys, so a header mismatch means the pipeline and the app disagree
 * and the import is refused rather than guessed at.
 *
 * Read-only. Versions are validated against a strict pattern and files are
 * fixed names, so no request can reach outside models/.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { parseCsv } from "@/lib/import/csvParse";
import { ConnectorParseError } from "@/lib/connectors/util";

export const MODELS_DIR = path.join(process.cwd(), "models");
export const XG_MODEL_VERSION = "rosteriq-xg-v1";
export const PROSPECT_MODEL_VERSION = "rosteriq-prospects-v1";

export const MODEL_FILES = {
  xg_skaters: { version: XG_MODEL_VERSION, file: "import_xg_skaters.csv" },
  xg_goalies: { version: XG_MODEL_VERSION, file: "import_xg_goalies.csv" },
  xg_teams: { version: XG_MODEL_VERSION, file: "import_xg_teams.csv" },
  prospects: { version: PROSPECT_MODEL_VERSION, file: "import_prospects.csv" },
  nhle: { version: PROSPECT_MODEL_VERSION, file: "import_league_factors.csv" },
} as const;
export type ModelFileKey = keyof typeof MODEL_FILES;

export const ROSTERIQ_MODELS_CREDIT = "RosterIQ model, built from NHL API data (api-web.nhle.com)";
export const ROSTERIQ_MODELS_TERMS =
  "Model output derived from public NHL API data. MoneyPuck.com shot data is used only as an external benchmark in the model card (Data: MoneyPuck.com), never as model input.";

const VERSION_RE = /^rosteriq-[a-z]+-v\d+$/;

export interface ModelFile {
  relPath: string;
  sha256: string;
  text: string;
}

function versionDir(version: string, root = MODELS_DIR): string {
  if (!VERSION_RE.test(version)) throw new ConnectorParseError(`invalid model version "${version}"`);
  return path.join(root, version);
}

export function readModelFile(key: ModelFileKey, root = MODELS_DIR): ModelFile {
  const { version, file } = MODEL_FILES[key];
  const full = path.join(versionDir(version, root), file);
  if (!fs.existsSync(full)) {
    throw new ConnectorParseError(`${version}/${file} not found — run the modelling pipeline (see analytics/README.md)`);
  }
  const buf = fs.readFileSync(full);
  return {
    relPath: path.relative(path.dirname(root), full).split(path.sep).join("/"),
    sha256: createHash("sha256").update(buf).digest("hex"),
    text: buf.toString("utf8"),
  };
}

/** The model card (metrics.json) for a version, or null if it is not there. */
export function readModelCard(version: string, root = MODELS_DIR): Record<string, unknown> | null {
  const full = path.join(versionDir(version, root), "metrics.json");
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
}

/**
 * Parses an import-ready CSV and checks its header against the definition's
 * fields (same set, any order). Returns records keyed by field.
 */
export function parseModelCsv(text: string, fieldKeys: string[]): Array<Record<string, string>> {
  const { headers, rows } = parseCsv(text, { maxRows: 200_000 });
  const missing = fieldKeys.filter((k) => !headers.includes(k));
  const extra = headers.filter((h) => !fieldKeys.includes(h));
  if (missing.length || extra.length) {
    throw new ConnectorParseError(
      `model file columns do not match the import definition (missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"})`,
    );
  }
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

export function modelFilesStatus(root = MODELS_DIR) {
  return Object.fromEntries(
    (Object.keys(MODEL_FILES) as ModelFileKey[]).map((k) => {
      const { version, file } = MODEL_FILES[k];
      return [k, { version, file, present: fs.existsSync(path.join(root, version, file)) }];
    }),
  ) as Record<ModelFileKey, { version: string; file: string; present: boolean }>;
}
