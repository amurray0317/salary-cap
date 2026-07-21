/**
 * CSV import pipeline tests: parser, mapping/validation, error storage,
 * approval gating, and committed records — on in-memory PGlite via
 * setDbForTesting with real migrations.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { parseCsv, CsvParseError } from "@/lib/import/csvParse";
import { autoMapHeaders, buildTemplateCsv } from "@/lib/import/definitions";
import { toCsv } from "@/lib/csv";
import {
  commitImport,
  createImport,
  ImportError,
  rejectImport,
  validateImport,
} from "@/server/services/importService";

/* ------------------------------------------------------------------ */
/* Parser unit tests                                                   */
/* ------------------------------------------------------------------ */

describe("parseCsv", () => {
  it("parses headers, rows, quoted fields, and CRLF", () => {
    const { headers, rows } = parseCsv('name,note\r\n"Smith, John","He said ""hi"""\r\nJane,plain\r\n');
    expect(headers).toEqual(["name", "note"]);
    expect(rows).toEqual([
      ["Smith, John", 'He said "hi"'],
      ["Jane", "plain"],
    ]);
  });

  it("pads short rows and truncates long rows to header width", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n1,2,3,4\n");
    expect(rows).toEqual([
      ["1", "2", ""],
      ["1", "2", "3"],
    ]);
  });

  it("skips blank lines and rejects empty/unterminated input", () => {
    expect(parseCsv("a,b\n\n1,2\n\n").rows).toHaveLength(1);
    expect(() => parseCsv("")).toThrow(CsvParseError);
    expect(() => parseCsv('a,b\n"unterminated')).toThrow(CsvParseError);
    expect(() => parseCsv("a\n1\n2\n3\n", { maxRows: 2 })).toThrow(/maximum/);
  });

  it("round-trips with the serializer", () => {
    const csv = toCsv(["x", "y"], [["a,comma", 'q"uote'], ["plain", ""]]);
    const parsed = parseCsv(csv);
    expect(parsed.rows).toEqual([
      ["a,comma", 'q"uote'],
      ["plain", ""],
    ]);
  });
});

describe("templates and auto-mapping", () => {
  it("templates parse cleanly and auto-map onto their own headers", () => {
    for (const type of [
      "players",
      "contracts",
      "ncaa_conferences",
      "ncaa_schools",
      "ncaa_players",
      "ncaa_season_stats",
      "ncaa_game_logs",
      "ncaa_draft_status",
    ] as const) {
      const t = buildTemplateCsv(type);
      const csv = toCsv(t.headers, t.rows);
      const parsed = parseCsv(csv);
      const mapping = autoMapHeaders(type, parsed.headers);
      for (const header of t.headers) {
        expect(mapping[header]).toBe(header);
      }
    }
  });

  it("auto-maps case- and punctuation-insensitively", () => {
    const mapping = autoMapHeaders("players", ["Full Name", "POSITION", "Date-Of-Birth"]);
    expect(mapping["full_name"]).toBe("Full Name");
    expect(mapping["position"]).toBe("POSITION");
    expect(mapping["date_of_birth"]).toBe("Date-Of-Birth");
  });
});

/* ------------------------------------------------------------------ */
/* Pipeline integration tests                                          */
/* ------------------------------------------------------------------ */

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  otherOrgId: string;
  userId: string;
  teamId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);

  const [user] = await db.insert(schema.users).values({ email: "i@t.test", fullName: "I" }).returning();
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-i" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-i" }).returning();
  const [league] = await db.insert(schema.leagues).values({ name: "L", abbreviation: "L" }).returning();
  for (const [i, name] of ["2025-26", "2026-27"].entries()) {
    await db.insert(schema.leagueSeasons).values({
      leagueId: league!.id,
      name,
      startDate: `${2025 + i}-10-01`,
      endDate: `${2026 + i}-06-01`,
      sortOrder: i,
    });
  }
  const [team] = await db
    .insert(schema.teams)
    .values({ organizationId: org!.id, leagueId: league!.id, name: "Team", abbreviation: "TST" })
    .returning();
  Object.assign(fx, { orgId: org!.id, otherOrgId: otherOrg!.id, userId: user!.id, teamId: team!.id });
});

afterAll(async () => {
  await pg.close();
});

const PLAYERS_CSV = [
  "full_name,position,date_of_birth,team_abbreviation",
  "Import Alpha,C,1999-01-15,TST",
  "Import Bravo,ZZ,2000-05-05,TST", // bad position
  "Import Charlie,D,not-a-date,", // bad DOB
  "Import Alpha,LW,,TST", // duplicate of row 1
  "Import Delta,G,,NOPE", // unknown team
  "Import Echo,RW,,", // valid, no team
].join("\n");

