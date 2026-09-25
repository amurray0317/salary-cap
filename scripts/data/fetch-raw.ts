/**
 * Offline raw-data fetcher for the xG and prospect models.
 *
 * Downloads, through the same allowlist + per-host rate limiter the app
 * connectors use, into a gzip disk cache under .data/raw (gitignored):
 *   - NHL play-by-play for every regular-season and playoff game of the
 *     given seasons, plus that season's skater bios (handedness, position)
 *   - NHL draft picks for the given years, each pick linked to an NHL
 *     player id (verified against the landing page's draft details), and
 *     the landing page (full career, all leagues) of every linked player
 *   - NHL Central Scouting skater rankings; with --rank-links, every ranked
 *     player linked to an NHL id (verified by exact birth date)
 *   - NHL regular-season skater summaries per season (games, TOI per game)
 *   - HockeyTech leagues (OHL, WHL, QMJHL, USHL, AHL, ECHL): every completed
 *     regular season's skater stats and team rosters (for birth dates)
 *
 * Files already on disk are not re-fetched. Only FINAL games are cached.
 * Nothing is dropped silently: every failure and every unresolved draft pick
 * is written to .data/raw/_report.json and counted in the exit summary.
 *
 * Usage (Node's fetch needs NODE_USE_ENV_PROXY=1 behind an HTTPS proxy):
 *   npm run data:fetch -- --pbp 20212022,20222023 --draft 2005-2025 --rankings 2008-2026
 *   npm run data:fetch -- --rank-links 2008-2019 --nhl-seasons 2005-2025
 *   npm run data:fetch -- --ht ohl,whl,qmjhl,ushl --ht-years 2003-2025
 */
import fs from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { ConnectorHttpError, rateLimitedGet, type ConnectorKey, type FetchImpl } from "@/lib/connectors/http";
import { HT_LEAGUES, htUrls, parseHtSeasons, parseHtTeams, type HtLeague } from "@/lib/connectors/hockeytech";
import { linkDraftPick, linkRankedPlayer, parseDraftPickRefs, parseRankings, parseSearchResults, type LinkOutcome } from "@/lib/prospects/draftLink";

export const RAW_DIR = path.join(process.cwd(), ".data", "raw");
const fetchImpl: FetchImpl = (url, init) => fetch(url, init);

interface Report {
  startedAt: string;
  finishedAt?: string;
  failures: Array<{ url: string; error: string }>;
  notFinal: string[];
  unresolvedPicks: Array<{ draftYear: number; overallPick: number; name: string; reason: string }>;
  noSelectionPicks: Array<{ draftYear: number; overallPick: number; note: string }>;
  yearErrors: Array<{ draftYear: number; error: string }>;
  counts: Record<string, number>;
}
const report: Report = {
  startedAt: new Date().toISOString(),
  failures: [],
  notFinal: [],
  unresolvedPicks: [],
  noSelectionPicks: [],
  yearErrors: [],
  counts: {},
};
const bump = (k: string, n = 1) => (report.counts[k] = (report.counts[k] ?? 0) + n);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` over items with up to `n` in flight. The shared limiter still
 * spaces request STARTS per host; concurrency only hides response latency.
 */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * GET JSON with up to 3 attempts on network errors, 429 and 5xx. HockeyTech's
 * stat views wrap JSON in parentheses (JSONP style); those are stripped.
 */
async function getJson(url: string, connector: ConnectorKey = "nhl_api"): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await rateLimitedGet(connector, url, fetchImpl);
      const body = res.body.trim();
      return JSON.parse(body.startsWith("(") && body.endsWith(")") ? body.slice(1, -1) : body);
    } catch (err) {
      lastErr = err;
      const status = err instanceof ConnectorHttpError ? err.status : -1;
      if (!(status === 0 || status === 429 || status >= 500)) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

function readGz(file: string): unknown | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8"));
}
function writeGz(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, gzipSync(JSON.stringify(data)));
  fs.renameSync(tmp, file); // atomic: an interrupted run never leaves a half-written cache file
}

/** Cached JSON fetch. Returns null (and records the failure) if the request fails. */
async function cached(
  file: string,
  url: string,
  accept: (d: unknown) => boolean = () => true,
  connector: ConnectorKey = "nhl_api",
): Promise<unknown | null> {
  const hit = readGz(file);
  if (hit !== null) {
    bump("cache_hits");
    return hit;
  }
  try {
    const data = await getJson(url, connector);
    bump("fetched");
    if (accept(data)) writeGz(file, data);
    return data;
  } catch (err) {
    report.failures.push({ url, error: err instanceof Error ? err.message : String(err) });
    bump("failures");
    return null;
  }
}

// ---------------------------------------------------------------- play-by-play

const FINAL_STATES = new Set(["OFF", "FINAL"]);
/** Schedule gameStateId values for completed games (6 FINAL, 7 OFF). */
const FINAL_STATE_IDS = new Set([6, 7]);

async function fetchSeasonPbp(season: string) {
  for (const gameType of [2, 3]) {
    const listUrl = `https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${season}%20and%20gameType=${gameType}`;
    const list = (await getJson(listUrl)) as { data?: Array<{ id: number; gameStateId: number }> };
    if (!Array.isArray(list.data)) throw new Error(`game list for ${season}/${gameType} has no data array`);
    // Playoff schedules list "if necessary" games that may never be played;
    // only completed games are requested. The rest are counted, not failed.
    const games = list.data.filter((g) => FINAL_STATE_IDS.has(g.gameStateId)).map((g) => g.id).sort((a, b) => a - b);
    bump(`not_completed_${season}_${gameType}`, list.data.length - games.length);
    await cached(
      path.join(RAW_DIR, "nhl", "bios", `skaters_${season}_${gameType}.json.gz`),
      `https://api.nhle.com/stats/rest/en/skater/bios?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=${gameType}`,
    );
    let done = 0;
    await pool(games, 3, async (id) => {
      const url = `https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`;
      const data = await cached(path.join(RAW_DIR, "nhl", "pbp", season, `${id}.json.gz`), url, (d) =>
        FINAL_STATES.has(String((d as { gameState?: unknown }).gameState)),
      );
      if (data && !FINAL_STATES.has(String((data as { gameState?: unknown }).gameState))) report.notFinal.push(url);
      done += 1;
      if (done % 200 === 0 || done === games.length) console.log(`[pbp] ${season} type ${gameType}: ${done}/${games.length}`);
    });
    bump(`games_${season}_${gameType}`, games.length);
  }
}

