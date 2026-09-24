/**
 * Commit step for connector imports: upserts validated records into the
 * organization's external reference tables, stamping every row with the
 * data_sources row and import that produced it.
 *
 * Called ONLY from importService.commitImport inside its transaction, i.e.
 * after explicit approval. Blank values become NULL — never 0.
 *
 * No "server-only" import (same convention as importService) so the
 * integration tests can run it on in-memory PGlite.
 */
import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { CONNECTOR_DEFINITIONS, type ConnectorImportType } from "@/lib/import/connectorDefinitions";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Values = Record<string, string>;

const intOrNull = (v: string | undefined): number | null => (v === undefined || v === "" ? null : Math.round(Number(v)));
const realOrNull = (v: string | undefined): number | null => (v === undefined || v === "" ? null : Number(v));
const textOrNull = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
const boolOrNull = (v: string | undefined): boolean | null => (v === "true" ? true : v === "false" ? false : null);

/** `m_*` fields → metrics JSON (numbers), omitting anything the source did not report. */
function metricsOf(v: Values): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k.startsWith("m_") && val !== "") out[k.slice(2)] = Number(val);
  }
  return out;
}

/**
 * ON CONFLICT … DO UPDATE SET for every column except identity/created
 * columns. mode "overwrite" replaces with the incoming value (NULLs
 * included — the source is authoritative for that dataset); mode
 * "fill" keeps the existing value when the incoming one is NULL (used when
 * a dataset only carries a subset of a table's fields).
 */
function upsertSet(table: PgTable, mode: "overwrite" | "fill", skip: string[]): Record<string, SQL> {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const [prop, col] of Object.entries(cols)) {
    if (["id", "organizationId", "createdAt", ...skip].includes(prop)) continue;
    const incoming = sql`excluded.${sql.identifier(col.name)}`;
    set[prop] = mode === "overwrite" ? incoming : sql`coalesce(${incoming}, ${col})`;
  }
  return set;
}

async function insertChunks<T extends Record<string, unknown>>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 250) await insert(rows.slice(i, i + 250));
}

export interface CommitContext {
  organizationId: string;
  sourceId: string;
  importId: string;
}