describe("players import pipeline", () => {
  it("upload → map → validate stores row-level errors; approve commits only valid rows", async () => {
    const { importId, headers, autoMapping } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "players",
      fileName: "players.csv",
      csvText: PLAYERS_CSV,
    });
    expect(headers).toContain("full_name");

    const { validCount, errorCount } = await validateImport({
      importId,
      organizationId: fx.orgId,
      userId: fx.userId,
      mapping: autoMapping,
    });
    expect(validCount).toBe(2); // Alpha (row 1) and Echo (row 6)
    expect(errorCount).toBeGreaterThanOrEqual(4);

    const storedErrors = await db.select().from(schema.importErrors).where(eq(schema.importErrors.importId, importId));
    const byRow = new Map(storedErrors.map((e) => [e.rowNumber, e]));
    expect(byRow.get(2)?.columnName).toBe("position");
    expect(byRow.get(3)?.columnName).toBe("date_of_birth");
    expect(byRow.get(4)?.message).toContain("Duplicate of row 1");
    expect(byRow.get(5)?.message).toContain('No team "NOPE"');

    // Nothing committed before approval.
    const before = await db.select().from(schema.players).where(eq(schema.players.organizationId, fx.orgId));
    expect(before).toHaveLength(0);

    const { committedCount, skippedCount } = await commitImport({
      importId,
      organizationId: fx.orgId,
      userId: fx.userId,
    });
    expect(committedCount).toBe(2);
    expect(skippedCount).toBe(4);

    const players = await db.select().from(schema.players).where(eq(schema.players.organizationId, fx.orgId));
    expect(players.map((p) => p.fullName).sort()).toEqual(["Import Alpha", "Import Echo"]);
    const alpha = players.find((p) => p.fullName === "Import Alpha");
    expect(alpha?.currentTeamId).toBe(fx.teamId);
    const echo = players.find((p) => p.fullName === "Import Echo");
    expect(echo?.currentTeamId).toBeNull();
    expect(echo?.rosterStatus).toBe("non_roster");

    // Cannot commit twice.
    await expect(commitImport({ importId, organizationId: fx.orgId, userId: fx.userId })).rejects.toThrow(ImportError);

    const [row] = await db.select().from(schema.imports).where(eq(schema.imports.id, importId));
    expect(row?.status).toBe("committed");
    expect(row?.committedCount).toBe(2);

    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.entityId, importId), eq(schema.auditLogs.action, "import.commit")));
    expect(audit).toHaveLength(1);
  });

  it("supports custom column names via explicit mapping", async () => {
    const csv = "Name,Pos\nMapped Player,C\n";
    const { importId } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "players",
      fileName: "custom.csv",
      csvText: csv,
    });
    const { validCount } = await validateImport({
      importId,
      organizationId: fx.orgId,
      userId: fx.userId,
      mapping: { full_name: "Name", position: "Pos" },
    });
    expect(validCount).toBe(1);
    await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId });
    const found = await db.select().from(schema.players).where(eq(schema.players.fullName, "Mapped Player"));
    expect(found).toHaveLength(1);
  });

  it("rejects validation when a required field is unmapped", async () => {
    const { importId } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "players",
      fileName: "x.csv",
      csvText: "a,b\n1,2\n",
    });
    await expect(
      validateImport({ importId, organizationId: fx.orgId, userId: fx.userId, mapping: {} }),
    ).rejects.toThrow(/not mapped/);
  });
});

describe("contracts import pipeline", () => {
  it("groups rows per player into one multi-season contract", async () => {
    const csv = [
      "player_name,team_abbreviation,season_name,cap_hit,base_salary,performance_bonus,contract_type",
      "Import Echo,TST,2025-26,2000000,1900000,0,one_way",
      "Import Echo,TST,2026-27,2000000,2100000,0,one_way",
    ].join("\n");
    const { importId, autoMapping } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "contracts",
      fileName: "contracts.csv",
      csvText: csv,
    });
    const { validCount, errorCount } = await validateImport({
      importId,
      organizationId: fx.orgId,
      userId: fx.userId,
      mapping: autoMapping,
    });
    expect(errorCount).toBe(0);
    expect(validCount).toBe(2);
    const { committedCount } = await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId });
    expect(committedCount).toBe(2);

    const [player] = await db.select().from(schema.players).where(eq(schema.players.fullName, "Import Echo"));
    const contracts = await db.select().from(schema.contracts).where(eq(schema.contracts.playerId, player!.id));
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.averageAnnualValue).toBe(2_000_000);
    expect(contracts[0]?.totalValue).toBe(4_000_000);
    const seasons = await db
      .select()
      .from(schema.contractSeasons)
      .where(eq(schema.contractSeasons.contractId, contracts[0]!.id));
    expect(seasons).toHaveLength(2);
    expect(player?.freeAgentStatus).toBe("under_contract");
    expect(player?.currentTeamId).toBe(fx.teamId);
  });

  it("skips a whole contract group when one of its rows is invalid", async () => {
    const csv = [
      "player_name,team_abbreviation,season_name,cap_hit",
      "Mapped Player,TST,2025-26,3000000",
      "Mapped Player,TST,2099-00,3000000", // unknown season → whole group skipped
      "Ghost Player,TST,2025-26,1000000", // unknown player
    ].join("\n");
    const { importId, autoMapping } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "contracts",
      fileName: "bad-group.csv",
      csvText: csv,
    });
    const { validCount } = await validateImport({
      importId,
      organizationId: fx.orgId,
      userId: fx.userId,
      mapping: autoMapping,
    });
    expect(validCount).toBe(0); // row 1 dragged down by its group; rows 2-3 invalid
    const errors = await db.select().from(schema.importErrors).where(eq(schema.importErrors.importId, importId));
    expect(errors.some((e) => e.message.includes("contract group"))).toBe(true);
    const { committedCount } = await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId }).catch(() => ({ committedCount: -1 }));
    // Zero valid rows: commit succeeds as a no-op OR is refused — either way no contract exists.
    expect(committedCount === 0 || committedCount === -1).toBe(true);
    const [player] = await db.select().from(schema.players).where(eq(schema.players.fullName, "Mapped Player"));
    const contracts = await db.select().from(schema.contracts).where(eq(schema.contracts.playerId, player!.id));
    expect(contracts).toHaveLength(0);
  });
});

