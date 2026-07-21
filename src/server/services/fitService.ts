/**
 * Organizational-fit service (model riq-fit-v0.2).
 *
 * Loads fit weights from the database (fit_component_weights — the engine's
 * only live weight source), assembles need/prospect/depth inputs from
 * persisted RosterIQ data, runs the pure fit engine, and persists runs,
 * scores, per-component breakdowns, and depth snapshots. Read-only over
 * official roster/contract/scenario/prospect data — a fit calculation never
 * mutates any of them.
 *
 * No "server-only" import (project convention): integration tests exercise
 * this against in-memory PGlite via setDbForTesting.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  calculateFit,
  CLASS_TO_YEARS,
  DEFAULT_FIT_WEIGHTS,
  type DepthContext,
  type FitResult,
  type NeedInput,
  type ProspectFitInput,
} from "@/lib/scouting/fit";
import { FIT_MODEL_VERSION, ROLE_MODEL_VERSION } from "@/lib/scouting/archetypes";
import { computeSeasonTrends } from "@/lib/scouting/trends";
import type { RoleScore } from "@/lib/scouting/roleScoring";
import { ageAtSeason, ScoutingError } from "@/server/services/scoutingService";

export type NeedRow = typeof schema.organizationalNeeds.$inferSelect;

/* ------------------------------------------------------------------ */
/* Model configuration (weights live in the DB)                        */
/* ------------------------------------------------------------------ */

export interface ActiveFitModel {
  version: string;
  weights: Record<string, number>;
  /** "database" when weights came from fit_component_weights, else "defaults". */
  source: "database" | "defaults";
}

export async function loadActiveFitModel(): Promise<ActiveFitModel> {
  const db = getDb();
  const rows = await db
    .select({
      version: schema.fitModelVersions.version,
      componentKey: schema.fitComponentWeights.componentKey,
      weight: schema.fitComponentWeights.weight,
    })
    .from(schema.fitComponentWeights)
    .innerJoin(schema.fitModelVersions, eq(schema.fitComponentWeights.modelVersionId, schema.fitModelVersions.id))
    .innerJoin(schema.fitModels, eq(schema.fitModelVersions.modelId, schema.fitModels.id))
    .where(
      and(
        eq(schema.fitModels.isActive, true),
        eq(schema.fitModelVersions.isActive, true),
        eq(schema.fitComponentWeights.isActive, true),
        eq(schema.fitModelVersions.version, FIT_MODEL_VERSION),
      ),
    );
  if (rows.length === 0) {
    return { version: FIT_MODEL_VERSION, weights: { ...DEFAULT_FIT_WEIGHTS }, source: "defaults" };
  }
  const weights: Record<string, number> = {};
  for (const r of rows) weights[r.componentKey] = r.weight;
  return { version: FIT_MODEL_VERSION, weights, source: "database" };
}

/* ------------------------------------------------------------------ */
/* Need loading                                                        */
/* ------------------------------------------------------------------ */

export async function getOwnedNeed(needId: string, organizationId: string) {
  const db = getDb();
  const [need] = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(and(eq(schema.organizationalNeeds.id, needId), eq(schema.organizationalNeeds.organizationId, organizationId)))
    .limit(1);
  if (!need) throw new ScoutingError("Need not found in this organization");
  const requirements = await db
    .select()
    .from(schema.organizationalNeedRequirements)
    .where(eq(schema.organizationalNeedRequirements.needId, need.id));
  return { need, requirements };
}

export function needToEngineInput(
  need: NeedRow,
  requirements: Array<typeof schema.organizationalNeedRequirements.$inferSelect>,
): NeedInput {
  const minGrades: Record<string, number> = {};
  for (const r of requirements) {
    if (r.requirementType === "min_grade" && r.minValue !== null) minGrades[r.key] = r.minValue;
  }
  return {
    name: need.name,
    position: need.position,
    secondaryPosition: need.secondaryPosition,
    handedness: need.handedness,
    targetRoleKey: need.targetRoleKey,
    targetScoutRoleKey: need.targetScoutRoleKey,
    priority: need.priority,
    timelineYears: need.timelineYears,
    earliestArrivalYears: need.earliestArrivalYears,
    latestArrivalYears: need.latestArrivalYears,
    preferredAcquisition: need.preferredAcquisition,
    maxRiskTolerance: need.maxRiskTolerance,
    minGrades,
    specialTeamsRequirement: need.specialTeamsRequirement,
    nhlRosterNeed: need.nhlRosterNeed,
    ahlOpportunity: need.ahlOpportunity,
  };
}