export async function commitConnectorRecords(
  tx: Tx,
  type: ConnectorImportType,
  records: Array<{ values: Values }>,
  ctx: CommitContext,
): Promise<number> {
  const def = CONNECTOR_DEFINITIONS[type];
  const now = new Date();
  const stamp = { organizationId: ctx.organizationId, sourceId: ctx.sourceId, importId: ctx.importId, updatedAt: now };

  const bio = (v: Values) => ({
    ...stamp,
    source: def.sourceTag,
    externalId: v.external_id!,
    fullName: v.full_name!,
    firstName: textOrNull(v.first_name),
    lastName: textOrNull(v.last_name),
    position: textOrNull(v.position),
    shootsCatches: textOrNull(v.shoots_catches),
    dateOfBirth: textOrNull(v.date_of_birth),
    heightCm: intOrNull(v.height_cm),
    weightKg: intOrNull(v.weight_kg),
    birthCity: textOrNull(v.birth_city),
    birthCountry: textOrNull(v.birth_country),
    currentTeamAbbrev: textOrNull(v.current_team_abbrev),
    isActive: boolOrNull(v.is_active),
    draftYear: intOrNull(v.draft_year),
    draftRound: intOrNull(v.draft_round),
    draftPickInRound: intOrNull(v.draft_pick_in_round),
    draftOverall: intOrNull(v.draft_overall),
    draftTeamAbbrev: textOrNull(v.draft_team_abbrev),
  });

  const t = schema.extPlayers;
  const playerTarget = [t.organizationId, t.source, t.externalId];

  switch (def.table) {
    case "ext_players": {
      // A player-landing / EP import is the full bio for that source: overwrite.
      const rows = records.map((r) => bio(r.values));
      await insertChunks(rows, (chunk) =>
        tx.insert(t).values(chunk).onConflictDoUpdate({ target: playerTarget, set: upsertSet(t, "overwrite", []) }),
      );
      return rows.length;
    }

    case "ext_roster": {
      // Roster rows carry only part of a bio (no draft/active/current team):
      // fill blanks, never erase fields another dataset supplied.
      const players = records.map((r) => bio(r.values));
      await insertChunks(players, (chunk) =>
        tx.insert(t).values(chunk).onConflictDoUpdate({ target: playerTarget, set: upsertSet(t, "fill", []) }),
      );
      const r = schema.extRosterEntries;
      const entries = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        teamAbbrev: v.team_abbrev!,
        season: v.season!,
        externalPlayerId: v.external_id!,
        playerName: v.full_name!,
        sweaterNumber: intOrNull(v.sweater_number),
        position: textOrNull(v.position),
      }));
      await insertChunks(entries, (chunk) =>
        tx
          .insert(r)
          .values(chunk)
          .onConflictDoUpdate({
            target: [r.organizationId, r.source, r.teamAbbrev, r.season, r.externalPlayerId],
            set: upsertSet(r, "overwrite", []),
          }),
      );
      return entries.length;
    }

    case "ext_player_seasons": {
      const s = schema.extPlayerSeasons;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        rowKey: def.rowKey(v),
        externalPlayerId: v.external_player_id!,
        playerName: textOrNull(v.player_name),
        season: v.season!,
        gameType: v.game_type!,
        league: textOrNull(v.league),
        teamName: textOrNull(v.team_name),
        situation: v.situation || "all",
        position: textOrNull(v.position),
        gamesPlayed: intOrNull(v.games_played),
        goals: intOrNull(v.goals),
        assists: intOrNull(v.assists),
        points: intOrNull(v.points),
        plusMinus: intOrNull(v.plus_minus),
        penaltyMinutes: intOrNull(v.penalty_minutes),
        shots: intOrNull(v.shots),
        powerPlayGoals: intOrNull(v.pp_goals),
        powerPlayPoints: intOrNull(v.pp_points),
        shortHandedGoals: intOrNull(v.sh_goals),
        shortHandedPoints: intOrNull(v.sh_points),
        gameWinningGoals: intOrNull(v.gw_goals),
        faceoffPct: realOrNull(v.faceoff_pct),
        shootingPct: realOrNull(v.shooting_pct),
        toiSeconds: intOrNull(v.toi_seconds),
        toiPerGameSeconds: realOrNull(v.toi_per_game_seconds),
        gamesStarted: intOrNull(v.games_started),
        wins: intOrNull(v.wins),
        losses: intOrNull(v.losses),
        otLosses: intOrNull(v.ot_losses),
        shotsAgainst: intOrNull(v.shots_against),
        saves: intOrNull(v.saves),
        goalsAgainst: intOrNull(v.goals_against),
        savePct: realOrNull(v.save_pct),
        goalsAgainstAverage: realOrNull(v.gaa),
        shutouts: intOrNull(v.shutouts),
        xGoals: realOrNull(v.x_goals),
        onIceXGoalsPct: realOrNull(v.on_ice_xg_pct),
        onIceCorsiPct: realOrNull(v.on_ice_corsi_pct),
        onIceFenwickPct: realOrNull(v.on_ice_fenwick_pct),
        gameScore: realOrNull(v.game_score),
        metrics: metricsOf(v),
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(s)
          .values(chunk)
          .onConflictDoUpdate({ target: [s.organizationId, s.source, s.rowKey], set: upsertSet(s, "overwrite", []) }),
      );
      return rows.length;
    }

    case "ext_game_logs": {
      const g = schema.extPlayerGameLogs;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        externalPlayerId: v.external_player_id!,
        playerName: textOrNull(v.player_name),
        gameId: v.game_id!,
        gameDate: v.game_date!,
        season: v.season!,
        gameType: v.game_type!,
        teamAbbrev: textOrNull(v.team_abbrev),
        opponentAbbrev: textOrNull(v.opponent_abbrev),
        homeRoad: textOrNull(v.home_road),
        goals: intOrNull(v.goals),
        assists: intOrNull(v.assists),
        points: intOrNull(v.points),
        plusMinus: intOrNull(v.plus_minus),
        penaltyMinutes: intOrNull(v.penalty_minutes),
        shots: intOrNull(v.shots),
        powerPlayGoals: intOrNull(v.pp_goals),
        powerPlayPoints: intOrNull(v.pp_points),
        shortHandedGoals: intOrNull(v.sh_goals),
        shortHandedPoints: intOrNull(v.sh_points),
        gameWinningGoals: intOrNull(v.gw_goals),
        otGoals: intOrNull(v.ot_goals),
        shifts: intOrNull(v.shifts),
        toiSeconds: intOrNull(v.toi_seconds),
        gamesStarted: intOrNull(v.games_started),
        decision: textOrNull(v.decision),
        shotsAgainst: intOrNull(v.shots_against),
        goalsAgainst: intOrNull(v.goals_against),
        savePct: realOrNull(v.save_pct),
        shutouts: intOrNull(v.shutouts),
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(g)
          .values(chunk)
          .onConflictDoUpdate({
            target: [g.organizationId, g.source, g.externalPlayerId, g.gameId],
            set: upsertSet(g, "overwrite", []),
          }),
      );
      return rows.length;
    }

    case "ext_team_seasons": {
      const s = schema.extTeamSeasons;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        rowKey: def.rowKey(v),
        teamAbbrev: textOrNull(v.team_abbrev),
        teamName: textOrNull(v.team_name),
        season: v.season!,
        gameType: v.game_type!,
        situation: v.situation || "all",
        gamesPlayed: intOrNull(v.games_played),
        wins: intOrNull(v.wins),
        losses: intOrNull(v.losses),
        otLosses: intOrNull(v.ot_losses),
        points: intOrNull(v.points),
        goalsFor: intOrNull(v.goals_for),
        goalsAgainst: intOrNull(v.goals_against),
        shotsForPerGame: realOrNull(v.shots_for_per_game),
        shotsAgainstPerGame: realOrNull(v.shots_against_per_game),
        powerPlayPct: realOrNull(v.pp_pct),
        penaltyKillPct: realOrNull(v.pk_pct),
        faceoffPct: realOrNull(v.faceoff_pct),
        xGoalsFor: realOrNull(v.x_goals_for),
        xGoalsAgainst: realOrNull(v.x_goals_against),
        xGoalsPct: realOrNull(v.x_goals_pct),
        corsiPct: realOrNull(v.corsi_pct),
        fenwickPct: realOrNull(v.fenwick_pct),
        iceTimeSeconds: intOrNull(v.ice_time_seconds),
        metrics: metricsOf(v),
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(s)
          .values(chunk)
          .onConflictDoUpdate({ target: [s.organizationId, s.source, s.rowKey], set: upsertSet(s, "overwrite", []) }),
      );
      return rows.length;
    }

    case "ext_draft_picks": {
      const s = schema.extDraftPicks;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        draftYear: intOrNull(v.draft_year)!,
        round: intOrNull(v.round)!,
        pickInRound: intOrNull(v.pick_in_round),
        overallPick: intOrNull(v.overall_pick)!,
        teamAbbrev: textOrNull(v.team_abbrev),
        teamPickHistory: textOrNull(v.team_pick_history),
        playerName: v.player_name!,
        position: textOrNull(v.position),
        countryCode: textOrNull(v.country_code),
        heightInches: intOrNull(v.height_inches),
        weightPounds: intOrNull(v.weight_pounds),
        amateurClub: textOrNull(v.amateur_club),
        amateurLeague: textOrNull(v.amateur_league),
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(s)
          .values(chunk)
          .onConflictDoUpdate({
            target: [s.organizationId, s.source, s.draftYear, s.overallPick],
            set: upsertSet(s, "overwrite", []),
          }),
      );
      return rows.length;
    }

    case "ext_draft_rankings": {
      const s = schema.extDraftRankings;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        draftYear: intOrNull(v.draft_year)!,
        categoryId: intOrNull(v.category_id)!,
        categoryKey: v.category_key!,
        rowKey: def.rowKey(v),
        playerName: v.player_name!,
        position: textOrNull(v.position),
        shootsCatches: textOrNull(v.shoots_catches),
        heightInches: intOrNull(v.height_inches),
        weightPounds: intOrNull(v.weight_pounds),
        birthDate: textOrNull(v.birth_date),
        birthCity: textOrNull(v.birth_city),
        birthStateProvince: textOrNull(v.birth_state_province),
        birthCountry: textOrNull(v.birth_country),
        lastAmateurClub: textOrNull(v.last_amateur_club),
        lastAmateurLeague: textOrNull(v.last_amateur_league),
        midtermRank: intOrNull(v.midterm_rank),
        finalRank: intOrNull(v.final_rank),
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(s)
          .values(chunk)
          .onConflictDoUpdate({
            target: [s.organizationId, s.source, s.draftYear, s.categoryId, s.rowKey],
            set: upsertSet(s, "overwrite", []),
          }),
      );
      return rows.length;
    }

    case "ext_prospect_projections": {
      const t = schema.extProspectProjections;
      const rows = records.map(({ values: v }) => {
        const contributions: Record<string, number> = {};
        for (const [k, val] of Object.entries(metricsOf(v))) {
          if (k.startsWith("contrib_")) contributions[k.slice("contrib_".length)] = val;
        }
        return {
          ...stamp,
          source: def.sourceTag,
          modelVersion: v.model_version!,
          externalPlayerId: v.external_player_id!,
          playerName: v.player_name!,
          draftYear: intOrNull(v.draft_year)!,
          overallPick: intOrNull(v.overall_pick)!,
          round: intOrNull(v.round),
          position: textOrNull(v.position),
          draftedBy: textOrNull(v.drafted_by),
          birthDate: textOrNull(v.birth_date),
          ageAtDraft: realOrNull(v.age_at_draft),
          heightInches: intOrNull(v.height_inches),
          weightPounds: intOrNull(v.weight_pounds),
          d0League: textOrNull(v.d0_league),
          d0LeagueGroup: textOrNull(v.d0_league_group),
          d0GamesPlayed: intOrNull(v.d0_games_played),
          d0Points: intOrNull(v.d0_points),
          d0Ppg: realOrNull(v.d0_ppg),
          d0NhlePpg: realOrNull(v.d0_nhle_ppg),
          dm1League: textOrNull(v.dm1_league),
          dm1GamesPlayed: intOrNull(v.dm1_games_played),
          dm1Points: intOrNull(v.dm1_points),
          dm1NhlePpg: realOrNull(v.dm1_nhle_ppg),
          pNhlRegular: realOrNull(v.p_nhl_regular)!,
          baselineP: realOrNull(v.baseline_p)!,
          contributions,
          projectionKind: v.projection_kind!,
          labelMature: v.label_mature === "true",
          nhlRegular: boolOrNull(v.nhl_regular),
          nhlGp7: intOrNull(v.nhl_gp_7),
          nhlGpToDate: intOrNull(v.nhl_gp_to_date),
        };
      });
      await insertChunks(rows, (chunk) =>
        tx
          .insert(t)
          .values(chunk)
          .onConflictDoUpdate({ target: [t.organizationId, t.source, t.externalPlayerId], set: upsertSet(t, "overwrite", []) }),
      );
      return rows.length;
    }

    case "ext_league_equivalencies": {
      const t = schema.extLeagueEquivalencies;
      const rows = records.map(({ values: v }) => ({
        ...stamp,
        source: def.sourceTag,
        modelVersion: v.model_version!,
        league: v.league!,
        multiplier: realOrNull(v.multiplier)!,
        logFactor: realOrNull(v.log_factor)!,
        standardError: realOrNull(v.standard_error),
        pairs: intOrNull(v.pairs) ?? 0,
      }));
      await insertChunks(rows, (chunk) =>
        tx
          .insert(t)
          .values(chunk)
          .onConflictDoUpdate({ target: [t.organizationId, t.source, t.league], set: upsertSet(t, "overwrite", []) }),
      );
      return rows.length;
    }
  }
}

