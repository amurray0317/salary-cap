/**
 * Read models for imported real-world reference data. Every query is scoped
 * by organizationId (the caller passes the id from resolveAppContext /
 * requireOrgAccess), so one organization never sees another's imports.
 */
import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { PROSPECT_SOURCE } from "@/lib/models/versions";

export async function referenceSummary(organizationId: string) {
  const db = getDb();
  const n = async (table: typeof schema.extPlayers | typeof schema.extPlayerSeasons | typeof schema.extTeamSeasons | typeof schema.extDraftPicks | typeof schema.extDraftRankings) => {
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.organizationId, organizationId));
    return row?.n ?? 0;
  };
  const [players, seasons, teams, picks, rankings] = await Promise.all([
    n(schema.extPlayers),
    n(schema.extPlayerSeasons),
    n(schema.extTeamSeasons),
    n(schema.extDraftPicks),
    n(schema.extDraftRankings),
  ]);
  return { players, seasons, teams, picks, rankings };
}

export async function listDataSources(organizationId: string, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(schema.dataSources)
    .where(and(eq(schema.dataSources.organizationId, organizationId), sql`${schema.dataSources.sourceKey} is not null`))
    .orderBy(desc(schema.dataSources.retrievedAt))
    .limit(limit);
}

export interface PlayerListRow {
  externalId: string;
  name: string;
  position: string | null;
  team: string | null;
  dateOfBirth: string | null;
  bioSource: string | null;
  seasonLines: number;
  sources: string[];
  latestSeason: string | null;
}

