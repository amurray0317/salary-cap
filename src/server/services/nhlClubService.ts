/**
 * Set an organization up as a real NHL club from public NHL data: the club
 * (name, tri-code) and its current roster (bios, positions, NHL ids for
 * photos and league stats), as an official roster for the season.
 *
 * Public NHL data has no contracts, cap hits, waiver or free-agent status,
 * so those are recorded as "not recorded" and never guessed; contracts are
 * added in Cap & contracts or by CSV import. Re-running refreshes bios and
 * the roster without duplicating players.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { ConnectorHttpError, rateLimitedGet, type FetchImpl } from "@/lib/connectors/http";
import { NHL_CREDIT, NHL_TEAMS, NHL_TEAM_NAMES, nhlUrls, parseRoster } from "@/lib/connectors/nhl";
import { nhlSeasonId, seasonLabel, seasonStartYear } from "@/lib/season";
import { NHL_RULE_SOURCE, NHL_SEASON_FACTS, nhlRules } from "@/lib/nhlLeague";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * The shared "National Hockey League" league with the published seasons and
 * cap rules (created once; seasons added as the NHL announces them).
 */
export async function ensureNhlLeague(tx: Tx) {
  let [league] = await tx
    .select()
    .from(schema.leagues)
    .where(and(eq(schema.leagues.abbreviation, "NHL"), eq(schema.leagues.name, "National Hockey League")));
  if (!league) {
    [league] = await tx
      .insert(schema.leagues)
      .values({ name: "National Hockey League", abbreviation: "NHL", sport: "hockey", level: "professional", capSystem: "annual_hard_cap" })
      .returning();
  }
  const have = new Set((await tx.select().from(schema.leagueSeasons).where(eq(schema.leagueSeasons.leagueId, league!.id))).map((s) => s.name));
  const current = seasonLabel(seasonStartYear());
  for (const [i, f] of NHL_SEASON_FACTS.entries()) {
    if (have.has(f.name)) continue;
    const [season] = await tx
      .insert(schema.leagueSeasons)
      .values({ leagueId: league!.id, name: f.name, startDate: f.startDate, endDate: f.endDate, isCurrent: f.name === current, sortOrder: i })
      .returning();
    await tx.insert(schema.leagueRules).values(
      nhlRules(f).map((r) => ({
        leagueId: league!.id,
        seasonId: season!.id,
        ruleKey: r.key,
        ruleName: r.name,
        ruleCategory: r.category,
        numericValue: r.value,
        effectiveDate: f.startDate,
        ruleVersion: 1,
        isActive: true,
        notes: `${NHL_RULE_SOURCE}.${f.datesPublished ? "" : " Season dates estimated until the NHL publishes the schedule."}`,
      })),
    );
  }
  return league!;
}

export class NhlClubError extends Error {}

export interface NhlClubResult {
  teamId: string;
  teamName: string;
  season: string;
  added: number;
  updated: number;
  onRoster: number;
}

const POS = new Set(["C", "LW", "RW", "D", "G"]);