/**
 * How many of these row keys already exist for the organization — shown on
 * the preview as "will update existing" vs "new".
 */
export async function countExistingRows(
  db: Db,
  organizationId: string,
  type: ConnectorImportType,
  records: Array<{ values: Values }>,
): Promise<number> {
  if (records.length === 0) return 0;
  const def = CONNECTOR_DEFINITIONS[type];
  const keys = [...new Set(records.map((r) => def.rowKey(r.values)))];
  let found = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    found += await countChunk(db, organizationId, def, chunk, records);
  }
  return found;
}

async function countChunk(
  db: Db,
  organizationId: string,
  def: (typeof CONNECTOR_DEFINITIONS)[ConnectorImportType],
  keys: string[],
  records: Array<{ values: Values }>,
): Promise<number> {
  const count = sql<number>`count(*)::int`;
  switch (def.table) {
    case "ext_players": {
      const p = schema.extPlayers;
      const [row] = await db
        .select({ n: count })
        .from(p)
        .where(and(eq(p.organizationId, organizationId), eq(p.source, def.sourceTag), inArray(p.externalId, keys)));
      return row?.n ?? 0;
    }
    case "ext_roster": {
      const r = schema.extRosterEntries;
      const pids = [...new Set(records.map((x) => x.values.external_id ?? ""))];
      const rows = await db
        .select({ team: r.teamAbbrev, season: r.season, pid: r.externalPlayerId })
        .from(r)
        .where(and(eq(r.organizationId, organizationId), eq(r.source, def.sourceTag), inArray(r.externalPlayerId, pids)));
      const byKey = new Set(keys);
      return rows.filter((x) => byKey.has(`${x.team}|${x.season}|${x.pid}`)).length;
    }
    case "ext_player_seasons":
    case "ext_team_seasons":
    case "ext_draft_rankings": {
      const t =
        def.table === "ext_player_seasons"
          ? schema.extPlayerSeasons
          : def.table === "ext_team_seasons"
            ? schema.extTeamSeasons
            : schema.extDraftRankings;
      const [row] = await db
        .select({ n: count })
        .from(t)
        .where(and(eq(t.organizationId, organizationId), eq(t.source, def.sourceTag), inArray(t.rowKey, keys)));
      return row?.n ?? 0;
    }
    case "ext_game_logs": {
      const g = schema.extPlayerGameLogs;
      const pids = [...new Set(records.map((x) => x.values.external_player_id ?? ""))];
      const rows = await db
        .select({ pid: g.externalPlayerId, gameId: g.gameId })
        .from(g)
        .where(and(eq(g.organizationId, organizationId), eq(g.source, def.sourceTag), inArray(g.externalPlayerId, pids)));
      const byKey = new Set(keys);
      return rows.filter((x) => byKey.has(`${x.pid}|${x.gameId}`)).length;
    }
    case "ext_draft_picks": {
      const t = schema.extDraftPicks;
      const years = [...new Set(records.map((r) => Number(r.values.draft_year)))].filter(Number.isInteger);
      if (years.length === 0) return 0;
      const rows = await db
        .select({ y: t.draftYear, o: t.overallPick })
        .from(t)
        .where(and(eq(t.organizationId, organizationId), eq(t.source, def.sourceTag), inArray(t.draftYear, years)));
      const byKey = new Set(keys);
      return rows.filter((x) => byKey.has(`${x.y}|${x.o}`)).length;
    }
    case "ext_prospect_projections": {
      const t = schema.extProspectProjections;
      const [row] = await db
        .select({ n: count })
        .from(t)
        .where(and(eq(t.organizationId, organizationId), eq(t.source, def.sourceTag), inArray(t.externalPlayerId, keys)));
      return row?.n ?? 0;
    }
    case "ext_league_equivalencies": {
      const t = schema.extLeagueEquivalencies;
      const [row] = await db
        .select({ n: count })
        .from(t)
        .where(and(eq(t.organizationId, organizationId), eq(t.source, def.sourceTag), inArray(t.league, keys)));
      return row?.n ?? 0;
    }
  }
}
