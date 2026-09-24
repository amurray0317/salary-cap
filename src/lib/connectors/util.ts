/**
 * Pure helpers shared by the connector parsers. Every helper maps a value the
 * source did NOT report to "" (the import pipeline's "missing" marker), never
 * to 0 or a guess.
 */

/** A normalized record: field key → string value ("" = not reported). */
export type NormalizedRecord = Record<string, string>;

export interface ParsedDataset {
  records: NormalizedRecord[];
  /** Season / draft year the data describes, for provenance. */
  effectiveSeason: string | null;
  /** Data-quality notes surfaced on the import preview. */
  warnings: string[];
}

export class ConnectorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorParseError";
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** String field; localized objects ({ default: "…" }) resolve to their default. */
export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isObject(v) && typeof v.default === "string") return v.default.trim();
  return "";
}

/** Numeric field as a string; non-finite / absent → "". */
export function num(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return String(Number(v));
  return "";
}

/** Integer field; rounds only values that are integral within float noise ("61.0" → "61"). */
export function int(v: unknown): string {
  const s = num(v);
  if (s === "") return "";
  const n = Number(s);
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : "";
}

/** "22:59" / "297:30" (mm:ss, minutes may exceed 59) → seconds. */
export function clockToSeconds(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = /^(\d+):([0-5]\d)$/.exec(v.trim());
  if (!m) return "";
  return String(Number(m[1]) * 60 + Number(m[2]));
}

/** NHL 8-digit season id (20242025) → "2024-25". */
export function nhlSeasonLabel(v: unknown): string {
  const s = String(v ?? "");
  const m = /^(\d{4})(\d{4})$/.exec(s);
  if (!m) return "";
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end !== start + 1) return "";
  return `${start}-${String(end).slice(2)}`;
}

/** Season start year (MoneyPuck's "2024") → "2024-25". */
export function startYearSeasonLabel(v: unknown): string {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) return "";
  return `${n}-${String(n + 1).slice(2)}`;
}

/** "2024-25" → NHL season id "20242025". */
export function seasonLabelToNhlId(label: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new ConnectorParseError(`Season must look like 2024-25 (got "${label}")`);
  return `${m[1]}${Number(m[1]) + 1}`;
}

/**
 * Position normalization to the app's C/LW/RW/D/G vocabulary. The NHL
 * stats endpoints and MoneyPuck report wingers as "L"/"R"; this is a
 * deterministic relabel, not an inference. Unknown codes → "".
 */
export function normalizePosition(v: unknown): string {
  const s = str(v).toUpperCase();
  switch (s) {
    case "C":
    case "D":
    case "G":
    case "LW":
    case "RW":
      return s;
    case "L":
      return "LW";
    case "R":
      return "RW";
    default:
      return "";
  }
}

export function gameTypeLabel(id: unknown): string {
  const n = Number(id);
  if (n === 2) return "regular";
  if (n === 3) return "playoffs";
  return "";
}

export function fullName(first: unknown, last: unknown): string {
  return [str(first), str(last)].filter((p) => p !== "").join(" ");
}

/** Converts records to the pipeline's { headers, rows } using a field order. */
export function toRawData(fieldKeys: string[], records: NormalizedRecord[]): { headers: string[]; rows: string[][] } {
  return {
    headers: [...fieldKeys],
    rows: records.map((r) => fieldKeys.map((k) => r[k] ?? "")),
  };
}
