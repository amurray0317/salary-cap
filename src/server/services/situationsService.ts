/**
 * Team game-state splits for the Game situations page. Public league data,
 * not organization data: fetched through the connector allowlist and rate
 * limiter, cached (memory, then a JSON file) and never stored in the
 * database. A finished season is fetched once; the season in progress is
 * refreshed every few hours, serving the cached copy while it refreshes.
 */
import fs from "fs";
import path from "path";
import { rateLimitedGet, type FetchImpl } from "@/lib/connectors/http";
import {
  TEAM_REPORTS,
  parseTeamSituations,
  teamIndexUrl,
  teamReportUrl,
  type TeamReport,
  type TeamSituations,
  type XgSplit,
} from "@/lib/connectors/nhlSituations";
import { parseModelCsv, readModelFile } from "@/lib/connectors/rosteriqModels";
import { currentSeasonLabel } from "@/lib/season";

const IN_SEASON_TTL_MS = 3 * 60 * 60_000;
// On serverless hosts only /tmp is writable (VERCEL is set on Vercel).
const CACHE_DIR = process.env.RIQ_CACHE_DIR ?? (process.env.VERCEL ? "/tmp/riq-cache/nhl-situations" : path.join(process.cwd(), ".data", "cache", "nhl-situations"));

export interface SituationsResult {
  season: string;
  gameType: "regular" | "playoffs";
  fetchedAt: string;
  teams: TeamSituations[];
  /** Whether our xG (5v5, 5v4, 4v5) was available for this season. */
  hasXg: boolean;
}

type Raw = { fetchedAt: string; reports: Record<TeamReport, unknown>; index: unknown };
const memory = new Map<string, Raw>();
const refreshing = new Set<string>();
const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

const seasonId = (label: string) => {
  if (!/^\d{4}-\d{2}$/.test(label)) throw new Error("Season must look like 2025-26");
  const y = Number(label.slice(0, 4));
  return `${y}${y + 1}`;
};

async function download(season: string, gameType: "regular" | "playoffs", fetchImpl: FetchImpl): Promise<Raw> {
  const id = seasonId(season);
  const gt = gameType === "regular" ? 2 : 3;
  const reports = {} as Record<TeamReport, unknown>;
  for (const r of TEAM_REPORTS) reports[r] = JSON.parse((await rateLimitedGet("nhl_api", teamReportUrl(r, id, gt), fetchImpl)).body);
  const index = JSON.parse((await rateLimitedGet("nhl_api", teamIndexUrl(), fetchImpl)).body);
  return { fetchedAt: new Date().toISOString(), reports, index };
}

function fileFor(key: string) {
  return path.join(CACHE_DIR, `${key}.json`);
}
function readFile(key: string): Raw | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), "utf8")) as Raw;
  } catch {
    return null;
  }
}
function writeFile(key: string, raw: Raw) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fileFor(key), JSON.stringify(raw));
  } catch {
    // Read-only filesystem (some hosts): the memory copy still applies.
  }
}

/** Our model's team xG at 5v5, 5v4 (team on the power play) and 4v5 (shorthanded), by tri-code. */
export function xgBySituation(season: string, gameType: "regular" | "playoffs"): Map<string, { ev5?: XgSplit; pp?: XgSplit; pk?: XgSplit }> {
  const out = new Map<string, { ev5?: XgSplit; pp?: XgSplit; pk?: XgSplit }>();
  let rows: Array<Record<string, string>>;
  try {
    const f = readModelFile("xg_teams");
    rows = parseModelCsv(f.text, f.text.split("\n", 1)[0]!.trim().split(","));
  } catch {
    return out;
  }
  const slot = { "5on5": "ev5", "5on4": "pp", "4on5": "pk" } as const;
  for (const r of rows) {
    if (r.season !== season || r.game_type !== gameType) continue;
    const key = slot[r.situation as keyof typeof slot];
    if (!key) continue;
    const entry = out.get(r.team_abbrev!) ?? {};
    entry[key] = { xgf: Number(r.x_goals_for), xga: Number(r.x_goals_against) };
    out.set(r.team_abbrev!, entry);
  }
  return out;
}

export async function getTeamSituations(
  season: string,
  gameType: "regular" | "playoffs",
  deps: { fetchImpl?: FetchImpl; now?: () => number } = {},
): Promise<SituationsResult> {
  const key = `${season}-${gameType}`;
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const now = (deps.now ?? Date.now)();
  const live = season === currentSeasonLabel(new Date(now));
  let raw = memory.get(key) ?? readFile(key);
  if (!raw) {
    raw = await download(season, gameType, fetchImpl);
    writeFile(key, raw);
  } else if (live && now - Date.parse(raw.fetchedAt) > IN_SEASON_TTL_MS && !refreshing.has(key)) {
    // Serve what we have; refresh in the background.
    refreshing.add(key);
    download(season, gameType, fetchImpl)
      .then((fresh) => {
        memory.set(key, fresh);
        writeFile(key, fresh);
      })
      .catch(() => undefined)
      .finally(() => refreshing.delete(key));
  }
  memory.set(key, raw);
  const xg = xgBySituation(season, gameType);
  return { season, gameType, fetchedAt: raw.fetchedAt, teams: parseTeamSituations(raw.reports, raw.index, xg), hasXg: xg.size > 0 };
}

export function clearSituationsCache(): void {
  memory.clear();
}
