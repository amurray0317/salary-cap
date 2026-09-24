/**
 * Linking NHL draft picks to NHL player ids.
 *
 * The draft-picks feed (/v1/draft/picks/{year}/all) carries names but no
 * player id. We search the NHL player index by name and ACCEPT a candidate
 * only when that player's landing page reports the same draft year and
 * overall pick. A name match alone is never enough.
 */
import { ConnectorParseError } from "@/lib/connectors/util";

export interface DraftPickRef {
  draftYear: number;
  overallPick: number;
  round: number;
  firstName: string;
  lastName: string;
  positionCode: string | null;
  amateurLeague: string | null;
  amateurClubName: string | null;
  countryCode: string | null;
  heightInches: number | null;
  weightPounds: number | null;
  teamAbbrev: string | null;
}

export interface SearchCandidate {
  playerId: string;
  name: string;
}

const localized = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { default?: unknown }).default === "string") {
    return (v as { default: string }).default;
  }
  return null;
};

const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

export interface NoSelection {
  draftYear: number;
  overallPick: number;
  /** What the feed shows instead of a player, e.g. "Forfeited". */
  note: string;
}

/**
 * Parses /v1/draft/picks/{year}/all. Picks with no player (the feed puts a
 * note such as "Forfeited" in lastName and omits firstName) are returned
 * separately; any other missing required field throws.
 */
export function parseDraftPickRefs(json: unknown, draftYear: number): { picks: DraftPickRef[]; noSelection: NoSelection[] } {
  const picks = (json as { picks?: unknown })?.picks;
  if (!Array.isArray(picks)) throw new ConnectorParseError("draft picks response has no picks array");
  const out: DraftPickRef[] = [];
  const noSelection: NoSelection[] = [];
  picks.forEach((p, i) => {
    const r = p as Record<string, unknown>;
    const firstName = localized(r.firstName);
    const lastName = localized(r.lastName);
    const overallPick = intOrNull(r.overallPick);
    const round = intOrNull(r.round);
    if (overallPick !== null && !firstName && lastName && r.positionCode === undefined) {
      noSelection.push({ draftYear, overallPick, note: lastName });
      return;
    }
    if (!firstName || !lastName || overallPick === null || round === null) {
      throw new ConnectorParseError(`draft pick ${i} in ${draftYear} is missing name, round or overall pick`);
    }
    out.push({
      draftYear,
      overallPick,
      round,
      firstName,
      lastName,
      positionCode: typeof r.positionCode === "string" ? r.positionCode : null,
      amateurLeague: typeof r.amateurLeague === "string" ? r.amateurLeague : null,
      amateurClubName: typeof r.amateurClubName === "string" ? r.amateurClubName : null,
      countryCode: typeof r.countryCode === "string" ? r.countryCode : null,
      heightInches: intOrNull(r.height),
      weightPounds: intOrNull(r.weight),
      teamAbbrev: typeof r.teamAbbrev === "string" ? r.teamAbbrev : null,
    });
  });
  return { picks: out, noSelection };
}

export function parseSearchResults(json: unknown): SearchCandidate[] {
  if (!Array.isArray(json)) throw new ConnectorParseError("player search response is not an array");
  return json.flatMap((r) => {
    const o = r as Record<string, unknown>;
    const id = typeof o.playerId === "string" || typeof o.playerId === "number" ? String(o.playerId) : null;
    return id && typeof o.name === "string" ? [{ playerId: id, name: o.name }] : [];
  });
}

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Orders candidates to verify: exact full-name matches, then last-name
 * matches, then the rest (search order preserved within each group).
 */
export function rankCandidates(pick: Pick<DraftPickRef, "firstName" | "lastName">, candidates: SearchCandidate[]): SearchCandidate[] {
  const full = normalizeName(`${pick.firstName} ${pick.lastName}`);
  const last = normalizeName(pick.lastName);
  const score = (c: SearchCandidate) => {
    const n = normalizeName(c.name);
    if (n === full) return 0;
    if (n.endsWith(` ${last}`) || n === last) return 1;
    return 2;
  };
  return candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}

/** True when a player landing page reports exactly this draft year and overall pick. */
export function landingMatchesPick(landing: unknown, pick: Pick<DraftPickRef, "draftYear" | "overallPick">): boolean {
  const d = (landing as { draftDetails?: { year?: unknown; overallPick?: unknown } })?.draftDetails;
  return !!d && d.year === pick.draftYear && d.overallPick === pick.overallPick;
}

export type LinkOutcome =
  | { status: "linked"; playerId: string; via: "full_name" | "last_name"; candidatesChecked: number }
  | { status: "unresolved"; reason: string; candidatesChecked: number };

/**
 * Resolves one pick. `search(q)` returns candidates; `landing(id)` returns
 * the landing JSON. Checks at most `maxChecks` candidates per query.
 */
export async function linkDraftPick(
  pick: DraftPickRef,
  deps: { search: (q: string) => Promise<SearchCandidate[]>; landing: (id: string) => Promise<unknown> },
  maxChecks = 6,
): Promise<LinkOutcome> {
  let checked = 0;
  const seen = new Set<string>();
  const queries: Array<["full_name" | "last_name", string]> = [
    ["full_name", `${pick.firstName} ${pick.lastName}`],
    ["last_name", pick.lastName],
  ];
  for (const [via, q] of queries) {
    const ranked = rankCandidates(pick, await deps.search(q));
    // A last-name query can return many unrelated players: only verify surname matches.
    const pool = via === "last_name" ? ranked.filter((c) => normalizeName(c.name).endsWith(normalizeName(pick.lastName))) : ranked;
    for (const c of pool.slice(0, maxChecks)) {
      if (seen.has(c.playerId)) continue;
      seen.add(c.playerId);
      checked += 1;
      if (landingMatchesPick(await deps.landing(c.playerId), pick)) {
        return { status: "linked", playerId: c.playerId, via, candidatesChecked: checked };
      }
    }
  }
  return {
    status: "unresolved",
    reason: checked === 0 ? "no search candidates" : "no candidate's landing page reported this draft year and pick",
    candidatesChecked: checked,
  };
}
