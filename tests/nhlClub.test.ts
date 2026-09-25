/**
 * Setting an organization up as a real NHL club (PGlite, real migrations,
 * recorded NHL roster response; no network).
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import type { FetchImpl } from "@/lib/connectors/http";
import { NhlClubError, importNhlClub } from "@/server/services/nhlClubService";

const ROSTER = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/connectors/nhl/roster-CHI-20242025.json"), "utf8");
const NOW = new Date("2026-09-25T12:00:00Z");
const serve = (status: number, body: string): { impl: FetchImpl; urls: string[] } => {
  const urls: string[] = [];
  return { urls, impl: async (url) => (urls.push(url), { status, headers: { get: () => "application/json" }, text: async () => body }) };
};

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { org: string; user: string; demoTeam: string };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  const [u] = await db.insert(schema.users).values({ email: "gm@club.test", fullName: "GM" }).returning();
  const [o] = await db.insert(schema.organizations).values({ name: "Club", slug: "club-nhl" }).returning();
  const [lg] = await db.insert(schema.leagues).values({ name: "Demo League", abbreviation: "DEMO" }).returning();
  const [t] = await db
    .insert(schema.teams)
    .values({ organizationId: o!.id, leagueId: lg!.id, name: "Aurora Wolfpack", abbreviation: "AUR" })
    .returning();
  fx.user = u!.id;
  fx.org = o!.id;
  fx.demoTeam = t!.id;
});

afterAll(async () => {
  await pg.close();
});

describe("NHL club set-up", () => {
  it("creates the club under the NHL's published cap figures, with the roster and no invented contract facts", async () => {
    const f = serve(200, ROSTER);
    const r = await importNhlClub({ organizationId: fx.org, actorId: fx.user, team: "chi", now: NOW, hideOtherTeams: true }, { fetchImpl: f.impl });
    expect(f.urls).toEqual(["https://api-web.nhle.com/v1/roster/CHI/20262027"]);
    expect(r).toMatchObject({ teamName: "Chicago Blackhawks", season: "2026-27", added: 24, updated: 0, onRoster: 24 });

    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, r.teamId));
    const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, team!.leagueId));
    expect(league).toMatchObject({ name: "National Hockey League", abbreviation: "NHL" });
    const seasons = await db.select().from(schema.leagueSeasons).where(eq(schema.leagueSeasons.leagueId, league!.id));
    expect(seasons.map((s) => s.name).sort()).toEqual(["2025-26", "2026-27", "2027-28"]);
    const s2627 = seasons.find((s) => s.name === "2026-27")!;
    const rules = await db.select().from(schema.leagueRules).where(eq(schema.leagueRules.seasonId, s2627.id));
    const rule = (k: string) => rules.find((x) => x.ruleKey === k)?.numericValue;
    expect([rule("cap.upper_limit"), rule("cap.lower_limit"), rule("salary.min"), rule("cap.buried_allowance")]).toEqual([
      104_000_000, 76_900_000, 850_000, 375_000,
    ]);

    const players = await db.select().from(schema.players).where(eq(schema.players.organizationId, fx.org));
    expect(players).toHaveLength(24);
    const bedard = players.find((p) => p.nhlPlayerId === "8484144")!;
    expect(bedard).toMatchObject({
      fullName: "Connor Bedard",
      position: "C",
      freeAgentStatus: "unknown",
      waiverStatus: "unknown",
      provenance: "official",
      currentTeamId: r.teamId,
    });
    const contracts = await db.select().from(schema.contracts).where(eq(schema.contracts.playerId, bedard.id));
    expect(contracts).toHaveLength(0);

    const [roster] = await db
      .select()
      .from(schema.rosters)
      .where(and(eq(schema.rosters.teamId, r.teamId), eq(schema.rosters.seasonId, s2627.id)));
    expect(await db.select().from(schema.rosterMemberships).where(eq(schema.rosterMemberships.rosterId, roster!.id))).toHaveLength(24);

    const [demo] = await db.select().from(schema.teams).where(eq(schema.teams.id, fx.demoTeam));
    expect(demo!.isActive).toBe(false);
  });

  it("re-running refreshes without duplicates, and reuses the league", async () => {
    const r = await importNhlClub({ organizationId: fx.org, actorId: fx.user, team: "CHI", now: NOW }, { fetchImpl: serve(200, ROSTER).impl });
    expect(r).toMatchObject({ added: 0, updated: 24, onRoster: 24 });
    expect(await db.select().from(schema.players).where(eq(schema.players.organizationId, fx.org))).toHaveLength(24);
    expect(await db.select().from(schema.leagues).where(eq(schema.leagues.abbreviation, "NHL"))).toHaveLength(1);
  });

  it("refuses unknown clubs and explains an unpublished roster", async () => {
    await expect(
      importNhlClub({ organizationId: fx.org, actorId: fx.user, team: "AUR", now: NOW }, { fetchImpl: serve(200, ROSTER).impl }),
    ).rejects.toThrow(NhlClubError);
    await expect(
      importNhlClub({ organizationId: fx.org, actorId: fx.user, team: "SEA", now: NOW }, { fetchImpl: serve(404, "{}").impl }),
    ).rejects.toThrow("has not published a 2026-27 roster for SEA");
  });
});