/**
 * Shift charts (who was on the ice, second by second) for every completed
 * game: the input for on-ice RAPM and WAR. api.nhle.com, so it runs
 * alongside the play-by-play download (api-web.nhle.com) without sharing a
 * rate limit. A game whose shift list is empty is not cached (the NHL
 * sometimes publishes shifts late) and is retried on the next run.
 */
async function fetchSeasonShifts(season: string) {
  for (const gameType of [2, 3]) {
    const listUrl = `https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${season}%20and%20gameType=${gameType}`;
    const list = (await getJson(listUrl)) as { data?: Array<{ id: number; gameStateId: number }> };
    if (!Array.isArray(list.data)) throw new Error(`game list for ${season}/${gameType} has no data array`);
    const games = list.data.filter((g) => FINAL_STATE_IDS.has(g.gameStateId)).map((g) => g.id).sort((a, b) => a - b);
    let done = 0;
    let empty = 0;
    await pool(games, 3, async (id) => {
      const url = `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`;
      const data = await cached(path.join(RAW_DIR, "nhl", "shifts", season, `${id}.json.gz`), url, (d) => {
        const rows = (d as { data?: unknown[] }).data;
        return Array.isArray(rows) && rows.length > 0;
      });
      if (!data || !Array.isArray((data as { data?: unknown[] }).data) || (data as { data: unknown[] }).data.length === 0) empty += 1;
      done += 1;
      if (done % 200 === 0 || done === games.length) console.log(`[shifts] ${season} type ${gameType}: ${done}/${games.length}`);
    });
    bump(`shift_games_${season}_${gameType}`, games.length);
    bump(`shift_games_empty_${season}_${gameType}`, empty);
  }
}

// ------------------------------------------------------------------- draft

const landing = (id: string) => cached(path.join(RAW_DIR, "nhl", "landing", `${id}.json.gz`), `https://api-web.nhle.com/v1/player/${id}/landing`);
const search = async (q: string) => {
  const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=20&q=${encodeURIComponent(q)}`;
  const key = q.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const json = await cached(path.join(RAW_DIR, "nhl", "search", `${key}.json.gz`), url);
  return json ? parseSearchResults(json) : [];
};

async function fetchDraftYear(year: number) {
  const picksJson = await cached(
    path.join(RAW_DIR, "nhl", "draft", `picks_${year}.json.gz`),
    `https://api-web.nhle.com/v1/draft/picks/${year}/all`,
  );
  if (!picksJson) return;
  const { picks, noSelection } = parseDraftPickRefs(picksJson, year);
  report.noSelectionPicks.push(...noSelection);
  bump("picks_no_selection", noSelection.length);
  const links: Array<{ pick: (typeof picks)[number]; outcome: LinkOutcome }> = [];
  for (const pick of picks) {
    const outcome = await linkDraftPick(pick, { search, landing });
    links.push({ pick, outcome });
    if (outcome.status === "linked") bump("picks_linked");
    else {
      bump("picks_unresolved");
      report.unresolvedPicks.push({ draftYear: year, overallPick: pick.overallPick, name: `${pick.firstName} ${pick.lastName}`, reason: outcome.reason });
    }
  }
  fs.mkdirSync(path.join(RAW_DIR, "nhl", "draft"), { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, "nhl", "draft", `links_${year}.json`), JSON.stringify(links, null, 1));
  const linked = links.filter((l) => l.outcome.status === "linked").length;
  console.log(`[draft] ${year}: ${linked}/${picks.length} picks linked`);
}

