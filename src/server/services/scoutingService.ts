/**
 * Amateur-scouting service: assembles engine inputs from persisted records,
 * persists model outputs with their versions, and connects the fit engine to
 * RosterIQ's live contract data for the opportunity path.
 *
 * No "server-only" import (project convention): integration tests exercise
 * this against in-memory PGlite via setDbForTesting.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { buildPercentiles, type SeasonLine } from "@/lib/scouting/stats";
import { computeSeasonTrends, computeGameLogTrends, type Trend } from "@/lib/scouting/trends";
import { scoreAllArchetypes, type RoleScore, type WeightRow } from "@/lib/scouting/roleScoring";
import { calculateFit, type FitResult } from "@/lib/scouting/fit";
import { ROLE_MODEL_VERSION } from "@/lib/scouting/archetypes";

export class ScoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutingError";
  }
}

type ProspectRow = typeof schema.amateurProspects.$inferSelect;
type ProspectSeasonRow = typeof schema.prospectSeasons.$inferSelect;

/** Age at the (approximate) season start: Sept 15 of the season's first year. */
export function ageAtSeason(dateOfBirth: string | null, seasonName: string): number | null {
  if (!dateOfBirth) return null;
  const year = Number(seasonName.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const ref = new Date(`${year}-09-15`);
  const dob = new Date(dateOfBirth);
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age -= 1;
  return age;
}

function toSeasonLine(prospect: ProspectRow, s: ProspectSeasonRow): SeasonLine {
  return {
    prospectId: prospect.id,
    seasonName: s.seasonName,
    position: prospect.position,
    positionGroup: prospect.positionGroup,
    age: ageAtSeason(prospect.dateOfBirth, s.seasonName),
    gamesPlayed: s.gamesPlayed,
    goals: s.goals,
    assists: s.assists,
    shots: s.shots,
    penaltyMinutes: s.penaltyMinutes,
    powerPlayGoals: s.powerPlayGoals,
    powerPlayAssists: s.powerPlayAssists,
    shortHandedGoals: s.shortHandedGoals,
    faceoffWins: s.faceoffWins,
    faceoffAttempts: s.faceoffAttempts,
    timeOnIceSeconds: s.timeOnIceSeconds,
    teamGoalsFor: s.teamGoalsFor,
    teamGamesPlayed: null,
  };
}

async function getOwnedProspect(prospectId: string, organizationId: string) {
  const db = getDb();
  const [prospect] = await db
    .select()
    .from(schema.amateurProspects)
    .where(and(eq(schema.amateurProspects.id, prospectId), eq(schema.amateurProspects.organizationId, organizationId)))
    .limit(1);
  if (!prospect) throw new ScoutingError("Prospect not found in this organization");
  return prospect;
}

/** Loads active role weights joined with their archetypes. */
export async function loadRoleWeights(): Promise<WeightRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      weight: schema.roleMetricWeights,
      archetype: schema.roleArchetypes,
    })
    .from(schema.roleMetricWeights)
    .innerJoin(schema.roleArchetypes, eq(schema.roleMetricWeights.archetypeId, schema.roleArchetypes.id))
    .where(and(eq(schema.roleMetricWeights.isActive, true), eq(schema.roleArchetypes.isActive, true)));
  return rows.map((r) => ({
    archetypeKey: r.archetype.key,
    archetypeLabel: r.archetype.label,
    positionGroup: r.archetype.positionGroup,
    metric: r.weight.metric,
    weight: r.weight.weight,
    modelVersion: r.weight.modelVersion,
  }));
}

/**
 * Computes (and persists) role scores for a prospect's latest season against
 * the organization's same-position peer pool. Returns the ranked scores.
 */
export async function computeRoleScores(
  prospectId: string,
  organizationId: string,
): Promise<{ seasonName: string | null; scores: RoleScore[] }> {
  const db = getDb();
  const prospect = await getOwnedProspect(prospectId, organizationId);
  const seasons = await db
    .select()
    .from(schema.prospectSeasons)
    .where(eq(schema.prospectSeasons.prospectId, prospect.id))
    .orderBy(desc(schema.prospectSeasons.seasonName));
  const latest = seasons[0];
  if (!latest) return { seasonName: null, scores: [] };

  // Peer pool: all org prospects' rows for the same season.
  const orgProspects = await db
    .select()
    .from(schema.amateurProspects)
    .where(eq(schema.amateurProspects.organizationId, organizationId));
  const byId = new Map(orgProspects.map((p) => [p.id, p]));
  const peerSeasonRows = await db
    .select()
    .from(schema.prospectSeasons)
    .where(
      and(
        eq(schema.prospectSeasons.seasonName, latest.seasonName),
        inArray(schema.prospectSeasons.prospectId, orgProspects.map((p) => p.id)),
      ),
    );
  const peerLines = peerSeasonRows
    .map((s) => {
      const p = byId.get(s.prospectId);
      return p ? toSeasonLine(p, s) : null;
    })
    .filter((x): x is SeasonLine => x !== null);

  const subject = toSeasonLine(prospect, latest);
  const percentiles = buildPercentiles(subject, peerLines);
  const weights = await loadRoleWeights();
  const scores = scoreAllArchetypes(prospect.positionGroup, weights, percentiles);

  // Persist with model version (upsert per unique key).
  const archetypes = await db.select().from(schema.roleArchetypes);
  const archetypeIdByKey = new Map(archetypes.map((a) => [a.key, a.id]));
  for (const s of scores) {
    const archetypeId = archetypeIdByKey.get(s.archetypeKey);
    if (!archetypeId || s.score === null) continue;
    await db
      .insert(schema.prospectRoleScores)
      .values({
        prospectId: prospect.id,
        archetypeId,
        seasonName: latest.seasonName,
        modelVersion: ROLE_MODEL_VERSION,
        score: s.score,
        confidence: s.confidence,
        explanation: {
          contributions: s.contributions,
          missingInputs: s.missingInputs,
          contradictions: s.contradictions,
          poolSize: s.poolSize,
        },
      })
      .onConflictDoUpdate({
        target: [
          schema.prospectRoleScores.prospectId,
          schema.prospectRoleScores.archetypeId,
          schema.prospectRoleScores.seasonName,
          schema.prospectRoleScores.modelVersion,
        ],
        set: {
          score: s.score,
          confidence: s.confidence,
          explanation: {
            contributions: s.contributions,
            missingInputs: s.missingInputs,
            contradictions: s.contradictions,
            poolSize: s.poolSize,
          },
        },
      });
  }
  return { seasonName: latest.seasonName, scores };
}

