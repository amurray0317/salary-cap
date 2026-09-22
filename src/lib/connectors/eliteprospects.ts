/**
 * EliteProspects connector — OFFICIAL API ONLY (api.eliteprospects.com).
 * No scraping of eliteprospects.com pages, ever.
 *
 * Disabled until configured: the connector is enabled only when an API key
 * is present in EP_API_KEY (or ELITEPROSPECTS_API_KEY). The key is sent as
 * the `apiKey` query parameter — the only form the API accepted when probed
 * (a `x-api-key` header or lowercase `apikey` parameter both return
 * "Api Key was not present in request"; see tests/fixtures/connectors/
 * eliteprospects/). The key is redacted from every cached URL, provenance
 * record, and log line.
 *
 * No data response has been recorded yet (no key was available when this
 * connector was built), so the parser deliberately accepts only the minimal
 * documented envelope `{ data: [ { id, firstName|lastName|name, … } ] }`
 * and maps only unambiguous scalar fields. Any other shape is rejected with
 * instructions to record a fixture — it never imports a guess.
 */
import { ConnectorParseError, int, isObject, normalizePosition, str, type ParsedDataset } from "@/lib/connectors/util";

export const EP_BASE = "https://api.eliteprospects.com/v1";
export const EP_CREDIT = "Data: EliteProspects.com (official API)";
export const EP_TERMS = "Use is governed by your EliteProspects API agreement. Official API only — no scraping.";

export interface EpConfig {
  enabled: boolean;
  apiKey: string | null;
  reason: string;
}

export function getEpConfig(env: Record<string, string | undefined> = process.env): EpConfig {
  const key = (env.EP_API_KEY ?? env.ELITEPROSPECTS_API_KEY ?? "").trim();
  if (key === "") {
    return { enabled: false, apiKey: null, reason: "Disabled until configured: set EP_API_KEY on the server to enable the official EliteProspects API." };
  }
  return { enabled: true, apiKey: key, reason: "Enabled (API key configured on the server)." };
}

export function epPlayerSearchUrl(query: string, apiKey: string, limit = 25): string {
  const q = query.trim();
  if (q.length < 2 || q.length > 80) throw new ConnectorParseError("Search must be 2–80 characters");
  const lim = Math.min(Math.max(1, Math.floor(limit)), 50);
  return `${EP_BASE}/players?q=${encodeURIComponent(q)}&limit=${lim}&apiKey=${encodeURIComponent(apiKey)}`;
}

/** Real EP error bodies look like {"uuid":"…","message":"Api Key was not present in request"}. */
export function parseEpError(body: string): string | null {
  try {
    const j: unknown = JSON.parse(body);
    if (isObject(j) && typeof j.message === "string") return j.message;
  } catch {
    // not JSON
  }
  return null;
}

export function parseEpPlayers(json: unknown): ParsedDataset {
  if (!isObject(json) || !Array.isArray(json.data)) {
    throw new ConnectorParseError(
      "EliteProspects response shape not recognized (expected { data: [...] }). Record a real response with scripts/record-connector-fixtures.ts and update the parser before importing.",
    );
  }
  const records = json.data.map((raw, i) => {
    if (!isObject(raw) || int(raw.id) === "") {
      throw new ConnectorParseError(`EliteProspects player #${i + 1} has no numeric id; refusing to import an unrecognized shape.`);
    }
    const first = str(raw.firstName);
    const last = str(raw.lastName);
    const name = first || last ? [first, last].filter(Boolean).join(" ") : str(raw.name);
    const dob = str(raw.dateOfBirth);
    const shoots = str(raw.shoots);
    return {
      external_id: int(raw.id),
      full_name: name,
      first_name: first,
      last_name: last,
      position: normalizePosition(raw.position),
      shoots_catches: shoots === "L" || shoots === "R" ? shoots : "",
      date_of_birth: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : "",
      // Height/weight/birthplace are not mapped until a real response has
      // been recorded and their units/shape verified.
      height_cm: "",
      weight_kg: "",
      birth_city: "",
      birth_country: "",
    };
  });
  return {
    records,
    effectiveSeason: null,
    warnings: ["EliteProspects mapping is limited to id, name, position, shoots, and date of birth until a real response fixture is recorded."],
  };
}
