/**
 * Database-level tests: organization isolation, role permissions, scenario
 * isolation from official records. Runs on an in-memory PGlite Postgres with
 * the real migrations applied.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { roleHasCapability } from "@/lib/auth/roles";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  teamA: string;
  playerA: string;
  contractA: string;
  scenarioA: string;
  seasonId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite(); // in-memory
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const [userA] = await db.insert(schema.users).values({ email: "a@x.test", fullName: "A", passwordHash: hashPassword("password-a") }).returning();
  const [userB] = await db.insert(schema.users).values({ email: "b@x.test", fullName: "B", passwordHash: hashPassword("password-b") }).returning();
  const [orgA] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
  const [orgB] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
  await db.insert(schema.organizationMembers).values([
    { organizationId: orgA!.id, userId: userA!.id, role: "org_admin" },
    { organizationId: orgB!.id, userId: userB!.id, role: "viewer" },
  ]);
  const [league] = await db.insert(schema.leagues).values({ name: "Test League", abbreviation: "TL" }).returning();
  const [season] = await db
    .insert(schema.leagueSeasons)
    .values({ leagueId: league!.id, name: "2025-26", startDate: "2025-10-01", endDate: "2026-06-01" })
    .returning();
  const [teamA] = await db
    .insert(schema.teams)
    .values({ organizationId: orgA!.id, leagueId: league!.id, name: "Team A", abbreviation: "TA" })
    .returning();
  const [playerA] = await db
    .insert(schema.players)
    .values({ organizationId: orgA!.id, fullName: "Org A Player", position: "C", currentTeamId: teamA!.id })
    .returning();
  const [contractA] = await db
    .insert(schema.contracts)
    .values({
      organizationId: orgA!.id,
      playerId: playerA!.id,
      teamId: teamA!.id,
      leagueId: league!.id,
      startDate: "2025-10-01",
      endDate: "2026-06-01",
      averageAnnualValue: 5_000_000,
    })
    .returning();
  await db.insert(schema.contractSeasons).values({
    contractId: contractA!.id,
    seasonId: season!.id,
    baseSalary: 5_000_000,
    totalCash: 5_000_000,
    capHit: 5_000_000,
  });
  const [scenarioA] = await db
    .insert(schema.scenarios)
    .values({ organizationId: orgA!.id, teamId: teamA!.id, baseSeasonId: season!.id, name: "Plan A" })
    .returning();

  Object.assign(fx, {
    orgA: orgA!.id,
    orgB: orgB!.id,
    userA: userA!.id,
    userB: userB!.id,
    teamA: teamA!.id,
    playerA: playerA!.id,
    contractA: contractA!.id,
    scenarioA: scenarioA!.id,
    seasonId: season!.id,
  });
});

afterAll(async () => {
  await pg.close();
});

/** The exact membership check requireOrgAccess performs. */
async function membershipRole(orgId: string, userId: string) {
  const rows = await db
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.organizationId, orgId), eq(schema.organizationMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

describe("organization isolation", () => {
  it("denies membership for a user of another organization", async () => {
    expect(await membershipRole(fx.orgA, fx.userB)).toBeNull();
    expect(await membershipRole(fx.orgA, fx.userA)).toBe("org_admin");
  });

  it("org-scoped player lookup does not resolve across organizations", async () => {
    const crossOrg = await db
      .select()
      .from(schema.players)
      .where(and(eq(schema.players.id, fx.playerA), eq(schema.players.organizationId, fx.orgB)));
    expect(crossOrg).toHaveLength(0);
    const sameOrg = await db
      .select()
      .from(schema.players)
      .where(and(eq(schema.players.id, fx.playerA), eq(schema.players.organizationId, fx.orgA)));
    expect(sameOrg).toHaveLength(1);
  });

  it("org-scoped scenario lookup does not resolve across organizations", async () => {
    const crossOrg = await db
      .select()
      .from(schema.scenarios)
      .where(and(eq(schema.scenarios.id, fx.scenarioA), eq(schema.scenarios.organizationId, fx.orgB)));
    expect(crossOrg).toHaveLength(0);
  });
});

describe("role permissions", () => {
  it("viewer can read but never edit, manage, or administer", () => {
    expect(roleHasCapability("viewer", "read")).toBe(true);
    expect(roleHasCapability("viewer", "edit_data")).toBe(false);
    expect(roleHasCapability("viewer", "manage_team")).toBe(false);
    expect(roleHasCapability("viewer", "admin")).toBe(false);
  });

  it("analyst can edit data but not manage teams or administer", () => {
    expect(roleHasCapability("cap_analyst", "edit_data")).toBe(true);
    expect(roleHasCapability("cap_analyst", "manage_team")).toBe(false);
  });

  it("coach and scout can annotate but not edit official data", () => {
    expect(roleHasCapability("coach", "annotate")).toBe(true);
    expect(roleHasCapability("coach", "edit_data")).toBe(false);
    expect(roleHasCapability("scout", "edit_data")).toBe(false);
  });

  it("compliance officer can review; GM manages teams; org admin administers", () => {
    expect(roleHasCapability("compliance_officer", "review")).toBe(true);
    expect(roleHasCapability("general_manager", "manage_team")).toBe(true);
    expect(roleHasCapability("general_manager", "admin")).toBe(false);
    expect(roleHasCapability("org_admin", "admin")).toBe(true);
  });
});

describe("scenario isolation from official data", () => {
  it("adding scenario transactions leaves contracts and players untouched", async () => {
    await db.insert(schema.scenarioTransactions).values({
      scenarioId: fx.scenarioA,
      transactionType: "trade",
      label: "Hypothetical trade",
      payload: { kind: "trade_out", contractId: fx.contractA, retainedPct: 0.5 },
    });
    const [contract] = await db.select().from(schema.contracts).where(eq(schema.contracts.id, fx.contractA));
    expect(contract?.contractStatus).toBe("active");
    expect(contract?.retainedSalaryPercentage).toBe(0);
    const [player] = await db.select().from(schema.players).where(eq(schema.players.id, fx.playerA));
    expect(player?.currentTeamId).toBe(fx.teamA);
  });

  it("unique constraint prevents duplicate contract-season rows", async () => {
    await expect(
      db.insert(schema.contractSeasons).values({
        contractId: fx.contractA,
        seasonId: fx.seasonId,
        baseSalary: 1,
        totalCash: 1,
        capHit: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("password hashing", () => {
  it("verifies correct passwords and rejects wrong ones", () => {
    const hash = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});
