/**
 * Real-data connector orchestration:
 *
 *   validated request → cached, rate-limited fetch(es) → pure parser →
 *   createConnectorImport (pending) → validation → awaiting_approval
 *
 * It never writes reference data itself; rows reach ext_* tables only when a
 * user explicitly approves the resulting import (importService.commitImport).
 *
 * Tenancy: the response cache, the import, and every committed row are keyed
 * by the caller's organization. Callers MUST pass an organizationId obtained
 * from requireOrgAccess (see connectorActions).
 *
 * No "server-only" import so integration tests can run it with a stub fetch.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  CACHE_TTL_MS,
  ConnectorHttpError,
  cacheKeyFor,
  rateLimitedGet,
  rateLimiter as defaultLimiter,
  redactUrl,
  type ConnectorKey,
  type FetchImpl,
} from "@/lib/connectors/http";
import type { HostRateLimiter } from "@/lib/connectors/rateLimiter";
import {
  NHL_CREDIT,
  NHL_CS_CREDIT,
  NHL_TERMS,
  RANKING_CATEGORIES,
  nhlUrls,
  parseDraftPicks,
  parseDraftRankings,
  parseGameLog,
  parseGoalieSummary,
  parsePlayerBios,
  parsePlayerCareer,
  parseRoster,
  parseSkaterSummary,
  parseTeamIndex,
  parseTeamSummary,
} from "@/lib/connectors/nhl";
import {
  MONEYPUCK_CREDIT,
  MONEYPUCK_SITUATIONS,
  MONEYPUCK_TERMS,
  moneyPuckUrl,
  parseMoneyPuckGoalies,
  parseMoneyPuckSkaters,
  parseMoneyPuckTeams,
} from "@/lib/connectors/moneypuck";
import { EP_CREDIT, EP_TERMS, epPlayerSearchUrl, getEpConfig, parseEpError, parseEpPlayers } from "@/lib/connectors/eliteprospects";
import {
  MODEL_FILES,
  ROSTERIQ_MODELS_CREDIT,
  ROSTERIQ_MODELS_TERMS,
  modelFilesStatus,
  parseModelCsv,
  readModelCard,
  readModelFile,
  type ModelFileKey,
} from "@/lib/connectors/rosteriqModels";
import { CsvParseError } from "@/lib/import/csvParse";
import { ConnectorParseError, seasonLabelToNhlId, toRawData, type ParsedDataset } from "@/lib/connectors/util";
import { CONNECTOR_DEFINITIONS, type ConnectorImportType } from "@/lib/import/connectorDefinitions";
import { createConnectorImport, ImportError, type ConnectorSourceMeta } from "@/server/services/importService";

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

/* ------------------------------------------------------------------ */
/* Request schema                                                      */
/* ------------------------------------------------------------------ */

const seasonLabel = z.string().regex(/^\d{4}-\d{2}$/, "Season must look like 2024-25").refine((s) => {
  const start = Number(s.slice(0, 4));
  return Number(s.slice(5)) === (start + 1) % 100;
}, "Season must be consecutive years, e.g. 2024-25");
const playerIds = z.array(z.string().regex(/^8\d{6}$/, "NHL player ids are 7 digits starting with 8")).min(1).max(25);
const gameType = z.enum(["regular", "playoffs"]);
const situations = z.array(z.enum(MONEYPUCK_SITUATIONS)).min(1).max(5);

