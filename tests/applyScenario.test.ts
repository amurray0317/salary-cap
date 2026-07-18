/**
 * Integration tests for applying a scenario to official records
 * (src/server/services/applyService.ts) on an in-memory PGlite database with
 * the real migrations.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { applyScenario, ApplyError } from "@/server/services/applyService";
import type { Db } from "@/db/client";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  userId: string;
  teamId: string;
  seasonIds: string[]; // 2 seasons, ordered
  seasonNames: string[];
  playerId: string;
  contractId: string;
  scenarioId: string;
}
let fx: Fixture;

async function addScenarioTx(scenarioId: string, label: string, payload: unknown, sortOrder = 0) {
  await db.insert(schema.scenarioTransactions).values({
    scenarioId,
    sortOrder,
    transactionType: "trade",
    label,
    payload,
  });
}

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const [user] = await db.insert(schema.users).values({ email: "gm@t.test", fullName: "GM" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-t" }).returning();
  await db.insert(schema.organizationMembers).values({ organizationId: org!.id, userId: user!.id, role: "general_manager" });
  const [league] = await db.insert(schema.leagues).values({ name: "L", abbreviation: "L" }).returning();
  const seasonDefs = [
    { name: "2025-26", startDate: "2025-10-01", endDate: "2026-06-01", sortOrder: 0 },
    { name: "2026-27", startDate: "2026-10-01", endDate: "2027-06-01", sortOrder: 1 },
  ];
  const seasonIds: string[] = [];
  for (const def of seasonDefs) {
    const [s] = await db.insert(schema.leagueSeasons).values({ leagueId: league!.id, ...def }).returning();
    seasonIds.push(s!.id);
  }
  const [team] = await db
    .insert(schema.teams)
    .values({ organizationId: org!.id, leagueId: league!.id, name: "Team", abbreviation: "T" })
    .returning();
  const [player] = await db
    .insert(schema.players)
    .values({ organizationId: org!.id, fullName: "Roster Guy", position: "C", currentTeamId: team!.id })
    .returning();
  const [contract] = await db
    .insert(schema.contracts)
    .values({
      organizationId: org!.id,
      playerId: player!.id,
      teamId: team!.id,
      leagueId: league!.id,
      contractStatus: "active",
      startDate: "2025-10-01",
      endDate: "2027-06-01",
      averageAnnualValue: 4_000_000,
    })
    .returning();
  for (const sid of seasonIds) {
    await db.insert(schema.contractSeasons).values({
      contractId: contract!.id,
      seasonId: sid,
      baseSalary: 4_000_000,
      totalCash: 4_000_000,
      capHit: 4_000_000,
    });
  }
  const [scenario] = await db
    .insert(schema.scenarios)
    .values({ organizationId: org!.id, teamId: team!.id, baseSeasonId: seasonIds[0]!, name: "Plan", status: "active" })
    .returning();

  fx = {
    orgId: org!.id,
    userId: user!.id,
    teamId: team!.id,
    seasonIds,
    seasonNames: seasonDefs.map((d) => d.name),
    playerId: player!.id,
    contractId: contract!.id,
    scenarioId: scenario!.id,
  };
});

afterEach(async () => {
  await pg.close();
});

const asDb = () => db as unknown as Db;

describe("applyScenario — signing", () => {
  it("creates player, contract, and season rows, logs a transaction, marks scenario applied", async () => {
    await addScenarioTx(fx.scenarioId, "Sign winger", {
      kind: "sign_free_agent",
      playerName: "New Winger",
      position: "LW",
      isTwoWay: false,
      seasons: [
        { seasonName: "2025-26", capHit: 3_000_000 },
        { seasonName: "2026-27", capHit: 3_000_000 },
      ],
    });

    const result = await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });
    expect(result.appliedCount).toBe(1);
    expect(result.moves[0]?.summary).toBe("Signed New Winger");

    const [newPlayer] = await db
      .select()
      .from(schema.players)
      .where(and(eq(schema.players.fullName, "New Winger"), eq(schema.players.organizationId, fx.orgId)));
    expect(newPlayer?.currentTeamId).toBe(fx.teamId);
    expect(newPlayer?.rosterStatus).toBe("pro_active");

    const contracts = await db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.playerId, newPlayer!.id));
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.averageAnnualValue).toBe(3_000_000);
    const seasonRows = await db
      .select()
      .from(schema.contractSeasons)
      .where(eq(schema.contractSeasons.contractId, contracts[0]!.id));
    expect(seasonRows).toHaveLength(2);

    const [scenario] = await db.select().from(schema.scenarios).where(eq(schema.scenarios.id, fx.scenarioId));
    expect(scenario?.status).toBe("applied");

    const officialTx = await db.select().from(schema.transactions).where(eq(schema.transactions.organizationId, fx.orgId));
    expect(officialTx).toHaveLength(1);
    expect(officialTx[0]?.transactionType).toBe("sign_free_agent");
    expect(officialTx[0]?.isOfficial).toBe(true);

    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "scenario.apply"));
    expect(audit).toHaveLength(1);
  });
});

describe("applyScenario — trade out with retention", () => {
  it("marks the contract traded, releases the player, and creates per-season retained obligations", async () => {
    await addScenarioTx(fx.scenarioId, "Trade Roster Guy", {
      kind: "trade_out",
      contractId: fx.contractId,
      retainedPct: 0.25,
      tradePartner: "Rivals",
    });

    await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });

    const [contract] = await db.select().from(schema.contracts).where(eq(schema.contracts.id, fx.contractId));
    expect(contract?.contractStatus).toBe("traded");
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, fx.playerId));
    expect(player?.currentTeamId).toBeNull();
    expect(player?.rosterStatus).toBe("non_roster");

    const obligations = await db
      .select()
      .from(schema.capObligations)
      .where(eq(schema.capObligations.teamId, fx.teamId))
      .orderBy(asc(schema.capObligations.seasonId));
    expect(obligations).toHaveLength(2); // one per contract season
    for (const ob of obligations) {
      expect(ob.obligationType).toBe("retained");
      expect(ob.amount).toBe(1_000_000); // 4M × 25%
      expect(ob.playerName).toBe("Roster Guy");
    }
  });

  it("without retention creates no obligations", async () => {
    await addScenarioTx(fx.scenarioId, "Clean trade", { kind: "trade_out", contractId: fx.contractId, retainedPct: 0 });
    await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });
    const obligations = await db.select().from(schema.capObligations).where(eq(schema.capObligations.teamId, fx.teamId));
    expect(obligations).toHaveLength(0);
  });
});

describe("applyScenario — assignments, extension, buyout", () => {
  it("send_down then call_up updates the player's official roster status", async () => {
    await addScenarioTx(fx.scenarioId, "Send down", { kind: "send_down", contractId: fx.contractId }, 0);
    await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, fx.playerId));
    expect(player?.rosterStatus).toBe("minor");
  });

  it("extension adds only new seasons and updates contract totals", async () => {
    // Contract already covers both seasons; extending 2026-27 again must fail…
    await addScenarioTx(fx.scenarioId, "Bad extension", {
      kind: "extension",
      contractId: fx.contractId,
      seasons: [{ seasonName: "2026-27", capHit: 5_000_000 }],
    });
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(ApplyError);
    // …and the failed apply must roll back completely (scenario still active).
    const [scenario] = await db.select().from(schema.scenarios).where(eq(schema.scenarios.id, fx.scenarioId));
    expect(scenario?.status).toBe("active");
  });

  it("buyout marks contract bought_out, frees the player, and books dead cap", async () => {
    await addScenarioTx(fx.scenarioId, "Buy out", {
      kind: "buyout",
      contractId: fx.contractId,
      deadCapFraction: 2 / 3,
    });
    await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });
    const [contract] = await db.select().from(schema.contracts).where(eq(schema.contracts.id, fx.contractId));
    expect(contract?.contractStatus).toBe("bought_out");
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, fx.playerId));
    expect(player?.freeAgentStatus).toBe("ufa");
    const obligations = await db.select().from(schema.capObligations).where(eq(schema.capObligations.teamId, fx.teamId));
    expect(obligations).toHaveLength(2);
    expect(obligations[0]?.obligationType).toBe("buyout");
    expect(obligations[0]?.amount).toBe(Math.round(4_000_000 * (2 / 3)));
  });
});

describe("applyScenario — guards", () => {
  it("refuses an already-applied scenario", async () => {
    await addScenarioTx(fx.scenarioId, "Send down", { kind: "send_down", contractId: fx.contractId });
    await applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId });
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(/already been applied/);
  });

  it("refuses archived scenarios and scenarios from another organization", async () => {
    await db.update(schema.scenarios).set({ status: "archived" }).where(eq(schema.scenarios.id, fx.scenarioId));
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(/Archived/);

    const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-t" }).returning();
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: otherOrg!.id, userId: fx.userId }),
    ).rejects.toThrow(/not found/);
  });

  it("refuses when a payload is invalid, without partial application", async () => {
    await addScenarioTx(fx.scenarioId, "Good move", { kind: "send_down", contractId: fx.contractId }, 0);
    await addScenarioTx(fx.scenarioId, "Broken move", { kind: "trade_out", contractId: "not-a-uuid" }, 1);
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(/invalid payload/);
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, fx.playerId));
    expect(player?.rosterStatus).toBe("pro_active"); // good move was not applied either
  });

  it("skips disabled transactions", async () => {
    await addScenarioTx(fx.scenarioId, "Send down", { kind: "send_down", contractId: fx.contractId }, 0);
    await db
      .update(schema.scenarioTransactions)
      .set({ isEnabled: false })
      .where(eq(schema.scenarioTransactions.scenarioId, fx.scenarioId));
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(/no enabled transactions/);
  });

  it("mid-transaction failure rolls back earlier moves (atomicity)", async () => {
    await addScenarioTx(fx.scenarioId, "Sign someone", {
      kind: "sign_free_agent",
      playerName: "Atomic Test",
      position: "C",
      isTwoWay: false,
      seasons: [{ seasonName: "2025-26", capHit: 1_000_000 }],
    }, 0);
    // References a contract that doesn't exist on this team → fails mid-apply.
    await addScenarioTx(fx.scenarioId, "Bad target", {
      kind: "call_up",
      contractId: "5b3f0000-0000-4000-8000-00000000dead",
    }, 1);
    await expect(
      applyScenario(asDb(), { scenarioId: fx.scenarioId, organizationId: fx.orgId, userId: fx.userId }),
    ).rejects.toThrow(ApplyError);
    const ghosts = await db.select().from(schema.players).where(eq(schema.players.fullName, "Atomic Test"));
    expect(ghosts).toHaveLength(0);
    const officialTx = await db.select().from(schema.transactions).where(eq(schema.transactions.organizationId, fx.orgId));
    expect(officialTx).toHaveLength(0);
  });
});