describe("scouting import chain (conferences → schools → prospects → game logs → draft status)", () => {
  async function runImport(importType: Parameters<typeof createImport>[0]["importType"], csvText: string) {
    const { importId, autoMapping } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType,
      fileName: `${importType}.csv`,
      csvText,
    });
    const validation = await validateImport({ importId, organizationId: fx.orgId, userId: fx.userId, mapping: autoMapping });
    return { importId, validation };
  }

  it("imports conferences with in-file and existing-record duplicate detection", async () => {
    const csv = [
      "name,abbreviation,level",
      "Chain Test Conference,CTC,division_1",
      "Chain Test Conference,CTC,division_1", // in-file duplicate
      "Chain Second Conference,CSC,not_a_level", // bad level
    ].join("\n");
    const { importId, validation } = await runImport("ncaa_conferences", csv);
    expect(validation.validCount).toBe(1);
    expect(validation.errorCount).toBe(2);
    const { committedCount } = await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId });
    expect(committedCount).toBe(1);

    // Re-importing the same conference is now a duplicate against the DB.
    const again = await runImport("ncaa_conferences", "name\nChain Test Conference\n");
    expect(again.validation.validCount).toBe(0);
    const errors = await db.select().from(schema.importErrors).where(eq(schema.importErrors.importId, again.importId));
    expect(errors.some((e) => e.message.includes("already exists"))).toBe(true);
  });

  it("imports schools requiring an existing conference", async () => {
    const csv = [
      "name,short_name,abbreviation,conference_name,city,state,division",
      "Chain Test University,Chain Test,CTU,Chain Test Conference,Chainville,MN,division_1",
      "Orphan College,,OC,No Such Conference,,,", // unknown conference
    ].join("\n");
    const { importId, validation } = await runImport("ncaa_schools", csv);
    expect(validation.validCount).toBe(1);
    expect(validation.errorCount).toBe(1);
    const { committedCount } = await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId });
    expect(committedCount).toBe(1);

    const [school] = await db.select().from(schema.schools).where(eq(schema.schools.name, "Chain Test University"));
    expect(school?.shortName).toBe("Chain Test");
    expect(school?.state).toBe("MN");
    const [conf] = await db.select().from(schema.conferences).where(eq(schema.conferences.name, "Chain Test Conference"));
    expect(school?.conferenceId).toBe(conf!.id);
  });

  it("imports prospects, then game logs with per-game duplicate detection", async () => {
    const prospects = [
      "full_name,position,school_name,class_year",
      "Chain Prospect,C,Chain Test University,sophomore",
    ].join("\n");
    const p = await runImport("ncaa_players", prospects);
    expect(p.validation.validCount).toBe(1);
    await commitImport({ importId: p.importId, organizationId: fx.orgId, userId: fx.userId });

    const logs = [
      "player_name,season_name,game_date,opponent,home_away,goals,assists,shots,pp_points,time_on_ice_seconds",
      "Chain Prospect,2025-26,2025-11-08,Rival College,H,1,2,5,1,",
      "Chain Prospect,2025-26,2025-11-08,Rival College,H,1,2,5,1,", // duplicate game
      "Ghost Prospect,2025-26,2025-11-09,Rival College,A,0,0,1,0,", // unknown prospect
      "Chain Prospect,2025-26,2025-11-15,Other College,X,0,1,2,0,", // bad home_away
    ].join("\n");
    const g = await runImport("ncaa_game_logs", logs);
    expect(g.validation.validCount).toBe(1);
    expect(g.validation.errorCount).toBe(3);

    // Preview stage: nothing committed yet.
    const [prospect] = await db.select().from(schema.amateurProspects).where(eq(schema.amateurProspects.fullName, "Chain Prospect"));
    const before = await db.select().from(schema.prospectGameLogs).where(eq(schema.prospectGameLogs.prospectId, prospect!.id));
    expect(before).toHaveLength(0);

    const { committedCount } = await commitImport({ importId: g.importId, organizationId: fx.orgId, userId: fx.userId });
    expect(committedCount).toBe(1);
    const after = await db.select().from(schema.prospectGameLogs).where(eq(schema.prospectGameLogs.prospectId, prospect!.id));
    expect(after).toHaveLength(1);
    expect(after[0]?.homeAway).toBe("H");
    expect(after[0]?.powerPlayPoints).toBe(1);
    expect(after[0]?.timeOnIceSeconds).toBeNull(); // blank TOI stays null — never fabricated
  });

  it("updates draft status with cross-field rules (drafted needs year; undrafted stays blank)", async () => {
    const csv = [
      "player_name,nhl_draft_status,nhl_rights_holder,draft_year,draft_round,draft_overall,college_free_agent_status",
      "Chain Prospect,drafted,Aurora Wolfpack,2024,3,78,not_eligible",
      "Chain Prospect,drafted,,2024,3,78,", // duplicate row for same prospect
      "Ghost Prospect,undrafted,,,,,", // unknown prospect
    ].join("\n");
    const { importId, validation } = await runImport("ncaa_draft_status", csv);
    expect(validation.validCount).toBe(1);
    expect(validation.errorCount).toBe(2);
    await commitImport({ importId, organizationId: fx.orgId, userId: fx.userId });

    const [prospect] = await db.select().from(schema.amateurProspects).where(eq(schema.amateurProspects.fullName, "Chain Prospect"));
    expect(prospect?.nhlDraftStatus).toBe("drafted");
    expect(prospect?.nhlRightsHolder).toBe("Aurora Wolfpack");
    expect(prospect?.draftYear).toBe(2024);
    expect(prospect?.draftRound).toBe(3);
    expect(prospect?.draftOverall).toBe(78);

    // drafted without draft_year is a row error
    const bad = await runImport("ncaa_draft_status", "player_name,nhl_draft_status\nChain Prospect,drafted\n");
    expect(bad.validation.validCount).toBe(0);
    const errors = await db.select().from(schema.importErrors).where(eq(schema.importErrors.importId, bad.importId));
    expect(errors.some((e) => e.message.includes("Draft year is required"))).toBe(true);

    // undrafted with round populated is a row error
    const bad2 = await runImport(
      "ncaa_draft_status",
      "player_name,nhl_draft_status,draft_round\nChain Prospect,undrafted,2\n",
    );
    expect(bad2.validation.validCount).toBe(0);
  });
});