/* ------------------------------------------------------------------ */
/* Depth context (live contract + pool data; read-only)                */
/* ------------------------------------------------------------------ */

const positionMatches = (needPos: string, playerPos: string) =>
  needPos === "F" ? ["C", "LW", "RW"].includes(playerPos) : playerPos === needPos;

export interface DepthBundle {
  context: DepthContext;
  orgSnapshot: Record<string, unknown>;
  poolSnapshot: Record<string, unknown>;
}

export async function buildDepthContext(organizationId: string, need: NeedRow): Promise<DepthBundle> {
  const db = getDb();
  const contractRows = await db
    .select({ contract: schema.contracts, player: schema.players })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.organizationId, organizationId), eq(schema.contracts.contractStatus, "active")));
  const atPosition = contractRows.filter((r) => positionMatches(need.position, r.player.position));
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + need.latestArrivalYears);
  const expiring = atPosition.filter((r) => new Date(r.contract.endDate) <= horizon);

  const orgPlayers = await db
    .select({ id: schema.players.id, position: schema.players.position, rosterStatus: schema.players.rosterStatus })
    .from(schema.players)
    .where(eq(schema.players.organizationId, organizationId));
  const minors = orgPlayers.filter(
    (p) => p.rosterStatus === "minor" && positionMatches(need.position, p.position),
  );

  const prospects = await db
    .select()
    .from(schema.amateurProspects)
    .where(eq(schema.amateurProspects.organizationId, organizationId));
  const poolAtPosition = prospects.filter((p) => positionMatches(need.position, p.position));

  // Target-role pool coverage: a scout-assigned match counts, and so does a
  // prospect whose best persisted statistical role is the target.
  const targetKey = need.targetRoleKey ?? need.targetScoutRoleKey;
  let atTargetRole = 0;
  if (targetKey) {
    const ids = poolAtPosition.map((p) => p.id);
    const topRoles = new Map<string, { key: string; score: number }>();
    if (ids.length > 0) {
      const roleRows = await db
        .select({
          prospectId: schema.prospectRoleScores.prospectId,
          score: schema.prospectRoleScores.score,
          key: schema.roleArchetypes.key,
        })
        .from(schema.prospectRoleScores)
        .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
        .where(inArray(schema.prospectRoleScores.prospectId, ids));
      for (const r of roleRows) {
        const cur = topRoles.get(r.prospectId);
        if (!cur || r.score > cur.score) topRoles.set(r.prospectId, { key: r.key, score: r.score });
      }
    }
    atTargetRole = poolAtPosition.filter(
      (p) => p.scoutAssignedRoleKey === targetKey || topRoles.get(p.id)?.key === targetKey,
    ).length;
  }

  const arrivalBuckets: Record<string, number> = { "0y": 0, "1y": 0, "2y": 0, "3y+": 0 };
  for (const p of poolAtPosition) {
    const years = CLASS_TO_YEARS[p.classYear];
    arrivalBuckets[years === 0 ? "0y" : years === 1 ? "1y" : years === 2 ? "2y" : "3y+"] =
      (arrivalBuckets[years === 0 ? "0y" : years === 1 ? "1y" : years === 2 ? "2y" : "3y+"] ?? 0) + 1;
  }

  const context: DepthContext = {
    contractsAtPosition: atPosition.length,
    expiringWithinWindow: expiring.length,
    minorLeagueAtPosition: minors.length,
    prospectsAtPosition: poolAtPosition.length,
    prospectsAtTargetRole: atTargetRole,
  };
  return {
    context,
    orgSnapshot: {
      position: need.position,
      activeContracts: atPosition.length,
      expiringWithinWindow: expiring.length,
      windowYears: need.latestArrivalYears,
      minorLeaguePlayers: minors.length,
      expiringPlayers: expiring.map((r) => ({ name: "(see roster)", endDate: r.contract.endDate })),
    },
    poolSnapshot: {
      position: need.position,
      prospects: poolAtPosition.length,
      atTargetRole,
      targetRoleKey: targetKey,
      byArrival: arrivalBuckets,
      scarce: poolAtPosition.length <= 2,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Prospect input assembly (batched — one query per table)             */
/* ------------------------------------------------------------------ */

async function assembleProspectInputs(
  organizationId: string,
  prospects: Array<typeof schema.amateurProspects.$inferSelect>,
): Promise<Map<string, ProspectFitInput>> {
  const db = getDb();
  const ids = prospects.map((p) => p.id);
  if (ids.length === 0) return new Map();

  const seasonRows = await db
    .select()
    .from(schema.prospectSeasons)
    .where(inArray(schema.prospectSeasons.prospectId, ids))
    .orderBy(asc(schema.prospectSeasons.seasonName));
  const seasonsByProspect = new Map<string, typeof seasonRows>();
  for (const s of seasonRows) {
    const list = seasonsByProspect.get(s.prospectId) ?? [];
    list.push(s);
    seasonsByProspect.set(s.prospectId, list);
  }

  const roleRows = await db
    .select({
      prospectId: schema.prospectRoleScores.prospectId,
      score: schema.prospectRoleScores.score,
      confidence: schema.prospectRoleScores.confidence,
      seasonName: schema.prospectRoleScores.seasonName,
      key: schema.roleArchetypes.key,
      label: schema.roleArchetypes.label,
      positionGroup: schema.roleArchetypes.positionGroup,
    })
    .from(schema.prospectRoleScores)
    .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
    .where(inArray(schema.prospectRoleScores.prospectId, ids));
  const rolesByProspect = new Map<string, RoleScore[]>();
  for (const r of roleRows) {
    const list = rolesByProspect.get(r.prospectId) ?? [];
    list.push({
      archetypeKey: r.key,
      archetypeLabel: r.label,
      positionGroup: r.positionGroup,
      score: r.score,
      confidence: r.confidence,
      contributions: [],
      missingInputs: [],
      contradictions: [],
      modelVersion: ROLE_MODEL_VERSION,
      poolSize: 0,
    });
    rolesByProspect.set(r.prospectId, list);
  }
  for (const list of rolesByProspect.values()) list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const reportRows = await db
    .select()
    .from(schema.scoutingReports)
    .where(
      and(
        eq(schema.scoutingReports.organizationId, organizationId),
        inArray(schema.scoutingReports.prospectId, ids),
      ),
    )
    .orderBy(desc(schema.scoutingReports.createdAt));
  const latestReport = new Map<string, (typeof reportRows)[number]>();
  for (const r of reportRows) {
    if (!latestReport.has(r.prospectId)) latestReport.set(r.prospectId, r); // rows are newest-first
  }

  const out = new Map<string, ProspectFitInput>();
  for (const p of prospects) {
    const seasons = seasonsByProspect.get(p.id) ?? [];
    const latest = seasons[seasons.length - 1] ?? null;
    const lines = seasons.map((s) => ({
      prospectId: p.id,
      seasonName: s.seasonName,
      position: p.position,
      positionGroup: p.positionGroup,
      age: ageAtSeason(p.dateOfBirth, s.seasonName),
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
    }));
    const yoy = [...computeSeasonTrends(lines)].reverse().find((t) => t.kind === "year_over_year");
    const report = latestReport.get(p.id) ?? null;
    const grades = report ? (report.grades as Record<string, number>) : null;
    const points = latest ? latest.goals + latest.assists : 0;
    const ppPoints = latest ? latest.powerPlayGoals + latest.powerPlayAssists : 0;
    out.set(p.id, {
      position: p.position,
      positionGroup: p.positionGroup,
      shootsCatches: p.shootsCatches,
      classYear: p.classYear,
      age: latest ? ageAtSeason(p.dateOfBirth, latest.seasonName) : null,
      scoutAssignedRoleKey: p.scoutAssignedRoleKey,
      roleScores: rolesByProspect.get(p.id) ?? [],
      latestTrendClassification: yoy?.classification ?? null,
      gamesPlayedLatest: latest?.gamesPlayed ?? 0,
      nhlDraftStatus: p.nhlDraftStatus,
      nhlRightsHolder: p.nhlRightsHolder,
      collegeFreeAgentStatus: p.collegeFreeAgentStatus,
      reportGrades: grades && Object.keys(grades).length > 0 ? grades : null,
      reportRisk: report?.risk ?? null,
      ppShare: latest === null ? null : points > 0 ? ppPoints / points : 0,
      shGoals: latest ? latest.shortHandedGoals : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Persisting one fit result                                           */
/* ------------------------------------------------------------------ */

async function persistFit(opts: {
  organizationId: string;
  prospectId: string;
  needId: string;
  runId: string | null;
  fit: FitResult;
}): Promise<string | null> {
  if (opts.fit.overall === null) return null;
  const db = getDb();
  const [score] = await db
    .insert(schema.prospectFitScores)
    .values({
      organizationId: opts.organizationId,
      prospectId: opts.prospectId,
      needId: opts.needId,
      modelVersion: opts.fit.modelVersion,
      runId: opts.runId,
      overallScore: opts.fit.overall,
      confidence: opts.fit.confidence,
      components: { list: opts.fit.components },
      explanation: { warnings: opts.fit.warnings },
    })
    .onConflictDoUpdate({
      target: [
        schema.prospectFitScores.prospectId,
        schema.prospectFitScores.needId,
        schema.prospectFitScores.modelVersion,
      ],
      set: {
        runId: opts.runId,
        overallScore: opts.fit.overall,
        confidence: opts.fit.confidence,
        components: { list: opts.fit.components },
        explanation: { warnings: opts.fit.warnings },
        computedAt: new Date(),
      },
    })
    .returning();
  if (!score) return null;
  await db.delete(schema.prospectFitComponents).where(eq(schema.prospectFitComponents.fitScoreId, score.id));
  await db.insert(schema.prospectFitComponents).values(
    opts.fit.components.map((c) => ({
      fitScoreId: score.id,
      componentKey: c.key,
      label: c.label,
      inputValue: c.inputValue,
      desiredValue: c.desiredValue,
      rawScore: c.rawScore,
      weight: c.weight,
      weightedContribution: c.weightedContribution,
      penalty: c.penalty,
      finalScore: c.finalScore,
      missingInputs: c.missingInputs,
      explanation: c.explanation,
    })),
  );
  return score.id;
}

/* ------------------------------------------------------------------ */
/* Run the model for a whole need                                      */
/* ------------------------------------------------------------------ */

const groupsForNeed = (need: NeedRow): Array<"F" | "D" | "G"> => {
  const groupOf = (pos: string): "F" | "D" | "G" => (pos === "D" ? "D" : pos === "G" ? "G" : "F");
  const groups = new Set<"F" | "D" | "G">([groupOf(need.position)]);
  if (need.secondaryPosition) groups.add(groupOf(need.secondaryPosition));
  return [...groups];
};

export async function runFitForNeed(
  needId: string,
  organizationId: string,
  userId: string | null,
): Promise<{ runId: string; evaluated: number; scored: number; modelVersion: string; weightsSource: string }> {
  const db = getDb();
  const { need, requirements } = await getOwnedNeed(needId, organizationId);
  const model = await loadActiveFitModel();
  const needInput = needToEngineInput(need, requirements);

  const [run] = await db
    .insert(schema.fitCalculationRuns)
    .values({
      organizationId,
      needId: need.id,
      modelVersion: model.version,
      status: "running",
      startedBy: userId,
    })
    .returning();
  if (!run) throw new ScoutingError("Could not create fit-calculation run");

  const groups = groupsForNeed(need);
  const candidates = await db
    .select()
    .from(schema.amateurProspects)
    .where(
      and(
        eq(schema.amateurProspects.organizationId, organizationId),
        inArray(schema.amateurProspects.positionGroup, groups),
      ),
    );
  const depth = await buildDepthContext(organizationId, need);
  const inputs = await assembleProspectInputs(organizationId, candidates);

  let scored = 0;
  const runWarnings = new Set<string>();
  if (model.source === "defaults") {
    runWarnings.add("No database weights found for the active model version; engine defaults were used");
  }
  for (const p of candidates) {
    const input = inputs.get(p.id);
    if (!input) continue;
    const fit = calculateFit(needInput, input, depth.context, model.weights);
    const id = await persistFit({
      organizationId,
      prospectId: p.id,
      needId: need.id,
      runId: run.id,
      fit,
    });
    if (id) scored += 1;
  }

  await db.insert(schema.organizationalDepthSnapshots).values({
    organizationId,
    runId: run.id,
    position: need.position,
    snapshot: depth.orgSnapshot,
  });
  await db.insert(schema.prospectPoolDepthSnapshots).values({
    organizationId,
    runId: run.id,
    position: need.position,
    snapshot: depth.poolSnapshot,
  });

  // Refresh auto roster links: the expiring contracts motivating this need.
  await db
    .delete(schema.organizationalNeedRosterLinks)
    .where(
      and(
        eq(schema.organizationalNeedRosterLinks.needId, need.id),
        eq(schema.organizationalNeedRosterLinks.linkType, "expiring_contract"),
      ),
    );
  const contractRows = await db
    .select({ contract: schema.contracts, player: schema.players })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.organizationId, organizationId), eq(schema.contracts.contractStatus, "active")));
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + need.latestArrivalYears);
  const expiring = contractRows.filter(
    (r) => positionMatches(need.position, r.player.position) && new Date(r.contract.endDate) <= horizon,
  );
  if (expiring.length > 0) {
    await db.insert(schema.organizationalNeedRosterLinks).values(
      expiring.map((r) => ({
        needId: need.id,
        linkType: "expiring_contract",
        contractId: r.contract.id,
        playerId: r.player.id,
        note: `${r.player.fullName} (${r.player.position}) — contract ends ${r.contract.endDate}`,
      })),
    );
  }

  await db
    .update(schema.fitCalculationRuns)
    .set({
      status: "complete",
      prospectsEvaluated: candidates.length,
      scoredCount: scored,
      warnings: [...runWarnings],
      completedAt: new Date(),
    })
    .where(eq(schema.fitCalculationRuns.id, run.id));

  return {
    runId: run.id,
    evaluated: candidates.length,
    scored,
    modelVersion: model.version,
    weightsSource: model.source,
  };
}

/** Single-prospect fit (profile page path); persists like a mini-run. */
export async function computeFit(prospectId: string, needId: string, organizationId: string): Promise<FitResult> {
  const db = getDb();
  const { need, requirements } = await getOwnedNeed(needId, organizationId);
  const [prospect] = await db
    .select()
    .from(schema.amateurProspects)
    .where(and(eq(schema.amateurProspects.id, prospectId), eq(schema.amateurProspects.organizationId, organizationId)))
    .limit(1);
  if (!prospect) throw new ScoutingError("Prospect not found in this organization");
  const model = await loadActiveFitModel();
  const depth = await buildDepthContext(organizationId, need);
  const inputs = await assembleProspectInputs(organizationId, [prospect]);
  const fit = calculateFit(needToEngineInput(need, requirements), inputs.get(prospect.id)!, depth.context, model.weights);
  await persistFit({ organizationId, prospectId: prospect.id, needId: need.id, runId: null, fit });
  return fit;
}

/* ------------------------------------------------------------------ */
/* Reads for pages and exports                                         */
/* ------------------------------------------------------------------ */

export async function getRankedFits(needId: string, organizationId: string) {
  const db = getDb();
  await getOwnedNeed(needId, organizationId); // org isolation before reading scores
  const rows = await db
    .select({
      f: schema.prospectFitScores,
      p: schema.amateurProspects,
      schoolName: schema.schools.name,
    })
    .from(schema.prospectFitScores)
    .innerJoin(schema.amateurProspects, eq(schema.prospectFitScores.prospectId, schema.amateurProspects.id))
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(
      and(
        eq(schema.prospectFitScores.needId, needId),
        eq(schema.prospectFitScores.organizationId, organizationId),
        eq(schema.prospectFitScores.modelVersion, FIT_MODEL_VERSION),
      ),
    )
    .orderBy(desc(schema.prospectFitScores.overallScore));
  const watchRows = await db
    .select({ prospectId: schema.prospectWatchlistMembers.prospectId })
    .from(schema.prospectWatchlistMembers)
    .innerJoin(schema.prospectWatchlists, eq(schema.prospectWatchlistMembers.watchlistId, schema.prospectWatchlists.id))
    .where(eq(schema.prospectWatchlists.organizationId, organizationId));
  const watched = new Set(watchRows.map((w) => w.prospectId));
  return rows.map((r) => ({ ...r, onWatchlist: watched.has(r.p.id) }));
}

/** Live org-wide depth summary for the needs page (not a snapshot). */
export async function getDepthSummary(organizationId: string) {
  const db = getDb();
  const contractRows = await db
    .select({ contract: schema.contracts, player: schema.players })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.organizationId, organizationId), eq(schema.contracts.contractStatus, "active")));
  const orgPlayers = await db
    .select({ position: schema.players.position, rosterStatus: schema.players.rosterStatus })
    .from(schema.players)
    .where(eq(schema.players.organizationId, organizationId));
  const prospects = await db
    .select({ position: schema.amateurProspects.position, classYear: schema.amateurProspects.classYear })
    .from(schema.amateurProspects)
    .where(eq(schema.amateurProspects.organizationId, organizationId));

  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 3);
  return ["C", "LW", "RW", "D", "G"].map((pos) => {
    const contracts = contractRows.filter((r) => r.player.position === pos);
    const expiring = contracts.filter((r) => new Date(r.contract.endDate) <= horizon);
    const minors = orgPlayers.filter((p) => p.position === pos && p.rosterStatus === "minor");
    const pool = prospects.filter((p) => p.position === pos);
    const nearArrival = pool.filter((p) => CLASS_TO_YEARS[p.classYear] <= 1);
    return {
      position: pos,
      activeContracts: contracts.length,
      expiringWithin3y: expiring.length,
      minorLeague: minors.length,
      prospects: pool.length,
      prospectsArrivingSoon: nearArrival.length,
      scarce: contracts.length <= 2 && pool.length <= 2,
    };
  });
}

