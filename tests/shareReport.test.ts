/**
 * Integration tests for shareable read-only reports
 * (src/server/services/reportService.ts) on in-memory PGlite via
 * setDbForTesting, with real migrations.
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
  generateRosterShareReport,
  getSharedReport,
  revokeShareReport,
  ReportError,
} from "@/server/services/reportService";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  otherOrgId: string;
  userId: string;
  teamId: string;
  seasonId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);

  const [user] = await db.insert(schema.users).values({ email: "r@t.test", fullName: "R" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-r" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-r" }).returning();
  const [league] = await db.insert(schema.leagues).values({ name: "L", abbreviation: "L" }).returning();
  const [season] = await db
    .insert(schema.leagueSeasons)
    .values({ leagueId: league!.id, name: "2025-26", startDate: "2025-10-01", endDate: "2026-06-01" })
    .returning();
  await db.insert(schema.leagueRules).values({
    leagueId: league!.id,
    seasonId: season!.id,
    ruleKey: "cap.upper_limit",
    ruleName: "Salary cap upper limit",
    ruleCategory: "cap",
    numericValue: 80_000_000,
    effectiveDate: "2025-10-01",
    ruleVersion: 1,
    isActive: true,
  });
  const [team] = await db
    .insert(schema.teams)
    .values({ organizationId: org!.id, leagueId: league!.id, name: "Team", abbreviation: "T" })
    .returning();
  const [player] = await db
    .insert(schema.players)
    .values({ organizationId: org!.id, fullName: "P One", position: "C", currentTeamId: team!.id })
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
      endDate: "2026-06-01",
      averageAnnualValue: 5_000_000,
    })
    .returning();
  await db.insert(schema.contractSeasons).values({
    contractId: contract!.id,
    seasonId: season!.id,
    baseSalary: 5_000_000,
    totalCash: 5_000_000,
    capHit: 5_000_000,
  });

  Object.assign(fx, {
    orgId: org!.id,
    otherOrgId: otherOrg!.id,
    userId: user!.id,
    teamId: team!.id,
    seasonId: season!.id,
  });
});

afterAll(async () => {
  await pg.close();
});

describe("shareable reports", () => {
  it("generates a frozen snapshot with sections, rule versions, and an audit entry", async () => {
    const { reportId, shareToken } = await generateRosterShareReport({
      organizationId: fx.orgId,
      teamId: fx.teamId,
      seasonId: fx.seasonId,
      userId: fx.userId,
    });
    expect(shareToken.length).toBeGreaterThan(20);

    const shared = await getSharedReport(shareToken);
    expect(shared).not.toBeNull();
    expect(shared!.report.id).toBe(reportId);
    expect(shared!.report.reportType).toBe("roster_cap");
    const types = shared!.sections.map((s) => s.sectionType);
    expect(types).toEqual(["summary", "line_items", "commitments", "compliance", "disclaimer"]);

    const summary = shared!.sections[0]!.content as { totals: { totalCapCharge: number; capSpace: number } };
    expect(summary.totals.totalCapCharge).toBe(5_000_000);
    expect(summary.totals.capSpace).toBe(75_000_000);

    const modelVersions = shared!.report.modelVersions as { rules: Array<{ key: string; version: number }> };
    expect(modelVersions.rules.some((r) => r.key === "cap.upper_limit" && r.version === 1)).toBe(true);

    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "report.share_create"));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("the snapshot is frozen: later data changes do not alter it", async () => {
    const { shareToken } = await generateRosterShareReport({
      organizationId: fx.orgId,
      teamId: fx.teamId,
      seasonId: fx.seasonId,
      userId: fx.userId,
    });
    // Change official data after generating.
    await db
      .update(schema.contractSeasons)
      .set({ capHit: 9_000_000 })
      .where(eq(schema.contractSeasons.capHit, 5_000_000));
    const shared = await getSharedReport(shareToken);
    const summary = shared!.sections[0]!.content as { totals: { totalCapCharge: number } };
    expect(summary.totals.totalCapCharge).toBe(5_000_000); // still the snapshot value
    // restore
    await db
      .update(schema.contractSeasons)
      .set({ capHit: 5_000_000 })
      .where(eq(schema.contractSeasons.capHit, 9_000_000));
  });

  it("revoking clears the token so the link 404s, keeping the snapshot", async () => {
    const { reportId, shareToken } = await generateRosterShareReport({
      organizationId: fx.orgId,
      teamId: fx.teamId,
      seasonId: fx.seasonId,
      userId: fx.userId,
    });
    await revokeShareReport({ reportId, organizationId: fx.orgId, userId: fx.userId });
    expect(await getSharedReport(shareToken)).toBeNull();
    const [report] = await db.select().from(schema.reports).where(eq(schema.reports.id, reportId));
    expect(report?.shareToken).toBeNull();
    const sections = await db
      .select()
      .from(schema.reportSections)
      .where(eq(schema.reportSections.reportId, reportId));
    expect(sections.length).toBe(5);
  });

  it("enforces organization isolation on generate and revoke", async () => {
    await expect(
      generateRosterShareReport({
        organizationId: fx.otherOrgId, // team belongs to fx.orgId
        teamId: fx.teamId,
        seasonId: fx.seasonId,
        userId: fx.userId,
      }),
    ).rejects.toThrow(ReportError);

    const { reportId } = await generateRosterShareReport({
      organizationId: fx.orgId,
      teamId: fx.teamId,
      seasonId: fx.seasonId,
      userId: fx.userId,
    });
    await expect(
      revokeShareReport({ reportId, organizationId: fx.otherOrgId, userId: fx.userId }),
    ).rejects.toThrow(ReportError);
  });

  it("rejects unknown and oversized tokens", async () => {
    expect(await getSharedReport("does-not-exist")).toBeNull();
    expect(await getSharedReport("x".repeat(200))).toBeNull();
    expect(await getSharedReport("")).toBeNull();
  });
});