describe("import guards", () => {
  it("enforces organization isolation", async () => {
    const { importId } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "players",
      fileName: "iso.csv",
      csvText: "full_name,position\nIso Player,C\n",
    });
    await expect(
      validateImport({ importId, organizationId: fx.otherOrgId, userId: fx.userId, mapping: {} }),
    ).rejects.toThrow(/not found/);
    await expect(
      commitImport({ importId, organizationId: fx.otherOrgId, userId: fx.userId }),
    ).rejects.toThrow(/not found/);
  });

  it("reject discards without committing and blocks later commits", async () => {
    const { importId, autoMapping } = await createImport({
      organizationId: fx.orgId,
      userId: fx.userId,
      importType: "players",
      fileName: "rej.csv",
      csvText: "full_name,position\nRejected Player,C\n",
    });
    await validateImport({ importId, organizationId: fx.orgId, userId: fx.userId, mapping: autoMapping });
    await rejectImport({ importId, organizationId: fx.orgId, userId: fx.userId });
    await expect(commitImport({ importId, organizationId: fx.orgId, userId: fx.userId })).rejects.toThrow(
      /awaiting approval/,
    );
    const found = await db.select().from(schema.players).where(eq(schema.players.fullName, "Rejected Player"));
    expect(found).toHaveLength(0);
  });

  it("rejects empty and oversized files", async () => {
    await expect(
      createImport({ organizationId: fx.orgId, userId: fx.userId, importType: "players", fileName: "e.csv", csvText: "full_name,position\n" }),
    ).rejects.toThrow(/no data rows/);
    await expect(
      createImport({ organizationId: fx.orgId, userId: fx.userId, importType: "players", fileName: "big.csv", csvText: "a".repeat(1_100_000) }),
    ).rejects.toThrow(/1 MB/);
  });
});
