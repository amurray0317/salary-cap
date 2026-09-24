/**
 * Connector HTTP policy: per-host rate limits, cache TTLs, secret redaction,
 * and a fetch wrapper with timeout + size cap. Pure/injectable so the
 * service layer and tests share one implementation.
 */
import { createHash } from "crypto";
import { HostRateLimiter } from "@/lib/connectors/rateLimiter";

export type ConnectorKey = "nhl_api" | "moneypuck" | "eliteprospects";

export const USER_AGENT = "RosterIQ/0.1 (+https://github.com/amurray0317/salary-cap; front-office data import)";

/** Allowed hosts per connector — requests anywhere else are refused. */
export const CONNECTOR_HOSTS: Record<ConnectorKey, string[]> = {
  nhl_api: ["api-web.nhle.com", "api.nhle.com", "search.d3.nhle.com"],
  moneypuck: ["moneypuck.com"],
  eliteprospects: ["api.eliteprospects.com"],
};

/** Minimum spacing between requests to one host (ms). */
export const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "api-web.nhle.com": 500,
  "api.nhle.com": 500,
  "search.d3.nhle.com": 500,
  "moneypuck.com": 2000,
  "api.eliteprospects.com": 1000,
};

const HOUR = 60 * 60 * 1000;

/** Cache TTL per connector (ms). Stable historical data could live longer; kept conservative. */
export const CACHE_TTL_MS: Record<ConnectorKey, number> = {
  nhl_api: 6 * HOUR,
  moneypuck: 12 * HOUR,
  eliteprospects: 24 * HOUR,
};

export const MAX_RESPONSE_BYTES = 10_000_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/** Shared in-process limiter (see rateLimiter.ts for the multi-instance caveat). */
export const rateLimiter = new HostRateLimiter(HOST_MIN_INTERVAL_MS, 1000);

const SECRET_PARAMS = ["apikey", "api_key", "key", "token", "access_token"];

/** Removes secret query-parameter values so URLs are safe to store and display. */
export function redactUrl(url: string): string {
  const u = new URL(url);
  for (const name of [...u.searchParams.keys()]) {
    if (SECRET_PARAMS.includes(name.toLowerCase())) u.searchParams.set(name, "REDACTED");
  }
  return u.toString();
}

export function cacheKeyFor(url: string): string {
  return createHash("sha256").update(redactUrl(url)).digest("hex");
}

export function assertAllowedHost(connector: ConnectorKey, url: string): string {
  const host = new URL(url).hostname;
  if (!CONNECTOR_HOSTS[connector].includes(host)) {
    throw new ConnectorHttpError(`${host} is not an allowed host for ${connector}`, 0);
  }
  return host;
}

export class ConnectorHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Response body on HTTP errors (e.g. EliteProspects' JSON error message). */
    public readonly body: string = "",
  ) {
    super(message);
    this.name = "ConnectorHttpError";
  }
}

export type FetchImpl = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpResult {
  status: number;
  contentType: string | null;
  body: string;
}

/** Rate-limited GET with timeout and size cap. Throws ConnectorHttpError on non-2xx. */
export async function rateLimitedGet(
  connector: ConnectorKey,
  url: string,
  fetchImpl: FetchImpl,
  limiter: HostRateLimiter = rateLimiter,
): Promise<HttpResult> {
  const host = assertAllowedHost(connector, url);
  await limiter.acquire(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/csv;q=0.9, */*;q=0.1" },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConnectorHttpError(`Request to ${host} failed: ${reason}`, 0);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ConnectorHttpError(`Response from ${host} exceeds ${MAX_RESPONSE_BYTES} bytes`, res.status);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ConnectorHttpError(`${host} returned HTTP ${res.status}`, res.status, body.slice(0, 2000));
  }
  return { status: res.status, contentType: res.headers.get("content-type"), body };
}
