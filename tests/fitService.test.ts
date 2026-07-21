/**
 * Organizational-fit service integration tests on in-memory PGlite via
 * setDbForTesting: database-backed weights, run persistence (runs, scores,
 * components, snapshots, roster links), ranking, re-run upserts, grade
 * requirements, comparison, and org isolation.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import {
  buildDepthContext,
  getComparison,
  getDepthSummary,
  getRankedFits,
  loadActiveFitModel,
  runFitForNeed,
} from "@/server/services/fitService";
import { ScoutingError } from "@/server/services/scoutingService";
import { DEFAULT_FIT_WEIGHTS, FIT_COMPONENT_KEYS, FIT_COMPONENT_LABELS } from "@/lib/scouting/fit";
import { FIT_MODEL_VERSION, ROLE_MODEL_VERSION } from "@/lib/scouting/archetypes";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  otherOrgId: string;
  userId: string;
  needId: string;
  starId: string; // R-hand D, has report meeting minimums
  noReportId: string; // R-hand D, no scouting report
  wrongHandId: string; // L-hand D
  foreignNeedId: string;
  foreignProspectId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);

  const [user] = await db.insert(schema.users).values({ email: "fit@t.test", fullName: "Fit Tester" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-fit" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-fit" }).returning();

  // Fit model configuration in the DB with a deliberately customized weight.
  const [model] = await db.insert(schema.fitModels).values({ key: "org_fit", label: "Org fit" }).returning();
  const [version] = await db
    .insert(schema.fitModelVersions)
    .values({ modelId: model!.id, version: FIT_MODEL_VERSION, effectiveDate: "2026-07-01" })
    .returning();
  await db.insert(schema.fitComponentWeights).values(
    FIT_COMPONENT_KEYS.map((key) => ({
      modelVersionId: version!.id,
      componentKey: key,
      weight: key === "handedness" ? 0.42 : DEFAULT_FIT_WEIGHTS[key],
    })),
  );

  // Archetype for the target role + persisted role scores.
  const [arch] = await db
    .insert(schema.roleArchetypes)
    .values({ key: "puck_moving_d", label: "Puck-moving defenseman", positionGroup: "D" })
    .returning();

  const mkProspect = async (
    name: string,
    opts: { hand: string | null; roleScore?: number; org?: string; classYear?: "freshman" | "sophomore" | "junior" },
  ) => {
    const [p] = await db
      .insert(schema.amateurProspects)
      .values({
        organizationId: opts.org ?? org!.id,
        fullName: name,
        position: "D",
        positionGroup: "D",
        shootsCatches: opts.hand,
        dateOfBirth: "2005-05-01",
        classYear: opts.classYear ?? "sophomore",
      })
      .returning();
    await db.insert(schema.prospectSeasons).values([
      { prospectId: p!.id, seasonName: "2024-25", classYear: "freshman", gamesPlayed: 32, goals: 3, assists: 12, shots: 55 },
      { prospectId: p!.id, seasonName: "2025-26", classYear: "sophomore", gamesPlayed: 34, goals: 5, assists: 20, shots: 70, powerPlayGoals: 2, powerPlayAssists: 6 },
    ]);
    if (opts.roleScore !== undefined) {
      await db.insert(schema.prospectRoleScores).values({
        prospectId: p!.id,
        archetypeId: arch!.id,
        seasonName: "2025-26",
        modelVersion: ROLE_MODEL_VERSION,
        score: opts.roleScore,
        confidence: 0.8,
        explanation: {},
      });
    }
    return p!;
  };

  const star = await mkProspect("Star Defender", { hand: "R", roleScore: 85 });
  const noReport = await mkProspect("Quiet Defender", { hand: "R", roleScore: 60 });
  const wrongHand = await mkProspect("Left Defender", { hand: "L", roleScore: 75 });
  const foreign = await mkProspect("Foreign Defender", { hand: "R", roleScore: 90, org: otherOrg!.id });

  // Scouting report for the star meeting the need's minimums.
  await db.insert(schema.scoutingReports).values({
    organizationId: org!.id,
    prospectId: star.id,
    scoutId: user!.id,
    viewingType: "live",
    grades: { skating: 60, hockey_sense: 60 },
    risk: "low",
    status: "submitted",
  });

  // Pro contracts for depth: 3 active D, one expiring within the window.
  const [league] = await db.insert(schema.leagues).values({ name: "L", abbreviation: "L" }).returning();
  const [team] = await db
    .insert(schema.teams)
    .values({ organizationId: org!.id, leagueId: league!.id, name: "Pro", abbreviation: "PRO" })
    .returning();
  for (let i = 0; i < 3; i++) {
    const [player] = await db
      .insert(schema.players)
      .values({ organizationId: org!.id, fullName: `Pro D ${i}`, position: "D", currentTeamId: team!.id, rosterStatus: i === 2 ? "minor" : "pro_active" })
      .returning();
    await db.insert(schema.contracts).values({
      organizationId: org!.id,
      playerId: player!.id,
      teamId: team!.id,
      leagueId: league!.id,
      contractStatus: "active",
      startDate: "2025-10-01",
      endDate: i === 0 ? "2027-06-01" : "2031-06-01",
      averageAnnualValue: 2_000_000,
    });
  }

  const [need] = await db
    .insert(schema.organizationalNeeds)
    .values({
      organizationId: org!.id,
      name: "RHD transition",
      position: "D",
      handedness: "R",
      targetRoleKey: "puck_moving_d",
      priority: 1,
      timelineYears: 2,
      earliestArrivalYears: 1,
      latestArrivalYears: 4,
      preferredAcquisition: "draft",
      maxRiskTolerance: "medium",
      createdBy: user!.id,
    })
    .returning();
  await db.insert(schema.organizationalNeedRequirements).values([
    { needId: need!.id, requirementType: "min_grade", key: "skating", minValue: 55 },
    { needId: need!.id, requirementType: "min_grade", key: "hockey_sense", minValue: 55 },
  ]);

  const [foreignNeed] = await db
    .insert(schema.organizationalNeeds)
    .values({ organizationId: otherOrg!.id, name: "Foreign need", position: "D", priority: 1 })
    .returning();

  Object.assign(fx, {
    orgId: org!.id,
    otherOrgId: otherOrg!.id,
    userId: user!.id,
    needId: need!.id,
    starId: star.id,
    noReportId: noReport.id,
    wrongHandId: wrongHand.id,
    foreignNeedId: foreignNeed!.id,
    foreignProspectId: foreign.id,
  });
});

afterAll(async () => {
  await pg.close();
});

describe("loadActiveFitModel", () => {
  it("loads versioned weights from the database, including customizations", async () => {
    const model = await loadActiveFitModel();
    expect(model.source).toBe("database");
    expect(model.version).toBe(FIT_MODEL_VERSION);
    expect(model.weights.handedness).toBe(0.42);
    expect(Object.keys(model.weights)).toHaveLength(14);
  });
});

describe("runFitForNeed", () => {
  it("persists a run with ranked scores, components, snapshots, and roster links", async () => {
    const result = await runFitForNeed(fx.needId, fx.orgId, fx.userId);
    expect(result.modelVersion).toBe(FIT_MODEL_VERSION);
    expect(result.weightsSource).toBe("database");
    expect(result.evaluated).toBe(3); // three same-org D prospects; foreign org excluded
    expect(result.scored).toBe(3);

    const [run] = await db.select().from(schema.fitCalculationRuns).where(eq(schema.fitCalculationRuns.id, result.runId));
    expect(run?.status).toBe("complete");
    expect(run?.prospectsEvaluated).toBe(3);
    expect(run?.completedAt).not.toBeNull();

    const ranked = await getRankedFits(fx.needId, fx.orgId);
    expect(ranked).toHaveLength(3);
    // Ranked descending, and the star (right hand, top role, report) leads.
    expect(ranked[0]!.p.id).toBe(fx.starId);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.f.overallScore).toBeGreaterThanOrEqual(ranked[i]!.f.overallScore);
    }
    // The DB-customized handedness weight (0.42) is stored on the components.
    const comps = await db
      .select()
      .from(schema.prospectFitComponents)
      .where(eq(schema.prospectFitComponents.fitScoreId, ranked[0]!.f.id));
    expect(comps).toHaveLength(14);
    expect(comps.find((c) => c.componentKey === "handedness")?.weight).toBe(0.42);
    expect(comps.every((c) => c.explanation.length > 5)).toBe(true);

    const orgSnap = await db
      .select()
      .from(schema.organizationalDepthSnapshots)
      .where(eq(schema.organizationalDepthSnapshots.runId, result.runId));
    expect(orgSnap).toHaveLength(1);
    expect((orgSnap[0]!.snapshot as { activeContracts: number }).activeContracts).toBe(3);
    const poolSnap = await db
      .select()
      .from(schema.prospectPoolDepthSnapshots)
      .where(eq(schema.prospectPoolDepthSnapshots.runId, result.runId));
    expect(poolSnap).toHaveLength(1);

    const links = await db
      .select()
      .from(schema.organizationalNeedRosterLinks)
      .where(eq(schema.organizationalNeedRosterLinks.needId, fx.needId));
    expect(links.length).toBeGreaterThanOrEqual(1); // the 2027 expiring contract
    expect(links[0]?.linkType).toBe("expiring_contract");
  });

  it("grade minimums flow into scout_grades: report meeting mins scores 100, no report is null", async () => {
    const ranked = await getRankedFits(fx.needId, fx.orgId);
    const star = ranked.find((r) => r.p.id === fx.starId)!;
    const quiet = ranked.find((r) => r.p.id === fx.noReportId)!;
    const compOf = (row: typeof star, key: string) =>
      ((row.f.components as { list: Array<{ key: string; finalScore: number | null }> }).list).find((c) => c.key === key);
    expect(compOf(star, "scout_grades")?.finalScore).toBe(100);
    expect(compOf(quiet, "scout_grades")?.finalScore).toBeNull(); // missing report ≠ low score
    expect(quiet.f.confidence!).toBeLessThan(star.f.confidence!);
    // Wrong hand is scored (low), not excluded.
    const lefty = ranked.find((r) => r.p.id === fx.wrongHandId)!;
    expect(compOf(lefty, "handedness")?.finalScore).toBe(20);
  });

  it("re-running upserts scores instead of duplicating and keeps run history", async () => {
    const before = await getRankedFits(fx.needId, fx.orgId);
    const second = await runFitForNeed(fx.needId, fx.orgId, fx.userId);
    const after = await getRankedFits(fx.needId, fx.orgId);
    expect(after).toHaveLength(before.length);
    const runs = await db
      .select()
      .from(schema.fitCalculationRuns)
      .where(and(eq(schema.fitCalculationRuns.needId, fx.needId), eq(schema.fitCalculationRuns.organizationId, fx.orgId)))
      .orderBy(desc(schema.fitCalculationRuns.startedAt));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(after[0]!.f.runId).toBe(second.runId);
    // Components were replaced, not appended.
    const comps = await db
      .select()
      .from(schema.prospectFitComponents)
      .where(eq(schema.prospectFitComponents.fitScoreId, after[0]!.f.id));
    expect(comps).toHaveLength(14);
  });

  it("enforces org isolation on runs, rankings, and needs", async () => {
    await expect(runFitForNeed(fx.needId, fx.otherOrgId, fx.userId)).rejects.toThrow(ScoutingError);
    await expect(runFitForNeed(fx.foreignNeedId, fx.orgId, fx.userId)).rejects.toThrow(ScoutingError);
    await expect(getRankedFits(fx.needId, fx.otherOrgId)).rejects.toThrow(ScoutingError);
  });
});

describe("depth summary and context", () => {
  it("summarizes org depth per position without mutating anything", async () => {
    const summary = await getDepthSummary(fx.orgId);
    const d = summary.find((s) => s.position === "D")!;
    expect(d.activeContracts).toBe(3);
    expect(d.minorLeague).toBe(1);
    expect(d.prospects).toBe(3);
    const g = summary.find((s) => s.position === "G")!;
    expect(g.scarce).toBe(true); // no goalies anywhere
  });

  it("builds the need-specific depth context from live contract data", async () => {
    const [need] = await db.select().from(schema.organizationalNeeds).where(eq(schema.organizationalNeeds.id, fx.needId));
    const depth = await buildDepthContext(fx.orgId, need!);
    expect(depth.context.contractsAtPosition).toBe(3);
    expect(depth.context.expiringWithinWindow).toBe(1); // the 2027 deal inside 4y
    expect(depth.context.minorLeagueAtPosition).toBe(1);
    expect(depth.context.prospectsAtPosition).toBe(3);
    expect(depth.context.prospectsAtTargetRole).toBeGreaterThanOrEqual(1);
  });

  it("a fit run never mutates official prospect/contract data", async () => {
    const prospectsBefore = await db.select().from(schema.amateurProspects).where(eq(schema.amateurProspects.organizationId, fx.orgId));
    const contractsBefore = await db.select().from(schema.contracts).where(eq(schema.contracts.organizationId, fx.orgId));
    await runFitForNeed(fx.needId, fx.orgId, fx.userId);
    const prospectsAfter = await db.select().from(schema.amateurProspects).where(eq(schema.amateurProspects.organizationId, fx.orgId));
    const contractsAfter = await db.select().from(schema.contracts).where(eq(schema.contracts.organizationId, fx.orgId));
    expect(prospectsAfter).toEqual(prospectsBefore);
    expect(contractsAfter).toEqual(contractsBefore);
  });
});

describe("comparison", () => {
  it("returns side-by-side entries in caller order with scores and inputs", async () => {
    const cmp = await getComparison(fx.needId, [fx.noReportId, fx.starId], fx.orgId);
    expect(cmp.entries).toHaveLength(2);
    expect(cmp.entries[0]!.prospect.id).toBe(fx.noReportId);
    expect(cmp.entries[1]!.prospect.id).toBe(fx.starId);
    expect(cmp.entries[1]!.score?.overallScore).toBeGreaterThan(0);
    expect(cmp.entries[1]!.input?.reportGrades).toEqual({ skating: 60, hockey_sense: 60 });
  });

  it("rejects out-of-range counts and cross-org prospects", async () => {
    await expect(getComparison(fx.needId, [fx.starId], fx.orgId)).rejects.toThrow(/2 and 5/);
    await expect(getComparison(fx.needId, [fx.starId, fx.foreignProspectId], fx.orgId)).rejects.toThrow(/not found/);
  });
});

describe("component definitions", () => {
  it("labels exist for every engine component key", () => {
    for (const key of FIT_COMPONENT_KEYS) {
      expect(FIT_COMPONENT_LABELS[key].length).toBeGreaterThan(3);
    }
  });
});
