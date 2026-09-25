/**
 * Connector → gated import pipeline integration tests on in-memory PGlite
 * with the real migrations. The network is replaced by a stub that serves
 * the RECORDED real responses in tests/fixtures/connectors/ by URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import type { FetchImpl } from "@/lib/connectors/http";
import { HostRateLimiter } from "@/lib/connectors/rateLimiter";
import { ConnectorError, runConnectorImport } from "@/server/services/connectorService";
import { commitImport, getImportDetail, ImportError, rejectImport } from "@/server/services/importService";

const FIX = path.join(process.cwd(), "tests", "fixtures", "connectors");
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8")) as Array<{ file: string; url: string; status: number }>;

/** Serves recorded fixtures by exact URL; counts calls. */
function fixtureFetch(): { impl: FetchImpl; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchImpl = async (url) => {
    calls.push(url);
    const hit = manifest.find((m) => m.url === url);
    let status = 404;
    let body = "not recorded";
    if (hit) {
      status = hit.status;
      body = fs.readFileSync(path.join(FIX, hit.file), "utf8");
    } else if (url.startsWith("https://api.eliteprospects.com/")) {
      status = 401;
      body = fs.readFileSync(path.join(FIX, "eliteprospects/401-invalid-key.json"), "utf8");
    }
    return { status, headers: { get: () => (url.endsWith(".csv") ? "text/csv" : "application/json") }, text: async () => body };
  };
  return { impl, calls };
}

const noWait = () => new HostRateLimiter({}, 0, { now: () => 0, sleep: async () => undefined });

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { orgId: string; otherOrgId: string; userId: string };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  const [user] = await db.insert(schema.users).values({ email: "c@t.test", fullName: "C" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-c" }).returning();
  const [other] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-c" }).returning();
  fx.userId = user!.id;
  fx.orgId = org!.id;
  fx.otherOrgId = other!.id;
});

afterAll(async () => {
  await pg.close();
});

const run = (request: Parameters<typeof runConnectorImport>[0]["request"], f = fixtureFetch(), orgId = fx.orgId, extra: { bypassCache?: boolean; env?: Record<string, string> } = {}) =>
  runConnectorImport(
    { organizationId: orgId, userId: fx.userId, request, bypassCache: extra.bypassCache },
    { fetchImpl: f.impl, limiter: noWait(), env: extra.env ?? {} },
  );