/** Comparison data for 2–5 prospects against one need. */
export async function getComparison(needId: string, prospectIds: string[], organizationId: string) {
  if (prospectIds.length < 2 || prospectIds.length > 5) {
    throw new ScoutingError("Compare between 2 and 5 prospects");
  }
  const db = getDb();
  const { need, requirements } = await getOwnedNeed(needId, organizationId);
  const prospects = await db
    .select()
    .from(schema.amateurProspects)
    .where(
      and(
        eq(schema.amateurProspects.organizationId, organizationId),
        inArray(schema.amateurProspects.id, prospectIds),
      ),
    );
  if (prospects.length !== prospectIds.length) {
    throw new ScoutingError("One or more prospects not found in this organization");
  }
  const scores = await db
    .select()
    .from(schema.prospectFitScores)
    .where(
      and(
        eq(schema.prospectFitScores.needId, needId),
        eq(schema.prospectFitScores.organizationId, organizationId),
        inArray(schema.prospectFitScores.prospectId, prospectIds),
        eq(schema.prospectFitScores.modelVersion, FIT_MODEL_VERSION),
      ),
    );
  const inputs = await assembleProspectInputs(organizationId, prospects);
  // Preserve the caller's order.
  const ordered = prospectIds
    .map((id) => prospects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  return {
    need,
    requirements,
    entries: ordered.map((p) => ({
      prospect: p,
      input: inputs.get(p.id) ?? null,
      score: scores.find((s) => s.prospectId === p.id) ?? null,
    })),
  };
}