/** Trend bundle for the profile page (season + game-log trends). */
export async function computeTrends(prospectId: string, organizationId: string): Promise<Trend[]> {
  const db = getDb();
  const prospect = await getOwnedProspect(prospectId, organizationId);
  const seasons = await db
    .select()
    .from(schema.prospectSeasons)
    .where(eq(schema.prospectSeasons.prospectId, prospect.id))
    .orderBy(asc(schema.prospectSeasons.seasonName));
  const lines = seasons.map((s) => toSeasonLine(prospect, s));
  const trends = computeSeasonTrends(lines);
  const latest = seasons[seasons.length - 1];
  if (latest) {
    const logs = await db
      .select()
      .from(schema.prospectGameLogs)
      .where(and(eq(schema.prospectGameLogs.prospectId, prospect.id), eq(schema.prospectGameLogs.seasonName, latest.seasonName)))
      .orderBy(asc(schema.prospectGameLogs.gameDate));
    trends.push(
      ...computeGameLogTrends(
        latest.seasonName,
        logs.map((g) => ({ gameDate: g.gameDate, goals: g.goals, assists: g.assists, shots: g.shots })),
      ),
    );
  }
  return trends;
}

/** Depth context for the fit engine, from LIVE RosterIQ contract data. */
export async function loadDepthContext(
  organizationId: string,
  position: string,
  timelineYears: number,
): Promise<{ contractsAtPosition: number; expiringWithinTimeline: number }> {
  const db = getDb();
  const rows = await db
    .select({ contract: schema.contracts, player: schema.players })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.organizationId, organizationId), eq(schema.contracts.contractStatus, "active")));

  const matches = rows.filter((r) =>
    position === "F"
      ? ["C", "LW", "RW"].includes(r.player.position)
      : r.player.position === position,
  );
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + timelineYears);
  const expiring = matches.filter((r) => new Date(r.contract.endDate) <= horizon);
  return { contractsAtPosition: matches.length, expiringWithinTimeline: expiring.length };
}

/** Computes an explainable fit and persists it with its model version. */
export async function computeFit(
  prospectId: string,
  needId: string,
  organizationId: string,
): Promise<FitResult> {
  const db = getDb();
  const prospect = await getOwnedProspect(prospectId, organizationId);
  const [need] = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(and(eq(schema.organizationalNeeds.id, needId), eq(schema.organizationalNeeds.organizationId, organizationId)))
    .limit(1);
  if (!need) throw new ScoutingError("Need not found in this organization");

  const { seasonName, scores } = await computeRoleScores(prospectId, organizationId);
  const trends = await computeTrends(prospectId, organizationId);
  const latestYoY = [...trends].reverse().find((t) => t.kind === "year_over_year");
  const latestSeasonRow = seasonName
    ? (
        await db
          .select()
          .from(schema.prospectSeasons)
          .where(and(eq(schema.prospectSeasons.prospectId, prospect.id), eq(schema.prospectSeasons.seasonName, seasonName)))
          .limit(1)
      )[0]
    : undefined;

  const depth = await loadDepthContext(organizationId, need.position, need.timelineYears);
  const fit = calculateFit(
    {
      position: need.position,
      handedness: need.handedness,
      targetRoleKey: need.targetRoleKey,
      priority: need.priority,
      timelineYears: need.timelineYears,
      maxRiskTolerance: need.maxRiskTolerance,
    },
    {
      position: prospect.position,
      positionGroup: prospect.positionGroup,
      shootsCatches: prospect.shootsCatches,
      classYear: prospect.classYear,
      age: ageAtSeason(prospect.dateOfBirth, seasonName ?? "2025-26"),
      primaryInferredRole: scores[0] ?? null,
      scoutAssignedRoleKey: prospect.scoutAssignedRoleKey,
      roleScores: scores,
      latestTrendClassification: latestYoY?.classification ?? null,
      gamesPlayedLatest: latestSeasonRow?.gamesPlayed ?? 0,
    },
    depth,
  );

  if (fit.overall !== null) {
    await db
      .insert(schema.prospectFitScores)
      .values({
        organizationId,
        prospectId: prospect.id,
        needId: need.id,
        modelVersion: fit.modelVersion,
        overallScore: fit.overall,
        components: { list: fit.components },
        explanation: { warnings: fit.warnings },
      })
      .onConflictDoUpdate({
        target: [
          schema.prospectFitScores.prospectId,
          schema.prospectFitScores.needId,
          schema.prospectFitScores.modelVersion,
        ],
        set: {
          overallScore: fit.overall,
          components: { list: fit.components },
          explanation: { warnings: fit.warnings },
          computedAt: new Date(),
        },
      });
  }
  return fit;
}