export const connectorRequestSchema = z.discriminatedUnion("dataset", [
  z.object({ dataset: z.literal("nhl_players"), playerIds }),
  z.object({ dataset: z.literal("nhl_player_seasons"), playerIds }),
  z.object({ dataset: z.literal("nhl_game_logs"), playerIds: playerIds.max(10), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("nhl_roster"), team: z.string().regex(/^[A-Z]{3}$/, "Team must be a 3-letter tri-code"), season: seasonLabel }),
  z.object({ dataset: z.literal("nhl_skater_stats"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("nhl_goalie_stats"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("nhl_team_stats"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("nhl_draft_picks"), year: z.number().int().min(1963).max(2100), round: z.union([z.literal("all"), z.number().int().min(1).max(7)]) }),
  z.object({ dataset: z.literal("nhl_draft_rankings"), year: z.number().int().min(2008).max(2100), category: z.number().int().min(1).max(4) }),
  z.object({ dataset: z.literal("moneypuck_skaters"), season: seasonLabel, gameType, situations }),
  z.object({ dataset: z.literal("moneypuck_goalies"), season: seasonLabel, gameType, situations }),
  z.object({ dataset: z.literal("moneypuck_teams"), season: seasonLabel, gameType, situations }),
  z.object({ dataset: z.literal("ep_players"), query: z.string().trim().min(2).max(80) }),
  z.object({ dataset: z.literal("rosteriq_xg_skaters"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("rosteriq_xg_goalies"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("rosteriq_xg_teams"), season: seasonLabel, gameType }),
  z.object({ dataset: z.literal("rosteriq_prospects"), draftYear: z.union([z.literal("all"), z.number().int().min(1963).max(2100)]) }),
  z.object({ dataset: z.literal("rosteriq_nhle") }),
]);
export type ConnectorRequest = z.infer<typeof connectorRequestSchema>;

/* ------------------------------------------------------------------ */
/* Cached fetch                                                        */
/* ------------------------------------------------------------------ */

export interface ConnectorDeps {
  fetchImpl?: FetchImpl;
  now?: () => Date;
  limiter?: HostRateLimiter;
  env?: Record<string, string | undefined>;
  /** Root of the model output folders (defaults to <repo>/models). */
  modelsDir?: string;
}

interface FetchedResponse {
  body: string;
  url: string; // redacted
  fetchedAt: Date;
  fromCache: boolean;
}

const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

export async function cachedFetch(
  opts: { organizationId: string; userId: string; connector: ConnectorKey; url: string; bypassCache?: boolean },
  deps: ConnectorDeps = {},
): Promise<FetchedResponse> {
  const db = getDb();
  const now = deps.now?.() ?? new Date();
  const key = cacheKeyFor(opts.url);
  const safeUrl = redactUrl(opts.url);
  const c = schema.connectorCache;

  if (!opts.bypassCache) {
    const [hit] = await db
      .select()
      .from(c)
      .where(and(eq(c.organizationId, opts.organizationId), eq(c.cacheKey, key)))
      .limit(1);
    if (hit && hit.expiresAt > now) {
      return { body: hit.body, url: safeUrl, fetchedAt: hit.fetchedAt, fromCache: true };
    }
  }

  let result;
  try {
    result = await rateLimitedGet(opts.connector, opts.url, deps.fetchImpl ?? defaultFetch, deps.limiter ?? defaultLimiter);
  } catch (err) {
    await db.insert(schema.auditLogs).values({
      organizationId: opts.organizationId,
      userId: opts.userId,
      action: "connector.fetch_failed",
      entityType: "connector",
      newValues: { connector: opts.connector, url: safeUrl, status: err instanceof ConnectorHttpError ? err.status : null },
    });
    if (err instanceof ConnectorHttpError) {
      const detail = opts.connector === "eliteprospects" ? parseEpError(err.body) : null;
      throw new ConnectorError(detail ? `${err.message}: ${detail}` : err.message);
    }
    throw err;
  }

  const fetchedAt = deps.now?.() ?? new Date();
  const expiresAt = new Date(fetchedAt.getTime() + CACHE_TTL_MS[opts.connector]);
  await db
    .insert(c)
    .values({
      organizationId: opts.organizationId,
      connectorKey: opts.connector,
      cacheKey: key,
      requestUrl: safeUrl,
      httpStatus: result.status,
      contentType: result.contentType,
      body: result.body,
      fetchedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [c.organizationId, c.cacheKey],
      set: { body: result.body, httpStatus: result.status, contentType: result.contentType, fetchedAt, expiresAt, requestUrl: safeUrl },
    });
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "connector.fetch",
    entityType: "connector",
    newValues: { connector: opts.connector, url: safeUrl, status: result.status, bytes: result.body.length },
  });
  return { body: result.body, url: safeUrl, fetchedAt, fromCache: false };
}

function parseJson(r: FetchedResponse): unknown {
  try {
    return JSON.parse(r.body);
  } catch {
    throw new ConnectorError(`Response from ${new URL(r.url).hostname} was not valid JSON`);
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

interface Plan {
  connector: ConnectorKey;
  sourceName: string;
  credit: string;
  terms: string;
  urls: string[];
  parse: (responses: FetchedResponse[]) => ParsedDataset;
}

function buildPlan(req: ConnectorRequest, env: Record<string, string | undefined>): Plan {
  const nhl = (sourceName: string, urls: string[], parse: Plan["parse"], credit = NHL_CREDIT): Plan => ({
    connector: "nhl_api",
    sourceName,
    credit,
    terms: NHL_TERMS,
    urls,
    parse,
  });
  const gt = (g: "regular" | "playoffs") => (g === "regular" ? 2 : 3) as 2 | 3;
  const gtLabel = (g: "regular" | "playoffs") => (g === "regular" ? "regular season" : "playoffs");

  switch (req.dataset) {
    case "nhl_players":
      return nhl(
        `NHL API — player bios (${req.playerIds.length} player${req.playerIds.length === 1 ? "" : "s"})`,
        req.playerIds.map(nhlUrls.playerLanding),
        (rs) => parsePlayerBios(rs.map(parseJson)),
      );
    case "nhl_player_seasons":
      return nhl(
        `NHL API — career seasons (${req.playerIds.length} player${req.playerIds.length === 1 ? "" : "s"})`,
        req.playerIds.map(nhlUrls.playerLanding),
        (rs) => {
          const parts = rs.map((r) => parsePlayerCareer(parseJson(r)));
          const seasons = parts.map((p) => p.effectiveSeason).filter((s): s is string => !!s).sort();
          return {
            records: parts.flatMap((p) => p.records),
            effectiveSeason: seasons.length ? `career through ${seasons[seasons.length - 1]}` : null,
            warnings: parts.flatMap((p) => p.warnings),
          };
        },
      );
    case "nhl_game_logs": {
      const seasonId = seasonLabelToNhlId(req.season);
      // Two requests per player: the game log (no name in it) and the landing (name).
      const urls = req.playerIds.flatMap((id) => [nhlUrls.gameLog(id, seasonId, gt(req.gameType)), nhlUrls.playerLanding(id)]);
      return nhl(
        `NHL API — game logs ${req.season} ${gtLabel(req.gameType)} (${req.playerIds.length} player${req.playerIds.length === 1 ? "" : "s"})`,
        urls,
        (rs) => {
          const parts = req.playerIds.map((id, i) => parseGameLog(parseJson(rs[2 * i]!), id, parseJson(rs[2 * i + 1]!)));
          return {
            records: parts.flatMap((p) => p.records),
            effectiveSeason: req.season,
            warnings: parts.flatMap((p) => p.warnings),
          };
        },
      );
    }
    case "nhl_roster": {
      const seasonId = seasonLabelToNhlId(req.season);
      return nhl(`NHL API — ${req.team} roster ${req.season}`, [nhlUrls.roster(req.team, seasonId)], ([r]) =>
        parseRoster(parseJson(r!), req.team, seasonId),
      );
    }
    case "nhl_skater_stats":
      return nhl(
        `NHL API — skater summary ${req.season} ${gtLabel(req.gameType)}`,
        [nhlUrls.skaterSummary(seasonLabelToNhlId(req.season), gt(req.gameType))],
        ([r]) => parseSkaterSummary(parseJson(r!), gt(req.gameType)),
      );
    case "nhl_goalie_stats":
      return nhl(
        `NHL API — goalie summary ${req.season} ${gtLabel(req.gameType)}`,
        [nhlUrls.goalieSummary(seasonLabelToNhlId(req.season), gt(req.gameType))],
        ([r]) => parseGoalieSummary(parseJson(r!), gt(req.gameType)),
      );
    case "nhl_team_stats":
      return nhl(
        `NHL API — team summary ${req.season} ${gtLabel(req.gameType)}`,
        [nhlUrls.teamSummary(seasonLabelToNhlId(req.season), gt(req.gameType)), nhlUrls.teams()],
        ([summary, index]) => parseTeamSummary(parseJson(summary!), gt(req.gameType), parseTeamIndex(parseJson(index!))),
      );
    case "nhl_draft_picks":
      return nhl(
        `NHL API — ${req.year} NHL Draft picks (${req.round === "all" ? "all rounds" : `round ${req.round}`})`,
        [nhlUrls.draftPicks(req.year, req.round)],
        ([r]) => parseDraftPicks(parseJson(r!)),
      );
    case "nhl_draft_rankings": {
      const cat = RANKING_CATEGORIES.find((c) => c.id === req.category)!;
      return nhl(
        `NHL Central Scouting — ${req.year} rankings, ${cat.label}`,
        [nhlUrls.draftRankings(req.year, req.category)],
        ([r]) => parseDraftRankings(parseJson(r!)),
        NHL_CS_CREDIT,
      );
    }
    case "moneypuck_skaters":
    case "moneypuck_goalies":
    case "moneypuck_teams": {
      const dataset = req.dataset === "moneypuck_skaters" ? "skaters" : req.dataset === "moneypuck_goalies" ? "goalies" : "teams";
      const startYear = Number(req.season.slice(0, 4));
      const parse =
        dataset === "skaters" ? parseMoneyPuckSkaters : dataset === "goalies" ? parseMoneyPuckGoalies : parseMoneyPuckTeams;
      return {
        connector: "moneypuck",
        sourceName: `MoneyPuck.com — ${dataset} ${req.season} ${gtLabel(req.gameType)} (situations: ${req.situations.join(", ")})`,
        credit: MONEYPUCK_CREDIT,
        terms: MONEYPUCK_TERMS,
        urls: [moneyPuckUrl(startYear, req.gameType, dataset)],
        parse: ([r]) => parse(r!.body, req.gameType, req.situations),
      };
    }
    case "rosteriq_xg_skaters":
    case "rosteriq_xg_goalies":
    case "rosteriq_xg_teams":
    case "rosteriq_prospects":
    case "rosteriq_nhle":
      throw new ConnectorError("RosterIQ model outputs are read from local files, not fetched");
    case "ep_players": {
      const cfg = getEpConfig(env);
      if (!cfg.enabled || !cfg.apiKey) throw new ConnectorError(cfg.reason);
      return {
        connector: "eliteprospects",
        sourceName: `EliteProspects API — player search "${req.query}"`,
        credit: EP_CREDIT,
        terms: EP_TERMS,
        urls: [epPlayerSearchUrl(req.query, cfg.apiKey)],
        parse: ([r]) => parseEpPlayers(parseJson(r!)),
      };
    }
  }
}

/**
 * Fetches (cache → rate limit → source), parses, and stages a gated import.
 * Returns the import id; the user reviews and approves it on /imports/[id].
 */
export async function runConnectorImport(
  opts: { organizationId: string; userId: string; request: ConnectorRequest; bypassCache?: boolean },
  deps: ConnectorDeps = {},
): Promise<{ importId: string; validCount: number; errorCount: number }> {
  const request = connectorRequestSchema.parse(opts.request);
  const type: ConnectorImportType = request.dataset;
  if (isModelRequest(request)) return runModelImport({ ...opts, request }, deps);
  let plan: Plan;
  try {
    plan = buildPlan(request, deps.env ?? process.env);
  } catch (err) {
    if (err instanceof ConnectorParseError) throw new ConnectorError(err.message);
    throw err;
  }

  const responses: FetchedResponse[] = [];
  for (const url of plan.urls) {
    responses.push(
      await cachedFetch(
        { organizationId: opts.organizationId, userId: opts.userId, connector: plan.connector, url, bypassCache: opts.bypassCache },
        deps,
      ),
    );
  }

  let parsed: ParsedDataset;
  try {
    parsed = plan.parse(responses);
  } catch (err) {
    if (err instanceof ConnectorParseError) throw new ConnectorError(err.message);
    throw err;
  }

  const fields = CONNECTOR_DEFINITIONS[type].fields.map((f) => f.key);
  const earliest = responses.reduce((min, r) => (r.fetchedAt < min ? r.fetchedAt : min), responses[0]!.fetchedAt);
  const sourceMeta: ConnectorSourceMeta = {
    connectorKey: plan.connector,
    sourceName: plan.sourceName,
    urls: responses.map((r) => r.url),
    retrievedAt: earliest.toISOString(),
    effectiveSeason: parsed.effectiveSeason,
    credit: plan.credit,
    termsNote: plan.terms,
    fromCache: responses.map((r) => r.fromCache),
    warnings: parsed.warnings,
    params: { ...request },
  };
  try {
    return await createConnectorImport({
      organizationId: opts.organizationId,
      userId: opts.userId,
      importType: type,
      label: plan.sourceName,
      raw: toRawData(fields, parsed.records),
      sourceMeta,
    });
  } catch (err) {
    if (err instanceof ImportError) throw new ConnectorError(err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* RosterIQ model outputs                                              */
/* ------------------------------------------------------------------ */

type ModelRequest = Extract<ConnectorRequest, { dataset: `rosteriq_${string}` }>;

const MODEL_DATASET_FILE: Record<ModelRequest["dataset"], ModelFileKey> = {
  rosteriq_xg_skaters: "xg_skaters",
  rosteriq_xg_goalies: "xg_goalies",
  rosteriq_xg_teams: "xg_teams",
  rosteriq_prospects: "prospects",
  rosteriq_nhle: "nhle",
};

function isModelRequest(r: ConnectorRequest): r is ModelRequest {
  return r.dataset in MODEL_DATASET_FILE;
}

/**
 * Stages a gated import from a RosterIQ model output file. Same pipeline as
 * the network connectors (preview → approval → commit); provenance records
 * the file path, its SHA-256, the model version and when it was trained.
 */
async function runModelImport(
  opts: { organizationId: string; userId: string; request: ModelRequest },
  deps: ConnectorDeps,
): Promise<{ importId: string; validCount: number; errorCount: number }> {
  const req = opts.request;
  const type: ConnectorImportType = req.dataset;
  const fileKey = MODEL_DATASET_FILE[req.dataset];
  const { version } = MODEL_FILES[fileKey];
  const fields = CONNECTOR_DEFINITIONS[type].fields.map((f) => f.key);

  let file, records: Array<Record<string, string>>, card: Record<string, unknown> | null;
  try {
    file = readModelFile(fileKey, deps.modelsDir);
    records = parseModelCsv(file.text, fields);
    card = readModelCard(version, deps.modelsDir);
  } catch (err) {
    if (err instanceof ConnectorParseError || err instanceof CsvParseError) throw new ConnectorError(err.message);
    throw err;
  }

  let scope: string;
  let effectiveSeason: string | null;
  if ("season" in req) {
    records = records.filter((r) => r.season === req.season && r.game_type === req.gameType);
    scope = `${req.season} ${req.gameType === "regular" ? "regular season" : "playoffs"}`;
    effectiveSeason = req.season;
  } else if (req.dataset === "rosteriq_prospects") {
    if (req.draftYear !== "all") records = records.filter((r) => r.draft_year === String(req.draftYear));
    scope = req.draftYear === "all" ? "all drafts" : `${req.draftYear} draft`;
    effectiveSeason = req.draftYear === "all" ? null : `${req.draftYear} draft`;
  } else {
    scope = "all leagues";
    effectiveSeason = null;
  }
  if (records.length === 0) throw new ConnectorError(`${file.relPath} has no rows for ${scope}`);

  const label = CONNECTOR_DEFINITIONS[type].label;
  const trainedAt = typeof card?.trained_at === "string" ? card.trained_at : null;
  const db = getDb();
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "connector.read_model_file",
    entityType: "connector",
    newValues: { file: file.relPath, sha256: file.sha256, rows: records.length, version },
  });
  const sourceMeta: ConnectorSourceMeta = {
    connectorKey: "rosteriq_models",
    sourceName: `${label} (${version}) — ${scope}`,
    urls: [`${file.relPath} (sha256 ${file.sha256.slice(0, 16)}…)`],
    retrievedAt: trainedAt ?? new Date().toISOString(),
    effectiveSeason,
    credit: ROSTERIQ_MODELS_CREDIT,
    termsNote: ROSTERIQ_MODELS_TERMS,
    fromCache: [false],
    warnings: trainedAt ? [] : ["The model card (metrics.json) is missing, so the training time is unknown."],
    params: { ...req, modelVersion: version, sha256: file.sha256, trainedAt },
  };
  try {
    return await createConnectorImport({
      organizationId: opts.organizationId,
      userId: opts.userId,
      importType: type,
      label: sourceMeta.sourceName,
      raw: toRawData(fields, records),
      sourceMeta,
    });
  } catch (err) {
    if (err instanceof ImportError) throw new ConnectorError(err.message);
    throw err;
  }
}

/** Status of each connector for the Real data page (no secrets). */
export function connectorStatus(env: Record<string, string | undefined> = process.env) {
  const ep = getEpConfig(env);
  return {
    nhl_api: { enabled: true, credit: NHL_CREDIT, terms: NHL_TERMS },
    moneypuck: { enabled: true, credit: MONEYPUCK_CREDIT, terms: MONEYPUCK_TERMS },
    eliteprospects: { enabled: ep.enabled, credit: EP_CREDIT, terms: EP_TERMS, reason: ep.reason },
    rosteriq_models: { enabled: true, credit: ROSTERIQ_MODELS_CREDIT, terms: ROSTERIQ_MODELS_TERMS, files: modelFilesStatus() },
  };
}