describe("gated connector imports", () => {
  it("stages a preview and writes NOTHING until explicit approval", async () => {
    const f = fixtureFetch();
    const res = await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 }, f);
    expect(res.validCount).toBe(26);
    expect(res.errorCount).toBe(0);
    expect(f.calls).toEqual(["https://api-web.nhle.com/v1/draft/rankings/2025/1"]);

    const [imp] = await db.select().from(schema.imports).where(eq(schema.imports.id, res.importId));
    expect(imp).toMatchObject({ status: "awaiting_approval", sourceKind: "connector", connectorKey: "nhl_api", importType: "nhl_draft_rankings" });
    expect(await db.select().from(schema.extDraftRankings)).toHaveLength(0);
    expect(await db.select().from(schema.dataSources)).toHaveLength(0);

    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.sourceMeta?.credit).toMatch(/Central Scouting/);
    expect(detail.existingCount).toBe(0);
  });

  it("approval commits rows with a data_sources provenance record", async () => {
    const res = await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 });
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const [source] = await db.select().from(schema.dataSources).where(eq(schema.dataSources.importId, res.importId));
    expect(source).toMatchObject({
      organizationId: fx.orgId,
      sourceKey: "nhl_api",
      url: "https://api-web.nhle.com/v1/draft/rankings/2025/1",
      effectiveSeason: "2025 NHL Draft",
      name: "NHL Central Scouting — 2025 rankings, North American skaters",
    });
    expect(source!.retrievedAt).toBeInstanceOf(Date);
    expect(source!.credit).toMatch(/NHL Central Scouting/);
    const rows = await db.select().from(schema.extDraftRankings).where(eq(schema.extDraftRankings.organizationId, fx.orgId));
    expect(rows).toHaveLength(26);
    expect(rows.every((r) => r.sourceId === source!.id && r.importId === res.importId)).toBe(true);
    const schaefer = rows.find((r) => r.playerName === "Matthew Schaefer");
    expect(schaefer).toMatchObject({ midtermRank: 1, finalRank: 1, draftYear: 2025, categoryId: 1 });
    expect(rows.some((r) => r.midtermRank === null && r.finalRank !== null)).toBe(true);
  });

  it("re-importing the same data updates in place (preview says so) instead of duplicating", async () => {
    const res = await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 });
    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.existingCount).toBe(26);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    expect(await db.select().from(schema.extDraftRankings)).toHaveLength(26);
    expect(await db.select().from(schema.dataSources)).toHaveLength(2); // one per approved import
  });

  it("serves repeats from the org's cache, refetches on bypass, and never shares cache across orgs", async () => {
    const f = fixtureFetch();
    await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 }, f);
    expect(f.calls).toHaveLength(0); // cached by the earlier tests
    await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 }, f, fx.orgId, { bypassCache: true });
    expect(f.calls).toHaveLength(1);
    await run({ dataset: "nhl_draft_rankings", year: 2025, category: 1 }, f, fx.otherOrgId);
    expect(f.calls).toHaveLength(2);
    const [imp] = await db
      .select()
      .from(schema.imports)
      .where(and(eq(schema.imports.organizationId, fx.orgId), eq(schema.imports.importType, "nhl_draft_rankings")))
      .limit(1);
    expect((imp!.sourceMeta as { fromCache: boolean[] }).fromCache).toEqual([false]);
  });

  it("isolates organizations: no foreign rows, no foreign approvals", async () => {
    const [foreign] = await db
      .select()
      .from(schema.imports)
      .where(and(eq(schema.imports.organizationId, fx.otherOrgId), eq(schema.imports.status, "awaiting_approval")));
    await expect(commitImport({ importId: foreign!.id, organizationId: fx.orgId, userId: fx.userId })).rejects.toThrow(ImportError);
    await expect(getImportDetail(foreign!.id, fx.orgId)).rejects.toThrow(ImportError);
    expect(await db.select().from(schema.extDraftRankings).where(eq(schema.extDraftRankings.organizationId, fx.otherOrgId))).toHaveLength(0);
  });

  it("rejected imports write nothing", async () => {
    const res = await run({ dataset: "nhl_draft_picks", year: 2024, round: 1 });
    await rejectImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    await expect(commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId })).rejects.toThrow(/awaiting approval/);
    expect(await db.select().from(schema.extDraftPicks)).toHaveLength(0);
  });

  it("career import stores NULL (never 0) where the source has no TOI", async () => {
    const res = await run({ dataset: "nhl_player_seasons", playerIds: ["8478402"] });
    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.sourceMeta?.warnings.some((w) => w.includes("no time-on-ice"))).toBe(true);
    expect(detail.sourceMeta?.effectiveSeason).toBe("career through 2025-26");
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const rows = await db.select().from(schema.extPlayerSeasons).where(eq(schema.extPlayerSeasons.externalPlayerId, "8478402"));
    const junior = rows.find((r) => r.league === "GTHL");
    expect(junior?.toiPerGameSeconds).toBeNull();
    expect(junior?.toiSeconds).toBeNull();
    expect(junior?.plusMinus).toBeNull();
    const nhl = rows.find((r) => r.league === "NHL" && r.season === "2025-26" && r.gameType === "regular");
    expect(nhl).toMatchObject({ toiPerGameSeconds: 1379, points: 138, source: "nhl_career" });
  });

  it("roster imports fill bios without erasing draft details from a landing import", async () => {
    const bioImport = await run({ dataset: "nhl_players", playerIds: ["8478402"] });
    await commitImport({ importId: bioImport.importId, organizationId: fx.orgId, userId: fx.userId });
    const roster = await run({ dataset: "nhl_roster", team: "CHI", season: "2024-25" });
    await commitImport({ importId: roster.importId, organizationId: fx.orgId, userId: fx.userId });
    const players = await db.select().from(schema.extPlayers).where(eq(schema.extPlayers.organizationId, fx.orgId));
    expect(players).toHaveLength(25); // McDavid + 24 Blackhawks
    const mcdavid = players.find((p) => p.externalId === "8478402");
    expect(mcdavid).toMatchObject({ draftOverall: 1, draftYear: 2015, isActive: true, currentTeamAbbrev: "EDM" });
    const bedard = players.find((p) => p.externalId === "8484144");
    expect(bedard).toMatchObject({ fullName: "Connor Bedard", draftYear: null, heightCm: 178 });
    const entries = await db.select().from(schema.extRosterEntries).where(eq(schema.extRosterEntries.teamAbbrev, "CHI"));
    expect(entries).toHaveLength(24);
    expect(entries.every((e) => e.season === "2024-25")).toBe(true);
  });

  it("roster ALL: one request per club, every club's players in one preview", async () => {
    const chi = manifest.find((m) => m.url.includes("/roster/CHI/20242025"))!;
    const body = fs.readFileSync(path.join(FIX, chi.file), "utf8");
    const calls: string[] = [];
    const impl: FetchImpl = async (url) => {
      calls.push(url);
      return { status: 200, headers: { get: () => "application/json" }, text: async () => body };
    };
    const res = await run({ dataset: "nhl_roster", team: "ALL", season: "2024-25" }, { impl, calls }, fx.orgId, { bypassCache: true });
    expect(calls).toHaveLength(32);
    expect(new Set(calls.map((u) => u.split("/roster/")[1]!.slice(0, 3))).size).toBe(32);
    expect(res).toMatchObject({ validCount: 32 * 24, errorCount: 0 });
  });

  it("game logs: two requests per player, NULL goalie fields for skaters, upsert on re-import", async () => {
    const f = fixtureFetch();
    const res = await run({ dataset: "nhl_game_logs", playerIds: ["8478402", "8476945"], season: "2024-25", gameType: "regular" }, f);
    expect(res.validCount).toBe(67 + 63);
    expect(f.calls.filter((u) => u.includes("/game-log/"))).toHaveLength(2);
    const detail = await getImportDetail(res.importId, fx.orgId);
    expect(detail.sourceMeta?.urls).toHaveLength(4);
    expect(detail.sourceMeta?.warnings.some((w) => w.includes("relief appearance"))).toBe(true);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const logs = await db.select().from(schema.extPlayerGameLogs).where(eq(schema.extPlayerGameLogs.organizationId, fx.orgId));
    expect(logs).toHaveLength(130);
    const mcdavid = logs.filter((l) => l.externalPlayerId === "8478402");
    expect(mcdavid.every((l) => l.shotsAgainst === null && l.decision === null && l.toiSeconds !== null)).toBe(true);
    const relief = logs.find((l) => l.externalPlayerId === "8476945" && l.gamesStarted === 0);
    expect(relief).toMatchObject({ decision: null, toiSeconds: 610, points: null });
    const again = await run({ dataset: "nhl_game_logs", playerIds: ["8478402", "8476945"], season: "2024-25", gameType: "regular" });
    expect((await getImportDetail(again.importId, fx.orgId)).existingCount).toBe(130);
    await commitImport({ importId: again.importId, organizationId: fx.orgId, userId: fx.userId });
    expect(await db.select().from(schema.extPlayerGameLogs)).toHaveLength(130);
  });

  it("MoneyPuck import credits MoneyPuck and keeps metrics under source names", async () => {
    const res = await run({ dataset: "moneypuck_skaters", season: "2024-25", gameType: "regular", situations: ["all", "5on5"] });
    expect(res.validCount).toBe(16);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const [source] = await db.select().from(schema.dataSources).where(eq(schema.dataSources.importId, res.importId));
    expect(source).toMatchObject({ credit: "Data: MoneyPuck.com", effectiveSeason: "2024-25", sourceKey: "moneypuck" });
    expect(source!.termsNote).toMatch(/non-commercial/);
    const rows = await db.select().from(schema.extPlayerSeasons).where(eq(schema.extPlayerSeasons.source, "moneypuck"));
    const bunting = rows.find((r) => r.externalPlayerId === "8478047" && r.situation === "all");
    expect(bunting).toMatchObject({ toiSeconds: 70819, goals: 19, points: 38, xGoals: 25.19, plusMinus: null });
    expect(bunting!.metrics).toMatchObject({ primary_assists: 12, secondary_assists: 7 });
  });

  it("team stats join tri-codes from a second recorded request", async () => {
    const f = fixtureFetch();
    const res = await run({ dataset: "nhl_team_stats", season: "2024-25", gameType: "regular" }, f);
    expect(f.calls).toHaveLength(2);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const [source] = await db.select().from(schema.dataSources).where(eq(schema.dataSources.importId, res.importId));
    expect(source!.url!.split("\n")).toHaveLength(2);
    const vgk = await db.select().from(schema.extTeamSeasons).where(eq(schema.extTeamSeasons.teamAbbrev, "VGK"));
    expect(vgk[0]).toMatchObject({ points: 110, season: "2024-25", source: "nhl_stats" });
  });

  it("standings replace the team's previous row and keep division, streak and records", async () => {
    const f = fixtureFetch();
    const res = await run({ dataset: "nhl_standings", date: "2026-04-17" }, f);
    expect(f.calls).toEqual(["https://api-web.nhle.com/v1/standings/2026-04-17"]);
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const t = schema.extTeamStandings;
    const rows = await db.select().from(t).where(eq(t.organizationId, fx.orgId));
    expect(rows).toHaveLength(32);
    const col = rows.find((r) => r.teamAbbrev === "COL")!;
    expect(col).toMatchObject({
      season: "2025-26",
      gameType: "regular",
      standingsDate: "2026-04-17",
      conference: "Western",
      division: "Central",
      gamesPlayed: 82,
      wins: 55,
      losses: 16,
      otLosses: 11,
      points: 121,
      leagueRank: 1,
      clinch: "p",
      streak: "W3",
      lastTen: "7-2-1",
      homeRecord: "26-9-6",
      roadRecord: "29-7-5",
    });
    expect(col.metrics).toEqual({ shootout_wins: 4, shootout_losses: 6 });
    // Every team's division rank 1..n and league ranks 1..32 are present.
    expect(new Set(rows.map((r) => r.leagueRank))).toEqual(new Set(Array.from({ length: 32 }, (_, i) => i + 1)));
    // A second import of the same standings updates in place (no duplicates).
    const again = await run({ dataset: "nhl_standings", date: "2026-04-17" }, fixtureFetch(), fx.orgId, { bypassCache: true });
    await commitImport({ importId: again.importId, organizationId: fx.orgId, userId: fx.userId });
    expect(await db.select().from(t).where(eq(t.organizationId, fx.orgId))).toHaveLength(32);
  });

  it("HockeyTech skater stats: looks up the season id, then imports every line under a league-prefixed id", async () => {
    const f = fixtureFetch();
    const res = await run({ dataset: "hockeytech_skater_stats", league: "ohl", season: "2025-26" }, f);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toContain("season=83");
    await commitImport({ importId: res.importId, organizationId: fx.orgId, userId: fx.userId });
    const s = schema.extPlayerSeasons;
    const rows = await db.select().from(s).where(and(eq(s.organizationId, fx.orgId), eq(s.source, "hockeytech")));
    expect(rows).toHaveLength(4);
    const k = rows.find((r) => r.externalPlayerId === "ohl:9385")!;
    expect(k).toMatchObject({ league: "OHL", season: "2025-26", gameType: "regular", teamName: "SAG", position: "RW", goals: 37, points: 97, powerPlayPoints: 38, shots: 240 });
    expect(k.metrics).toMatchObject({ es_points: 97 - 38 - 3 });
  });

  it("HockeyTech: a season the league does not have is refused with a clear message", async () => {
    await expect(run({ dataset: "hockeytech_skater_stats", league: "ohl", season: "1990-91" })).rejects.toThrow(/No 1990-91 regular season/);
  });

  it("rejects an invalid standings date before touching the network", async () => {
    const f = fixtureFetch();
    await expect(run({ dataset: "nhl_standings", date: "2026-4-17" }, f)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it("EliteProspects stays disabled until configured and surfaces real API errors", async () => {
    await expect(run({ dataset: "ep_players", query: "Celebrini" })).rejects.toThrow(/Disabled until configured/);
    const f = fixtureFetch();
    await expect(run({ dataset: "ep_players", query: "Celebrini" }, f, fx.orgId, { env: { EP_API_KEY: "bad-key" } })).rejects.toThrow(
      /Api Key didnt meet the requirements/,
    );
    expect(f.calls[0]).toContain("apiKey=bad-key");
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "connector.fetch_failed"));
    expect(JSON.stringify(audits)).not.toContain("bad-key");
    expect(JSON.stringify(audits)).toContain("apiKey=REDACTED");
  });

  it("rejects bad requests before touching the network", async () => {
    const f = fixtureFetch();
    await expect(run({ dataset: "nhl_roster", team: "CHI", season: "2024-26" }, f)).rejects.toThrow();
    await expect(run({ dataset: "nhl_players", playerIds: ["123"] }, f)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it("maps upstream HTTP failures to a readable ConnectorError", async () => {
    const f = fixtureFetch();
    await expect(run({ dataset: "nhl_draft_picks", year: 1999, round: 3 }, f)).rejects.toThrow(ConnectorError);
  });
});
