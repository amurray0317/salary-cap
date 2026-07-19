/**
 * Import-type definitions: target fields, per-field validators, and
 * downloadable templates. Pure data + functions (no DB) so the mapping UI,
 * the validation service, and the tests all consume one source of truth.
 */

export const IMPORT_TYPES = ["players", "contracts", "ncaa_players", "ncaa_season_stats"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  description: string;
  /** Returns an error message, or null when the value is acceptable. */
  validate: (value: string) => string | null;
}

const POSITIONS = ["C", "LW", "RW", "D", "G"];
const ROSTER_STATUSES = [
  "pro_active", "pro_scratch", "injured_reserve", "ltir", "minor",
  "juniors", "loaned", "suspended", "unsigned", "non_roster",
];
const FA_STATUSES = ["under_contract", "rfa", "ufa", "unsigned_prospect"];
const CONTRACT_TYPES = ["standard", "entry_level", "two_way", "one_way", "minor_league"];

const optional = (fn: (v: string) => string | null) => (v: string) => (v === "" ? null : fn(v));

const oneOf = (allowed: string[], label: string) => (v: string) =>
  allowed.includes(v) ? null : `${label} must be one of: ${allowed.join(", ")}`;

const isoDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
    ? null
    : "must be a date in YYYY-MM-DD format";

const nonNegativeInt = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isInteger(n) && n >= 0 ? null : "must be a non-negative whole dollar amount";
};

/** Normalizes money-ish cell values ("$4,500,000" → 4500000). */
export function parseMoney(v: string): number {
  return Number(v.replace(/[$,\s]/g, ""));
}

export interface ImportDefinition {
  type: ImportType;
  label: string;
  description: string;
  fields: FieldDef[];
  templateRows: string[][]; // example data rows for the downloadable template
}

