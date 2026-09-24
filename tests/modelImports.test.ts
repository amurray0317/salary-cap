/**
 * RosterIQ model outputs → gated import pipeline, on in-memory PGlite with
 * the real migrations. Model files come from tests/fixtures/models/ — trimmed
 * copies of the committed models/<version>/ import files (whole rows,
 * unedited; see manifest.json there and analytics/make_test_fixtures.py).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { ConnectorError, runConnectorImport } from "@/server/services/connectorService";
import { commitImport, getImportDetail } from "@/server/services/importService";
import { XG_GROUPS } from "@/lib/import/connectorDefinitions";

const MODELS = path.join(process.cwd(), "tests", "fixtures", "models");
const hasProspects = fs.existsSync(path.join(MODELS, "rosteriq-prospects-v1", "import_prospects.csv"));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { orgId: string; otherOrgId: string; userId: string };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  const [user] = await db.insert(schema.users).values({ email: "m@t.test", fullName: "M" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-m" }).returning();
  const [other] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-m" }).returning();
  fx.userId = user!.id;
  fx.orgId = org!.id;
  fx.otherOrgId = other!.id;
});

afterAll(async () => {
  await pg.close();
});

const run = (request: Parameters<typeof runConnectorImport>[0]["request"], modelsDir = MODELS, orgId = fx.orgId) =>
  runConnectorImport({ organizationId: orgId, userId: fx.userId, request }, { modelsDir });

describe("RosterIQ xG season totals", () => {
  it("stages a preview with file provenance and writes nothing before approval", async () => {
    const res = await run({ dataset: "rosteriq_xg_skaters", season: "2025-26", gameType: "regular" });
    expect(res.errorCount).toBe(0);
    expect(res.validCount).toBe(4); // McDavid: all, 5on5, 5on4, 4on5
    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.row).toMatchObject({ status: "awaiting_approval", sourceKind: "connector", connectorKey: "rosteriq_models" });
    expect(detail.sourceMeta?.urls[0]).toMatch(/^models\/rosteriq-xg-v1\/import_xg_skaters\.csv \(sha256 [0-9a-f]{16}…\)$/);
    expect(detail.sourceMeta?.params).toMatchObject({ modelVersion: "rosteriq-xg-v1" });
    expect(String(detail.sourceMeta?.params.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.sourceMeta?.effectiveSeason).toBe("2025-26");
    expect(await db.select().from(schema.extPlayerSeasons)).toHaveLength(0);
  });

  it("approval commits the totals with their breakdown, and the breakdown adds up", async () => {
    const res = await run({ dataset: "rosteriq_xg_skaters", season: "2025-26", gameType: "regular" });
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const rows = await db
      .select()
      .from(schema.extPlayerSeasons)
      .where(and(eq(schema.extPlayerSeasons.organizationId, fx.orgId), eq(schema.extPlayerSeasons.source, "rosteriq_xg")));
    const all = rows.find((r) => r.situation === "all" && r.externalPlayerId === "8478402")!;
    expect(all.playerName).toBe("Connor McDavid");
    expect(all.sourceId).not.toBeNull();
    const m = all.metrics as Record<string, number>;
    const reasons = XG_GROUPS.reduce((a, g) => a + m[`xg_from_${g}`]!, 0);
    // ixG = baseline + reasons (rounded to 4 dp per value in the export).
    expect(Math.abs(m.baseline_xg! + reasons - all.xGoals!)).toBeLessThan(0.01);
    expect(m.unblocked_attempts).toBeGreaterThan(0);
    const [ds] = await db.select().from(schema.dataSources).where(eq(schema.dataSources.id, all.sourceId!));
    expect(ds!.credit).toMatch(/RosterIQ model/);
  });

  it("re-importing the same season updates rows in place", async () => {
    const res = await run({ dataset: "rosteriq_xg_skaters", season: "2025-26", gameType: "regular" });
    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.existingCount).toBe(4);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const rows = await db.select().from(schema.extPlayerSeasons).where(eq(schema.extPlayerSeasons.source, "rosteriq_xg"));
    expect(rows).toHaveLength(4);
  });

  it("goalie and team totals commit to their tables", async () => {
    const g = await run({ dataset: "rosteriq_xg_goalies", season: "2025-26", gameType: "regular" });
    await commitImport({ importId: g.importId, organizationId: fx.orgId, userId: fx.userId });
    const goalie = await db.select().from(schema.extPlayerSeasons).where(eq(schema.extPlayerSeasons.source, "rosteriq_xg_goalies"));
    expect(goalie.length).toBeGreaterThan(0);
    const a = goalie.find((r) => r.situation === "all")!;
    expect(Math.abs((a.xGoals! - a.goalsAgainst!) - (a.metrics as Record<string, number>).gsax!)).toBeLessThan(0.01);

    const t = await run({ dataset: "rosteriq_xg_teams", season: "2025-26", gameType: "regular" });
    await commitImport({ importId: t.importId, organizationId: fx.orgId, userId: fx.userId });
    const teams = await db.select().from(schema.extTeamSeasons).where(eq(schema.extTeamSeasons.source, "rosteriq_xg"));
    expect(new Set(teams.map((r) => r.teamAbbrev))).toEqual(new Set(["EDM", "WPG"]));
  });

  it("is organization-isolated", async () => {
    const other = await db.select().from(schema.extPlayerSeasons).where(eq(schema.extPlayerSeasons.organizationId, fx.otherOrgId));
    expect(other).toHaveLength(0);
  });

  it("refuses a season the file does not cover", async () => {
    await expect(run({ dataset: "rosteriq_xg_skaters", season: "1999-00", gameType: "regular" })).rejects.toThrow(/has no rows for 1999-00/);
  });
});

describe("model file safety", () => {
  it("refuses a file whose columns differ from the import definition", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riq-models-"));
    const dir = path.join(tmp, "rosteriq-xg-v1");
    fs.mkdirSync(dir);
    const src = fs.readFileSync(path.join(MODELS, "rosteriq-xg-v1", "import_xg_teams.csv"), "utf8");
    fs.writeFileSync(path.join(dir, "import_xg_teams.csv"), src.replace("x_goals_for", "xgf"));
    await expect(run({ dataset: "rosteriq_xg_teams", season: "2025-26", gameType: "regular" }, tmp)).rejects.toThrow(
      /columns do not match the import definition \(missing: x_goals_for; unexpected: xgf\)/,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports a missing model output instead of importing anything", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riq-models-"));
    await expect(run({ dataset: "rosteriq_nhle" }, tmp)).rejects.toBeInstanceOf(ConnectorError);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe.runIf(hasProspects)("RosterIQ prospect projections and NHLe", () => {
  it("commits projections with contributions that add up, and outcomes only when known", async () => {
    const res = await run({ dataset: "rosteriq_prospects", draftYear: 2015 });
    expect(res.errorCount).toBe(0);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const rows = await db.select().from(schema.extProspectProjections).where(eq(schema.extProspectProjections.organizationId, fx.orgId));
    expect(rows.length).toBe(res.validCount);
    for (const r of rows) {
      const sum = Object.values(r.contributions as Record<string, number>).reduce((a, v) => a + v, 0);
      expect(Math.abs(r.baselineP + sum - r.pNhlRegular)).toBeLessThan(0.002);
      expect(r.labelMature).toBe(true);
      expect(r.nhlRegular).not.toBeNull();
      expect(r.projectionKind).toBe("out_of_sample_leave_one_draft_out");
    }
    expect(rows.find((r) => r.externalPlayerId === "8478402")?.playerName).toBe("Connor McDavid");
  });

  it("commits league equivalencies", async () => {
    const res = await run({ dataset: "rosteriq_nhle" });
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const rows = await db.select().from(schema.extLeagueEquivalencies);
    const nhl = rows.find((r) => r.league === "NHL")!;
    expect(nhl.multiplier).toBe(1);
    const ohl = rows.find((r) => r.league === "OHL")!;
    expect(ohl.multiplier).toBeGreaterThan(0);
    expect(ohl.multiplier).toBeLessThan(1);
  });
});