// --------------------------------------------------------- central scouting

/** NHL Central Scouting final/midterm lists, skaters only (1 North American, 2 International). */
async function fetchRankings(year: number) {
  for (const category of [1, 2]) {
    await cached(
      path.join(RAW_DIR, "nhl", "rankings", `rankings_${year}_${category}.json.gz`),
      `https://api-web.nhle.com/v1/draft/rankings/${year}/${category}`,
    );
  }
  bump("ranking_years");
}

/**
 * Links every ranked skater (final or midterm rank) of one draft year to an
 * NHL id. Unresolved rows are written too, with the reason: they are the
 * players who were never drafted or signed (or whose name the index spells
 * differently; the Python step measures that rate on drafted players).
 */
async function linkRankingsYear(year: number) {
  const links: Array<{ row: ReturnType<typeof parseRankings>[number]; outcome: LinkOutcome }> = [];
  for (const category of [1, 2] as const) {
    const json = await cached(
      path.join(RAW_DIR, "nhl", "rankings", `rankings_${year}_${category}.json.gz`),
      `https://api-web.nhle.com/v1/draft/rankings/${year}/${category}`,
    );
    if (!json) continue;
    for (const row of parseRankings(json, year, category)) {
      if (row.finalRank === null && row.midtermRank === null) continue;
      const outcome = await linkRankedPlayer(row, { search, landing });
      links.push({ row, outcome });
      bump(outcome.status === "linked" ? "ranked_linked" : "ranked_unresolved");
    }
  }
  fs.writeFileSync(path.join(RAW_DIR, "nhl", "rankings", `links_${year}.json`), JSON.stringify(links, null, 1));
  const linked = links.filter((l) => l.outcome.status === "linked").length;
  console.log(`[rank-links] ${year}: ${linked}/${links.length} ranked skaters linked to an NHL id`);
}

// ------------------------------------------------------------ NHL seasons

