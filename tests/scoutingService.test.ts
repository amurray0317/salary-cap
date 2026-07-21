/**
 * Amateur-scouting service integration tests on in-memory PGlite via
 * setDbForTesting: role-score persistence, fit with live contract depth,
 * org isolation, permissions, and audit expectations.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import {
  computeRoleScores,
  computeTrends,
  computeFit,
  computePercentilePanel,
  loadDepthContext,
  ageAtSeason,
  ScoutingError,
} from "@/server/services/scoutingService";
import { roleHasCapability } from "@/lib/auth/roles";
import { ROLE_MODEL_VERSION, FIT_MODEL_VERSION } from "@/lib/scouting/archetypes";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  otherOrgId: string;
  subjectId: string; // high-scoring D
  needId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);

  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-sc" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-sc" }).returning();

  // Archetype + weights (assists-driven puck-mover for D).
  const [arch] = await db
    .insert(schema.roleArchetypes)
    .values({ key: "puck_moving_d", label: "Puck-moving defenseman", positionGroup: "D" })
    .returning();
  await db.insert(schema.roleMetricWeights).values([
    { archetypeId: arch!.id, metric: "assistsPerGame", weight: 0.6, modelVersion: ROLE_MODEL_VERSION, effectiveDate: "2025-09-01" },
    { archetypeId: arch!.id, metric: "ppg", weight: 0.4, modelVersion: ROLE_MODEL_VERSION, effectiveDate: "2025-09-01" },
  ]);

  // Subject + 20 peers (D) so the percentile pool is meaningful.
  const mkProspect = async (name: string, opts: { assists: number; org?: string; hand?: string }) => {
    const [p] = await db
      .insert(schema.amateurProspects)
      .values({
        organizationId: opts.org ?? org!.id,
        fullName: name,
        position: "D",
        positionGroup: "D",
        shootsCatches: opts.hand ?? "L",
        dateOfBirth: "2005-05-01",
        classYear: "sophomore",
      })
      .returning();
    await db.insert(schema.prospectSeasons).values([
      {
        prospectId: p!.id,
        seasonName: "2024-25",
        classYear: "freshman",
        gamesPlayed: 34,
        goals: 2,
        assists: Math.max(2, opts.assists - 10),
        shots: 60,
        teamGoalsFor: 110,
      },
      {
        prospectId: p!.id,
        seasonName: "2025-26",
        classYear: "sophomore",
        gamesPlayed: 34,
        goals: 4,
        assists: opts.assists,
        shots: 80,
        teamGoalsFor: 115,
      },
    ]);
    return p!;
  };

  const subject = await mkProspect("Elite Mover", { assists: 30, hand: "R" });
  for (let i = 0; i < 20; i++) {
    await mkProspect(`Peer D ${i}`, { assists: 4 + i });
  }
  // Cross-org prospect must never enter the subject's pool or be reachable.
  await mkProspect("Foreign Prospect", { assists: 50, org: otherOrg!.id });

  // Org contracts for depth context: 3 active D, one expiring soon.
  const [league] = await db.insert(schema.leagues).values({ name: "L", abbreviation: "L" }).returning();
  const [team] = await db
    .insert(schema.teams)
    .values({ organizationId: org!.id, leagueId: league!.id, name: "Pro Team", abbreviation: "PT" })
    .returning();
  for (let i = 0; i < 3; i++) {
    const [player] = await db
      .insert(schema.players)
      .values({ organizationId: org!.id, fullName: `Pro D ${i}`, position: "D", currentTeamId: team!.id })
      .returning();
    await db.insert(schema.contracts).values({
      organizationId: org!.id,
      playerId: player!.id,
      teamId: team!.id,
      leagueId: league!.id,
      contractStatus: "active",
      startDate: "2025-10-01",
      endDate: i === 0 ? "2026-06-01" : "2030-06-01",
      averageAnnualValue: 3_000_000,
    });
  }

  const [need] = await db
    .insert(schema.organizationalNeeds)
    .values({
      organizationId: org!.id,
      position: "D",
      handedness: "R",
      targetRoleKey: "puck_moving_d",
      priority: 1,
      timelineYears: 2,
      maxRiskTolerance: "medium",
    })
    .returning();

  Object.assign(fx, { orgId: org!.id, otherOrgId: otherOrg!.id, subjectId: subject.id, needId: need!.id });
});

afterAll(async () => {
  await pg.close();
});

describe("ageAtSeason", () => {
  it("computes age at the season's September start", () => {
    expect(ageAtSeason("2005-05-01", "2025-26")).toBe(20);
    expect(ageAtSeason("2005-11-01", "2025-26")).toBe(19);
    expect(ageAtSeason(null, "2025-26")).toBeNull();
  });
});

describe("computeRoleScores", () => {
  it("scores the subject high for the assist-weighted role and persists with model version", async () => {
    const { seasonName, scores } = await computeRoleScores(fx.subjectId, fx.orgId);
    expect(seasonName).toBe("2025-26");
    const top = scores[0];
    expect(top?.archetypeKey).toBe("puck_moving_d");
    expect(top?.score).toBeGreaterThan(80); // best assist rate in the pool
    expect(top?.poolSize).toBe(20); // cross-org prospect excluded

    const stored = await db
      .select()
      .from(schema.prospectRoleScores)
      .where(eq(schema.prospectRoleScores.prospectId, fx.subjectId));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.modelVersion).toBe(ROLE_MODEL_VERSION);
    const explanation = stored[0]?.explanation as { contributions: unknown[]; missingInputs: string[] };
    expect(explanation.contributions.length).toBeGreaterThan(0);
  });

  it("recomputation upserts instead of duplicating", async () => {
    await computeRoleScores(fx.subjectId, fx.orgId);
    const stored = await db
      .select()
      .from(schema.prospectRoleScores)
      .where(eq(schema.prospectRoleScores.prospectId, fx.subjectId));
    expect(stored).toHaveLength(1);
  });

  it("enforces org isolation", async () => {
    await expect(computeRoleScores(fx.subjectId, fx.otherOrgId)).rejects.toThrow(ScoutingError);
  });
});

describe("computeTrends", () => {
  it("produces a year-over-year classification for the subject", async () => {
    const trends = await computeTrends(fx.subjectId, fx.orgId);
    const yoy = trends.find((t) => t.kind === "year_over_year");
    expect(yoy).toBeDefined();
    expect(yoy?.classification).toBeTruthy();
    // No game logs seeded → last-5/last-10 must say insufficient sample, not fabricate.
    const last5 = trends.find((t) => t.kind === "last_5");
    expect(last5?.classification).toBe("insufficient_sample");
  });
});

describe("depth context and fit", () => {
  it("loads depth from live contract data", async () => {
    const depth = await loadDepthContext(fx.orgId, "D", 2);
    expect(depth.contractsAtPosition).toBe(3);
    expect(depth.expiringWithinTimeline).toBe(1);
  });

  it("computes an explainable fit and persists it with the model version", async () => {
    const fit = await computeFit(fx.subjectId, fx.needId, fx.orgId);
    expect(fit.overall).toBeGreaterThan(70); // right position, right hand, top role score
    expect(fit.components.map((c) => c.key)).toContain("opportunity");
    const opportunity = fit.components.find((c) => c.key === "opportunity");
    expect(opportunity?.explanation).toContain("3 active contract(s)");

    const stored = await db
      .select()
      .from(schema.prospectFitScores)
      .where(eq(schema.prospectFitScores.prospectId, fx.subjectId));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.modelVersion).toBe(FIT_MODEL_VERSION);
  });

  it("rejects a need from another organization", async () => {
    const [foreignNeed] = await db
      .insert(schema.organizationalNeeds)
      .values({ organizationId: fx.otherOrgId, position: "D", priority: 1, timelineYears: 2 })
      .returning();
    await expect(computeFit(fx.subjectId, foreignNeed!.id, fx.orgId)).rejects.toThrow(/Need not found/);
  });
});

describe("scouting permissions (capability tiers)", () => {
  it("read-only executives can view but not edit", () => {
    expect(roleHasCapability("viewer", "view_scouting")).toBe(true);
    expect(roleHasCapability("viewer", "edit_prospects")).toBe(false);
    expect(roleHasCapability("viewer", "create_scouting_reports")).toBe(false);
  });
  it("scouts can report and edit prospects but not assign or manage boards", () => {
    expect(roleHasCapability("scout", "create_scouting_reports")).toBe(true);
    expect(roleHasCapability("crossover_scout", "edit_prospects")).toBe(true);
    expect(roleHasCapability("scout", "assign_scouts")).toBe(false);
    expect(roleHasCapability("scout", "manage_draft_boards")).toBe(false);
  });
  it("assistant director manages boards; director assigns and manages needs; admin manages models", () => {
    expect(roleHasCapability("scouting_asst_director", "manage_draft_boards")).toBe(true);
    expect(roleHasCapability("scouting_director", "assign_scouts")).toBe(true);
    expect(roleHasCapability("scouting_director", "manage_org_needs")).toBe(true);
    expect(roleHasCapability("scouting_director", "manage_scouting_models")).toBe(false);
    expect(roleHasCapability("org_admin", "manage_scouting_models")).toBe(true);
  });
});

describe("watchlist and board data integrity", () => {
  it("watchlist membership is unique per prospect", async () => {
    const [wl] = await db
      .insert(schema.prospectWatchlists)
      .values({ organizationId: fx.orgId, name: "Test list" })
      .returning();
    await db.insert(schema.prospectWatchlistMembers).values({ watchlistId: wl!.id, prospectId: fx.subjectId });
    await expect(
      db.insert(schema.prospectWatchlistMembers).values({ watchlistId: wl!.id, prospectId: fx.subjectId }),
    ).rejects.toThrow();
  });

  it("board entries are unique per prospect per board", async () => {
    const [board] = await db
      .insert(schema.draftBoards)
      .values({ organizationId: fx.orgId, name: "Test board" })
      .returning();
    await db.insert(schema.draftBoardEntries).values({ boardId: board!.id, prospectId: fx.subjectId, overallRank: 1 });
    await expect(
      db.insert(schema.draftBoardEntries).values({ boardId: board!.id, prospectId: fx.subjectId, overallRank: 2 }),
    ).rejects.toThrow();
  });
});

describe("computePercentilePanel", () => {
  it("computes position pools, conference pools with min-sample cutoffs, and never crosses orgs", async () => {
    // Wire schools/conferences: subject + 9 peers in Conf A, the rest in Conf B.
    const [confA] = await db.insert(schema.conferences).values({ name: "Panel Conf A", level: "division_1" }).returning();
    const [confB] = await db.insert(schema.conferences).values({ name: "Panel Conf B", level: "division_1" }).returning();
    const [schoolA] = await db.insert(schema.schools).values({ name: "Panel School A", conferenceId: confA!.id }).returning();
    const [schoolB] = await db.insert(schema.schools).values({ name: "Panel School B", conferenceId: confB!.id }).returning();

    const prospects = await db
      .select()
      .from(schema.amateurProspects)
      .where(eq(schema.amateurProspects.organizationId, fx.orgId));
    for (const p of prospects) {
      const inA = p.id === fx.subjectId || /Peer D [0-8]$/.test(p.fullName);
      await db
        .update(schema.amateurProspects)
        .set({ schoolId: inA ? schoolA!.id : schoolB!.id })
        .where(eq(schema.amateurProspects.id, p.id));
    }

    const panel = await computePercentilePanel(fx.subjectId, fx.orgId);
    expect(panel.seasonName).toBe("2025-26");
    // Position pool: 20 same-org D peers; the cross-org prospect is excluded.
    expect(panel.position?.poolSize).toBe(20);
    // Conference pool: only the 9 Conf-A peers.
    expect(panel.conferenceName).toBe("Panel Conf A");
    expect(panel.conference?.poolSize).toBe(9);
    // Subject leads the org in assists → high percentile in both pools.
    expect(panel.position?.percentiles.ppg).toBeGreaterThan(90);
    expect(panel.conference?.percentiles.ppg).toBeGreaterThan(90);

    // Shrink Conf A below the 8-peer threshold → percentiles null, not extrapolated.
    const confAPeers = prospects.filter((p) => /Peer D [0-8]$/.test(p.fullName)).slice(0, 7);
    for (const p of confAPeers) {
      await db.update(schema.amateurProspects).set({ schoolId: schoolB!.id }).where(eq(schema.amateurProspects.id, p.id));
    }
    const small = await computePercentilePanel(fx.subjectId, fx.orgId);
    expect(small.conference?.poolSize).toBe(2);
    expect(small.conference?.percentiles.ppg).toBeNull();
    // Position pool unaffected by conference shuffling.
    expect(small.position?.poolSize).toBe(20);
  });

  it("enforces org isolation", async () => {
    await expect(computePercentilePanel(fx.subjectId, fx.otherOrgId)).rejects.toThrow(ScoutingError);
  });
});
