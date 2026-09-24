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

export interface NameDeps {
  search: (q: string) => Promise<SearchCandidate[]>;
  landing: (id: string) => Promise<unknown>;
}

/**
 * Searches the NHL player index by name and returns the first candidate
 * whose landing page passes `accept`. Checks at most `maxChecks`
 * candidates per query.
 */
async function linkByName(
  person: { firstName: string; lastName: string },
  accept: (landing: unknown) => boolean,
  deps: NameDeps,
  maxChecks: number,
  noMatchReason: string,
  fullNameFilter: (c: SearchCandidate) => boolean = () => true,
): Promise<LinkOutcome> {
  let checked = 0;
  const seen = new Set<string>();
  // The search index sometimes spells names without accents ("Gidlof" for
  // "Gidlöf"), so accented names are also searched in plain ASCII.
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const full = `${person.firstName} ${person.lastName}`;
  const queries: Array<["full_name" | "last_name", string]> = [["full_name", full]];
  if (fold(full) !== full) queries.push(["full_name", fold(full)]);
  queries.push(["last_name", person.lastName]);
  if (fold(person.lastName) !== person.lastName) queries.push(["last_name", fold(person.lastName)]);
  for (const [via, q] of queries) {
    const ranked = rankCandidates(person, await deps.search(q));
    // A last-name query can return many unrelated players: only verify surname matches.
    const pool =
      via === "last_name" ? ranked.filter((c) => normalizeName(c.name).endsWith(normalizeName(person.lastName))) : ranked.filter(fullNameFilter);
    for (const c of pool.slice(0, maxChecks)) {
      if (seen.has(c.playerId)) continue;
      seen.add(c.playerId);
      checked += 1;
      if (accept(await deps.landing(c.playerId))) {
        return { status: "linked", playerId: c.playerId, via, candidatesChecked: checked };
      }
    }
  }
  return { status: "unresolved", reason: checked === 0 ? "no search candidates" : noMatchReason, candidatesChecked: checked };
}

/** Resolves one pick: a candidate is accepted only if its landing page reports this draft year and overall pick. */
export function linkDraftPick(pick: DraftPickRef, deps: NameDeps, maxChecks = 6): Promise<LinkOutcome> {
  return linkByName(pick, (l) => landingMatchesPick(l, pick), deps, maxChecks, "no candidate's landing page reported this draft year and pick");
}

/** A Central Scouting ranking row (skaters list), as the rankings feed gives it. */
export interface RankedPlayerRef {
  draftYear: number;
  category: 1 | 2;
  firstName: string;
  lastName: string;
  birthDate: string;
  finalRank: number | null;
  midtermRank: number | null;
}

/** True when a player landing page reports exactly this birth date. */
export function landingMatchesBirthDate(landing: unknown, birthDate: string): boolean {
  return (landing as { birthDate?: unknown })?.birthDate === birthDate;
}

/**
 * Resolves a ranked player to an NHL id: a same-surname candidate whose
 * landing page reports the same birth date. The NHL player index only holds
 * players who were drafted or signed an NHL contract, so "unresolved"
 * usually means the player never did either (and never played an NHL
 * game); spelling differences can also cause it, which is why the
 * resolution rate is measured on ranked players whose id is known.
 */
export function linkRankedPlayer(row: RankedPlayerRef, deps: NameDeps, maxChecks = 6): Promise<LinkOutcome> {
  // Most ranked players who were never drafted are not in the index at all,
  // and a full-name search then returns unrelated players: only candidates
  // whose name is close (spelling / transliteration variants) are verified.
  const target = normalizeName(`${row.firstName} ${row.lastName}`);
  const close = (c: SearchCandidate) => nameSimilarity(normalizeName(c.name), target) >= RANKED_NAME_SIMILARITY;
  return linkByName(row, (l) => landingMatchesBirthDate(l, row.birthDate), deps, maxChecks, "no candidate's landing page reported this birth date", close);
}

export const RANKED_NAME_SIMILARITY = 0.7;

/** 1 - Levenshtein distance / length of the longer string (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

/** Parses /v1/draft/rankings/{year}/{category}; rows without a name or birth date throw. */
export function parseRankings(json: unknown, draftYear: number, category: 1 | 2): RankedPlayerRef[] {
  const rows = (json as { rankings?: unknown })?.rankings;
  if (!Array.isArray(rows)) throw new ConnectorParseError(`rankings ${draftYear}/${category} has no rankings array`);
  return rows.map((r, i) => {
    const o = r as Record<string, unknown>;
    if (typeof o.firstName !== "string" || typeof o.lastName !== "string" || typeof o.birthDate !== "string") {
      throw new ConnectorParseError(`ranking row ${i} in ${draftYear}/${category} is missing name or birth date`);
    }
    return {
      draftYear,
      category,
      firstName: o.firstName,
      lastName: o.lastName,
      birthDate: o.birthDate,
      finalRank: intOrNull(o.finalRank),
      midtermRank: intOrNull(o.midtermRank),
    };
  });
}