/** Regular-season skater summaries (games played, TOI per game, team) for one season. */
async function fetchSkaterSeason(startYear: number) {
  const season = `${startYear}${startYear + 1}`;
  const url = `https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=false&limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;
  const data = await cached(path.join(RAW_DIR, "nhl", "skater_summary", `summary_${season}.json.gz`), url, (d) => {
    const rows = (d as { data?: unknown }).data;
    return Array.isArray(rows) && rows.length > 0;
  });
  const rows = (data as { data?: unknown[] } | null)?.data;
  if (data && !(Array.isArray(rows) && rows.length > 0)) throw new Error(`skater summary ${season} has no rows`);
  bump("skater_seasons");
}

// ------------------------------------------------------------- hockeytech

/**
 * One HockeyTech league: every COMPLETED regular season starting in `years`
 * (a season still in progress is skipped, never cached): all skater stat
 * lines in one request, plus each team's roster for birth dates and
 * positions. Stored under .data/raw/ht/<league>/<seasonId>/.
 */
async function fetchHtLeague(league: HtLeague, years: number[]) {
  const dir = path.join(RAW_DIR, "ht", league.code);
  // The season list changes as seasons are added: always fetched fresh.
  const seasonsJson = await getJson(htUrls.seasons(league), "hockeytech");
  fs.mkdirSync(dir, { recursive: true });
  writeGz(path.join(dir, "seasons.json.gz"), seasonsJson);
  const today = new Date().toISOString().slice(0, 10);
  const wanted = parseHtSeasons(seasonsJson).filter((s) => s.regular && years.includes(Number(s.label.slice(0, 4))));
  for (const s of wanted) {
    if (!s.endDate || s.endDate >= today) {
      bump(`ht_${league.code}_in_progress_skipped`);
      continue;
    }
    const sdir = path.join(dir, s.seasonId);
    const stats = await cached(path.join(sdir, "skaters.json.gz"), htUrls.skaterStats(league, s.seasonId), () => true, "hockeytech");
    const teamsJson = await cached(path.join(sdir, "teams.json.gz"), htUrls.teams(league, s.seasonId), () => true, "hockeytech");
    if (!stats || !teamsJson) continue;
    const teams = parseHtTeams(teamsJson);
    for (const t of teams) {
      await cached(path.join(sdir, `roster_${t.teamId}.json.gz`), htUrls.roster(league, t.teamId, s.seasonId), () => true, "hockeytech");
    }
    bump(`ht_${league.code}_seasons`);
    console.log(`[ht] ${league.name} ${s.label}: ${teams.length} teams`);
  }
}

// -------------------------------------------------------------------- main

function parseArgs(argv: string[]) {
  const out: { pbp: string[]; shifts: string[]; draft: number[]; rankings: number[]; rankLinks: number[]; nhlSeasons: number[]; ht: HtLeague[]; htYears: number[] } = {
    pbp: [],
    shifts: [],
    draft: [],
    rankings: [],
    rankLinks: [],
    nhlSeasons: [],
    ht: [],
    htYears: [],
  };
  const range = (spec: string | undefined, flag: string) => {
    const [a, b] = (spec ?? "").split("-").map(Number);
    if (!a || !b || b < a) throw new Error(`${flag} expects a range like 2008-2026`);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pbp") out.pbp = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (argv[i] === "--shifts") out.shifts = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (argv[i] === "--draft") out.draft = range(argv[++i], "--draft");
    else if (argv[i] === "--rankings") out.rankings = range(argv[++i], "--rankings");
    else if (argv[i] === "--rank-links") out.rankLinks = range(argv[++i], "--rank-links");
    else if (argv[i] === "--nhl-seasons") out.nhlSeasons = range(argv[++i], "--nhl-seasons");
    else if (argv[i] === "--ht-years") out.htYears = range(argv[++i], "--ht-years");
    else if (argv[i] === "--ht") {
      out.ht = (argv[++i] ?? "").split(",").filter(Boolean).map((c) => {
        const l = HT_LEAGUES[c as HtLeague["code"]];
        if (!l) throw new Error(`--ht: unknown league ${c} (${Object.keys(HT_LEAGUES).join(", ")})`);
        return l;
      });
    }
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  for (const s of out.pbp) if (!/^\d{8}$/.test(s)) throw new Error(`season ${s} must look like 20252026`);
  for (const s of out.shifts) if (!/^\d{8}$/.test(s)) throw new Error(`season ${s} must look like 20252026`);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ht.length > 0 && args.htYears.length === 0) throw new Error("--ht needs --ht-years (e.g. 2003-2025)");
  if (Object.values(args).every((v) => v.length === 0)) {
    throw new Error("nothing to do: pass --pbp, --shifts, --draft, --rankings, --rank-links, --nhl-seasons and/or --ht");
  }
  // PBP and draft run concurrently; the shared limiter still spaces requests per host.
  await Promise.all([
    (async () => {
      for (const s of args.pbp) await fetchSeasonPbp(s);
    })(),
    (async () => {
      for (const s of args.shifts) await fetchSeasonShifts(s);
    })(),
    (async () => {
      for (const y of args.rankings) await fetchRankings(y);
      for (const y of args.nhlSeasons) await fetchSkaterSeason(y);
    })(),
    (async () => {
      for (const l of args.ht) {
        try {
          await fetchHtLeague(l, args.htYears);
        } catch (err) {
          report.failures.push({ url: `hockeytech:${l.code}`, error: err instanceof Error ? err.message : String(err) });
          console.error(`[ht] ${l.name} failed:`, err);
        }
      }
    })(),
    // Four ranking years at a time (the per-host limiter still spaces
    // requests); a failing year is recorded and the others continue.
    pool(args.rankLinks, 4, async (y) => {
      try {
        await linkRankingsYear(y);
      } catch (err) {
        report.yearErrors.push({ draftYear: y, error: `rank-links: ${err instanceof Error ? err.message : String(err)}` });
        console.error(`[rank-links] ${y} failed:`, err);
      }
    }),
    // Two draft years at a time; each year's picks are linked in order. A
    // failing year is recorded and the others continue.
    pool(args.draft, 2, async (y) => {
      try {
        await fetchDraftYear(y);
      } catch (err) {
        report.yearErrors.push({ draftYear: y, error: err instanceof Error ? err.message : String(err) });
        console.error(`[draft] ${y} failed:`, err);
      }
    }),
  ]);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, "_report.json"), JSON.stringify(report, null, 1));
  console.log("counts:", report.counts);
  console.log(
    `failures: ${report.failures.length}, draft-year errors: ${report.yearErrors.length}, not-final games: ${report.notFinal.length}, ` +
      `unresolved picks: ${report.unresolvedPicks.length}, picks with no player: ${report.noSelectionPicks.length}`,
  );
  if (report.failures.length > 0 || report.yearErrors.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
