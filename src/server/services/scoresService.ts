/**
 * Live NHL scoreboard for the Scores page. Public data, not organization
 * data: it is fetched on demand through the connector allowlist and rate
 * limiter, cached in memory briefly, and never stored in the database.
 */
import { rateLimitedGet, type FetchImpl } from "@/lib/connectors/http";
import { parseScoreboard, scoreboardUrl, type Scoreboard } from "@/lib/connectors/nhlScores";

/** Short while games are on, longer when the board cannot change. */
const LIVE_TTL_MS = 15_000;
const QUIET_TTL_MS = 10 * 60_000;

const cache = new Map<string, { at: number; ttl: number; board: Scoreboard }>();
const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

export async function getScoreboard(date: string, deps: { fetchImpl?: FetchImpl; now?: () => number } = {}): Promise<Scoreboard> {
  const now = (deps.now ?? Date.now)();
  const url = scoreboardUrl(date);
  const hit = cache.get(url);
  if (hit && now - hit.at < hit.ttl) return hit.board;
  const res = await rateLimitedGet("nhl_api", url, deps.fetchImpl ?? defaultFetch);
  const board = parseScoreboard(JSON.parse(res.body));
  const active = board.games.some((g) => g.status === "live" || g.status === "intermission" || g.status === "pregame");
  cache.set(url, { at: now, ttl: active || date === "now" ? LIVE_TTL_MS : QUIET_TTL_MS, board });
  return board;
}

export function clearScoreboardCache(): void {
  cache.clear();
}