export const IMPORT_DEFINITIONS: Record<ImportType, ImportDefinition> = {
  players: {
    type: "players",
    label: "Players",
    description:
      "One row per player. Team abbreviation (optional) must match a team in your organization; players without a team are created as non-roster.",
    fields: [
      { key: "full_name", label: "Full name", required: true, description: "Player's full name", validate: (v) => (v.length >= 2 ? null : "must be at least 2 characters") },
      { key: "position", label: "Position", required: true, description: "C, LW, RW, D, or G", validate: oneOf(POSITIONS, "position") },
      { key: "date_of_birth", label: "Date of birth", required: false, description: "YYYY-MM-DD", validate: optional(isoDate) },
      { key: "shoots_catches", label: "Shoots/catches", required: false, description: "L or R", validate: optional(oneOf(["L", "R"], "shoots_catches")) },
      { key: "nationality", label: "Nationality", required: false, description: "Free text", validate: () => null },
      { key: "team_abbreviation", label: "Team abbreviation", required: false, description: "Must match one of your teams; blank = no team", validate: () => null },
      { key: "roster_status", label: "Roster status", required: false, description: ROSTER_STATUSES.join(", "), validate: optional(oneOf(ROSTER_STATUSES, "roster_status")) },
      { key: "free_agent_status", label: "Free-agent status", required: false, description: FA_STATUSES.join(", "), validate: optional(oneOf(FA_STATUSES, "free_agent_status")) },
    ],
    templateRows: [
      ["Sample Center", "C", "1999-03-14", "L", "Canada", "AUR", "pro_active", "under_contract"],
      ["Sample Winger", "LW", "2001-07-02", "R", "Sweden", "", "non_roster", "ufa"],
    ],
  },

  contracts: {
    type: "contracts",
    label: "Contracts (one row per contract-season)",
    description:
      "One row per season of a contract. Rows with the same player_name are grouped into one multi-season contract. The player must already exist in your organization (import players first) and must not already have an active contract.",
    fields: [
      { key: "player_name", label: "Player name", required: true, description: "Exact full name of an existing player in your organization", validate: (v) => (v.length >= 2 ? null : "must be at least 2 characters") },
      { key: "team_abbreviation", label: "Team abbreviation", required: true, description: "Must match one of your teams", validate: (v) => (v.length >= 1 ? null : "is required") },
      { key: "season_name", label: "Season", required: true, description: "League season name, e.g. 2025-26", validate: (v) => (v.length >= 4 ? null : "must be a season name like 2025-26") },
      { key: "cap_hit", label: "Cap hit ($)", required: true, description: "Whole dollars", validate: nonNegativeInt },
      { key: "base_salary", label: "Base salary ($)", required: false, description: "Whole dollars; defaults to cap hit", validate: optional(nonNegativeInt) },
      { key: "performance_bonus", label: "Performance bonus ($)", required: false, description: "Whole dollars; defaults to 0", validate: optional(nonNegativeInt) },
      { key: "contract_type", label: "Contract type", required: false, description: CONTRACT_TYPES.join(", "), validate: optional(oneOf(CONTRACT_TYPES, "contract_type")) },
    ],
    templateRows: [
      ["Sample Center", "AUR", "2025-26", "4500000", "4250000", "0", "one_way"],
      ["Sample Center", "AUR", "2026-27", "4500000", "4750000", "0", "one_way"],
      ["Sample Winger", "AUR", "2025-26", "850000", "850000", "50000", "two_way"],
    ],
  },

  ncaa_players: {
    type: "ncaa_players",
    label: "NCAA prospects (amateur scouting)",
    description:
      "One row per NCAA prospect. School name must match an existing school record; unmatched schools are row errors, not silent creations.",
    fields: [
      { key: "full_name", label: "Full name", required: true, description: "Prospect's full name", validate: (v) => (v.length >= 2 ? null : "must be at least 2 characters") },
      { key: "position", label: "Position", required: true, description: "C, LW, RW, D, or G", validate: oneOf(POSITIONS, "position") },
      { key: "date_of_birth", label: "Date of birth", required: false, description: "YYYY-MM-DD", validate: optional(isoDate) },
      { key: "shoots_catches", label: "Shoots/catches", required: false, description: "L or R", validate: optional(oneOf(["L", "R"], "shoots_catches")) },
      { key: "height_cm", label: "Height (cm)", required: false, description: "Whole centimeters", validate: optional(nonNegativeInt) },
      { key: "weight_kg", label: "Weight (kg)", required: false, description: "Whole kilograms", validate: optional(nonNegativeInt) },
      { key: "nationality", label: "Nationality", required: false, description: "Free text", validate: () => null },
      { key: "school_name", label: "School", required: true, description: "Must match an existing school", validate: (v) => (v.length >= 2 ? null : "is required") },
      { key: "class_year", label: "Class year", required: true, description: "freshman, sophomore, junior, senior, graduate", validate: oneOf(["freshman", "sophomore", "junior", "senior", "graduate"], "class_year") },
      { key: "nhl_draft_status", label: "NHL draft status", required: false, description: "undrafted or drafted", validate: optional(oneOf(["undrafted", "drafted"], "nhl_draft_status")) },
      { key: "nhl_rights_holder", label: "NHL rights holder", required: false, description: "Team holding rights (blank if none)", validate: () => null },
      { key: "draft_year", label: "Draft year", required: false, description: "e.g. 2025", validate: optional(nonNegativeInt) },
    ],
    templateRows: [
      ["Sample Prospect", "C", "2005-02-11", "L", "183", "84", "United States", "Sample State University", "sophomore", "drafted", "Aurora Wolfpack", "2023"],
      ["Sample Defender", "D", "2004-08-30", "R", "188", "92", "Canada", "Sample State University", "junior", "undrafted", "", ""],
    ],
  },

  ncaa_season_stats: {
    type: "ncaa_season_stats",
    label: "NCAA season statistics (amateur scouting)",
    description:
      "One row per prospect per season. The prospect must already exist (import NCAA prospects first). Leave time_on_ice_seconds blank when unavailable — never estimated.",
    fields: [
      { key: "player_name", label: "Prospect name", required: true, description: "Exact full name of an existing NCAA prospect", validate: (v) => (v.length >= 2 ? null : "must be at least 2 characters") },
      { key: "season_name", label: "Season", required: true, description: "e.g. 2025-26", validate: (v) => (/^\d{4}-\d{2}$/.test(v) ? null : "must look like 2025-26") },
      { key: "class_year", label: "Class year", required: true, description: "freshman, sophomore, junior, senior, graduate", validate: oneOf(["freshman", "sophomore", "junior", "senior", "graduate"], "class_year") },
      { key: "games_played", label: "Games played", required: true, description: "Whole number", validate: nonNegativeInt },
      { key: "goals", label: "Goals", required: true, description: "Whole number", validate: nonNegativeInt },
      { key: "assists", label: "Assists", required: true, description: "Whole number", validate: nonNegativeInt },
      { key: "shots", label: "Shots", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "penalty_minutes", label: "PIM", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "pp_goals", label: "PP goals", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "pp_assists", label: "PP assists", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "sh_goals", label: "SH goals", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "faceoff_wins", label: "Faceoff wins", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "faceoff_attempts", label: "Faceoff attempts", required: false, description: "Whole number", validate: optional(nonNegativeInt) },
      { key: "time_on_ice_seconds", label: "TOI (seconds)", required: false, description: "Blank when unavailable — never estimate", validate: optional(nonNegativeInt) },
      { key: "team_goals_for", label: "Team goals for", required: false, description: "Team scoring environment", validate: optional(nonNegativeInt) },
    ],
    templateRows: [
      ["Sample Prospect", "2025-26", "sophomore", "34", "14", "21", "112", "18", "5", "8", "1", "310", "612", "", "118"],
      ["Sample Defender", "2025-26", "junior", "36", "5", "18", "88", "30", "1", "9", "0", "0", "0", "", "121"],
    ],
  },
};

export function isImportType(v: string): v is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(v);
}

/** Auto-maps CSV headers to target fields by normalized-name equality. */
export function autoMapHeaders(type: ImportType, headers: string[]): Record<string, string> {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNorm = new Map(headers.map((h) => [normalize(h), h]));
  const mapping: Record<string, string> = {};
  for (const field of IMPORT_DEFINITIONS[type].fields) {
    const hit = byNorm.get(normalize(field.key)) ?? byNorm.get(normalize(field.label));
    if (hit !== undefined) mapping[field.key] = hit;
  }
  return mapping;
}

/** Builds the downloadable CSV template for an import type. */
export function buildTemplateCsv(type: ImportType): { filename: string; headers: string[]; rows: string[][] } {
  const def = IMPORT_DEFINITIONS[type];
  return {
    filename: `rosteriq-template-${type}.csv`,
    headers: def.fields.map((f) => f.key),
    rows: def.templateRows,
  };
}