/** Players known from bios (ext_players) and/or season lines (ext_player_seasons), merged on external id. */
export async function listReferencePlayers(organizationId: string, opts: { q?: string; limit?: number } = {}): Promise<PlayerListRow[]> {
  const db = getDb();
  const q = opts.q?.trim();
  const p = schema.extPlayers;
  const s = schema.extPlayerSeasons;
  const bios = await db
    .select()
    .from(p)
    .where(and(eq(p.organizationId, organizationId), q ? ilike(p.fullName, `%${q}%`) : undefined));
  const lines = await db
    .select({
      externalId: s.externalPlayerId,
      name: sql<string | null>`max(${s.playerName})`,
      position: sql<string | null>`max(${s.position})`,
      latestSeason: sql<string | null>`max(${s.season})`,
      n: count(),
      sources: sql<string[]>`array_agg(distinct ${s.source})`,
    })
    .from(s)
    .where(and(eq(s.organizationId, organizationId), q ? ilike(s.playerName, `%${q}%`) : undefined))
    .groupBy(s.externalPlayerId);

  const g = schema.extPlayerGameLogs;
  const logs = await db
    .select({
      externalId: g.externalPlayerId,
      name: sql<string | null>`max(${g.playerName})`,
      latestSeason: sql<string | null>`max(${g.season})`,
      n: count(),
    })
    .from(g)
    .where(and(eq(g.organizationId, organizationId), q ? ilike(g.playerName, `%${q}%`) : undefined))
    .groupBy(g.externalPlayerId);

  const byId = new Map<string, PlayerListRow>();
  for (const b of bios) {
    byId.set(`${b.source}:${b.externalId}`, {
      externalId: b.externalId,
      name: b.fullName,
      position: b.position,
      team: b.currentTeamAbbrev,
      dateOfBirth: b.dateOfBirth,
      bioSource: b.source,
      seasonLines: 0,
      sources: [b.source],
      latestSeason: null,
    });
  }
  for (const l of lines) {
    // Season lines are keyed by NHL player id (NHL API and MoneyPuck share it).
    const key = `nhl:${l.externalId}`;
    const existing = byId.get(key);
    if (existing) {
      existing.seasonLines = l.n;
      existing.sources = [...new Set([...existing.sources, ...l.sources])];
      existing.latestSeason = l.latestSeason;
      existing.position ??= l.position;
    } else {
      byId.set(key, {
        externalId: l.externalId,
        name: l.name ?? l.externalId,
        position: l.position,
        team: null,
        dateOfBirth: null,
        bioSource: null,
        seasonLines: l.n,
        sources: l.sources,
        latestSeason: l.latestSeason,
      });
    }
  }
  for (const l of logs) {
    const key = `nhl:${l.externalId}`;
    const existing = byId.get(key);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, "nhl_game_logs"])];
      if (!existing.latestSeason || (l.latestSeason && l.latestSeason > existing.latestSeason)) existing.latestSeason = l.latestSeason;
    } else {
      byId.set(key, {
        externalId: l.externalId,
        name: l.name ?? l.externalId,
        position: null,
        team: null,
        dateOfBirth: null,
        bioSource: null,
        seasonLines: 0,
        sources: ["nhl_game_logs"],
        latestSeason: l.latestSeason,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, opts.limit ?? 500);
}

export async function getReferencePlayer(organizationId: string, externalId: string) {
  const db = getDb();
  const bios = await db
    .select()
    .from(schema.extPlayers)
    .where(and(eq(schema.extPlayers.organizationId, organizationId), eq(schema.extPlayers.externalId, externalId)));
  const seasons = await db
    .select()
    .from(schema.extPlayerSeasons)
    .where(and(eq(schema.extPlayerSeasons.organizationId, organizationId), eq(schema.extPlayerSeasons.externalPlayerId, externalId)))
    .orderBy(asc(schema.extPlayerSeasons.season), asc(schema.extPlayerSeasons.gameType));
  const roster = await db
    .select()
    .from(schema.extRosterEntries)
    .where(and(eq(schema.extRosterEntries.organizationId, organizationId), eq(schema.extRosterEntries.externalPlayerId, externalId)))
    .orderBy(desc(schema.extRosterEntries.season));
  const gameLogs = await db
    .select()
    .from(schema.extPlayerGameLogs)
    .where(and(eq(schema.extPlayerGameLogs.organizationId, organizationId), eq(schema.extPlayerGameLogs.externalPlayerId, externalId)))
    .orderBy(asc(schema.extPlayerGameLogs.gameDate));
  const prospects = await db
    .select()
    .from(schema.extProspectProjections)
    .where(
      and(
        eq(schema.extProspectProjections.organizationId, organizationId),
        eq(schema.extProspectProjections.source, PROSPECT_SOURCE),
        eq(schema.extProspectProjections.externalPlayerId, externalId),
      ),
    );
  const sourceIds = [
    ...new Set([...bios, ...seasons, ...roster, ...gameLogs, ...prospects].map((r) => r.sourceId).filter((x): x is string => !!x)),
  ];
  const sources =
    sourceIds.length > 0
      ? await db
          .select()
          .from(schema.dataSources)
          .where(and(eq(schema.dataSources.organizationId, organizationId), inArray(schema.dataSources.id, sourceIds)))
          .orderBy(desc(schema.dataSources.retrievedAt))
      : [];
  if (bios.length === 0 && seasons.length === 0 && roster.length === 0 && gameLogs.length === 0 && prospects.length === 0) return null;
  return { bios, seasons, roster, gameLogs, prospect: prospects[0] ?? null, sources };
}

export async function listDraftRankings(organizationId: string, opts: { year?: number; category?: number }) {
  const db = getDb();
  const t = schema.extDraftRankings;
  const years = await db
    .selectDistinct({ year: t.draftYear, category: t.categoryId })
    .from(t)
    .where(eq(t.organizationId, organizationId))
    .orderBy(desc(t.draftYear), asc(t.categoryId));
  const year = opts.year ?? years[0]?.year;
  const category = opts.category ?? years.find((y) => y.year === year)?.category ?? 1;
  const rows =
    year === undefined
      ? []
      : await db
          .select()
          .from(t)
          .where(and(eq(t.organizationId, organizationId), eq(t.draftYear, year), eq(t.categoryId, category)))
          .orderBy(sql`${t.finalRank} asc nulls last`, sql`${t.midtermRank} asc nulls last`, asc(t.playerName));
  return { available: years, year: year ?? null, category, rows };
}

export async function listDraftPicks(organizationId: string, opts: { year?: number }) {
  const db = getDb();
  const t = schema.extDraftPicks;
  const years = await db.selectDistinct({ year: t.draftYear }).from(t).where(eq(t.organizationId, organizationId)).orderBy(desc(t.draftYear));
  const year = opts.year ?? years[0]?.year;
  const rows =
    year === undefined
      ? []
      : await db
          .select()
          .from(t)
          .where(and(eq(t.organizationId, organizationId), eq(t.draftYear, year)))
          .orderBy(asc(t.overallPick));
  return { years: years.map((y) => y.year), year: year ?? null, rows };
}

export async function listTeamSeasons(organizationId: string, opts: { season?: string; situation?: string }) {
  const db = getDb();
  const t = schema.extTeamSeasons;
  const seasons = await db.selectDistinct({ season: t.season }).from(t).where(eq(t.organizationId, organizationId)).orderBy(desc(t.season));
  const season = opts.season ?? seasons[0]?.season;
  const situation = opts.situation ?? "all";
  const rows =
    season === undefined
      ? []
      : await db
          .select()
          .from(t)
          .where(and(eq(t.organizationId, organizationId), eq(t.season, season), eq(t.situation, situation)))
          .orderBy(asc(t.teamAbbrev), asc(t.source));
  return { seasons: seasons.map((s) => s.season), season: season ?? null, situation, rows };
}

/** RosterIQ prospect projections for one draft (default: the latest imported). */
export async function listProspectProjections(organizationId: string, opts: { year?: number }) {
  const db = getDb();
  const t = schema.extProspectProjections;
  const scope = and(eq(t.organizationId, organizationId), eq(t.source, PROSPECT_SOURCE));
  const years = await db.selectDistinct({ year: t.draftYear }).from(t).where(scope).orderBy(desc(t.draftYear));
  const year = opts.year ?? years[0]?.year;
  const rows =
    year === undefined
      ? []
      : await db
          .select()
          .from(t)
          .where(and(scope, eq(t.draftYear, year)))
          .orderBy(asc(t.overallPick));
  return { years: years.map((y) => y.year), year: year ?? null, rows };
}

/** Latest imported standings for one season (default: the newest imported), regular season first. */
export async function listStandings(organizationId: string, opts: { season?: string; gameType?: string }) {
  const db = getDb();
  const t = schema.extTeamStandings;
  const scope = eq(t.organizationId, organizationId);
  const seasons = await db.selectDistinct({ season: t.season }).from(t).where(scope).orderBy(desc(t.season));
  const season = opts.season ?? seasons[0]?.season;
  const gameType = opts.gameType ?? "regular";
  const rows =
    season === undefined
      ? []
      : await db
          .select()
          .from(t)
          .where(and(scope, eq(t.season, season), eq(t.gameType, gameType)))
          .orderBy(asc(t.leagueRank), desc(t.points));
  const asOf = rows.reduce<string | null>((a, r) => (a === null || r.standingsDate > a ? r.standingsDate : a), null);
  return { seasons: seasons.map((s) => s.season), season: season ?? null, gameType, asOf, rows };
}