export async function importNhlClub(
  opts: { organizationId: string; actorId: string; team: string; now?: Date; hideOtherTeams?: boolean },
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<NhlClubResult> {
  const tri = opts.team.toUpperCase() as (typeof NHL_TEAMS)[number];
  if (!NHL_TEAMS.includes(tri)) throw new NhlClubError("Choose one of the 32 NHL clubs");
  const startYear = seasonStartYear(opts.now);
  const season = seasonLabel(startYear);
  const db = getDb();

  let body: string;
  try {
    body = (await rateLimitedGet("nhl_api", nhlUrls.roster(tri, nhlSeasonId(startYear)), deps.fetchImpl ?? ((u, i) => fetch(u, i)))).body;
  } catch (err) {
    if (err instanceof ConnectorHttpError && err.status === 404)
      throw new NhlClubError(`The NHL has not published a ${season} roster for ${tri} yet`);
    throw err;
  }
  const roster = parseRoster(JSON.parse(body), tri, nhlSeasonId(startYear)).records;
  if (roster.length === 0) throw new NhlClubError(`The NHL roster for ${tri} ${season} is empty`);

  return db.transaction(async (tx) => {
    const league = await ensureNhlLeague(tx);
    const [source] = await tx
      .insert(schema.dataSources)
      .values({
        organizationId: opts.organizationId,
        name: `NHL API — ${tri} roster ${season}`,
        url: nhlUrls.roster(tri, nhlSeasonId(startYear)),
        retrievedAt: new Date(),
        sourceKey: "nhl_api",
        effectiveSeason: season,
        notes: NHL_CREDIT,
      })
      .returning();

    let [team] = await tx
      .select()
      .from(schema.teams)
      .where(and(eq(schema.teams.organizationId, opts.organizationId), eq(schema.teams.abbreviation, tri)));
    if (!team) {
      [team] = await tx
        .insert(schema.teams)
        .values({ organizationId: opts.organizationId, leagueId: league.id, name: NHL_TEAM_NAMES[tri], abbreviation: tri, level: "pro" })
        .returning();
    } else if (!team.isActive) {
      await tx.update(schema.teams).set({ isActive: true }).where(eq(schema.teams.id, team.id));
    }
    if (opts.hideOtherTeams) {
      const others = await tx.select().from(schema.teams).where(eq(schema.teams.organizationId, opts.organizationId));
      for (const o of others)
        if (o.id !== team!.id && o.isActive) await tx.update(schema.teams).set({ isActive: false }).where(eq(schema.teams.id, o.id));
    }

    let added = 0;
    let updated = 0;
    const playerIds: string[] = [];
    for (const r of roster) {
      const nhlId = r.external_id!;
      const bio = {
        fullName: r.full_name!,
        dateOfBirth: r.date_of_birth || null,
        position: POS.has(r.position!) ? r.position! : "C",
        shootsCatches: r.shoots_catches || null,
        heightCm: r.height_cm ? Number(r.height_cm) : null,
        weightKg: r.weight_kg ? Number(r.weight_kg) : null,
        nationality: r.birth_country || null,
        currentTeamId: team!.id,
        sourceId: source!.id,
        updatedAt: new Date(),
      };
      const [existing] = await tx
        .select({ id: schema.players.id })
        .from(schema.players)
        .where(and(eq(schema.players.organizationId, opts.organizationId), eq(schema.players.nhlPlayerId, nhlId)));
      if (existing) {
        await tx.update(schema.players).set(bio).where(eq(schema.players.id, existing.id));
        playerIds.push(existing.id);
        updated += 1;
      } else {
        const [p] = await tx
          .insert(schema.players)
          .values({
            ...bio,
            organizationId: opts.organizationId,
            nhlPlayerId: nhlId,
            rosterStatus: "pro_active",
            freeAgentStatus: "unknown",
            waiverStatus: "unknown",
            provenance: "official",
            notes: `From the NHL's ${season} ${tri} roster. Contract, waiver and free-agent status are not in public NHL data.`,
          })
          .returning();
        playerIds.push(p!.id);
        added += 1;
      }
    }

    // Official roster for the season, when the league has that season.
    const [leagueSeason] = await tx
      .select()
      .from(schema.leagueSeasons)
      .where(and(eq(schema.leagueSeasons.leagueId, league.id), eq(schema.leagueSeasons.name, season)));
    if (leagueSeason) {
      let [ros] = await tx
        .select()
        .from(schema.rosters)
        .where(and(eq(schema.rosters.teamId, team!.id), eq(schema.rosters.seasonId, leagueSeason.id), eq(schema.rosters.isOfficial, true)));
      if (!ros)
        [ros] = await tx
          .insert(schema.rosters)
          .values({ teamId: team!.id, seasonId: leagueSeason.id, name: "Official", isOfficial: true })
          .returning();
      for (const pid of playerIds) {
        await tx.insert(schema.rosterMemberships).values({ rosterId: ros!.id, playerId: pid, status: "pro_active" }).onConflictDoNothing();
      }
    }

    await tx.insert(schema.auditLogs).values({
      organizationId: opts.organizationId,
      userId: opts.actorId,
      action: "nhl_club.import",
      entityType: "team",
      entityId: team!.id,
      newValues: { team: tri, season, added, updated, onRoster: playerIds.length },
    });
    return { teamId: team!.id, teamName: team!.name, season, added, updated, onRoster: playerIds.length };
  });
}
