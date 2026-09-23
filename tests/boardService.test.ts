/**
 * Acquisition-board tests: consensus math (pure), draft-board lifecycle
 * (add/remove/reorder/position ranks/director rank/locking/versioning/
 * snapshots), scout rankings + disagreement, CFA boards (fields, status
 * history, follow-ups), permissions, and organization isolation — on
 * in-memory PGlite via setDbForTesting with real migrations.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { computeConsensus } from "@/lib/scouting/consensus";
import {
  addCfaEntry,
  addProspectToBoard,
  createCfaBoard,
  createDraftBoard,
  getBoardDetail,
  getBoardSnapshot,
  getCfaBoardDetail,
  getFollowUps,
  recordBoardExport,
  removeProspectFromBoard,
  reorderBoard,
  reorderCfaPriorities,
  setBoardStatus,
  setDirectorRank,
  submitScoutRanking,
  updateBoardEntry,
  updateCfaEntry,
} from "@/server/services/boardService";
import { ScoutingError } from "@/server/services/scoutingService";
import { roleHasCapability } from "@/lib/auth/roles";

/* ------------------------------------------------------------------ */
/* Consensus (pure)                                                    */
/* ------------------------------------------------------------------ */

describe("computeConsensus", () => {
  it("reports mean, median, best, worst, spread, and stddev transparently", () => {
    const c = computeConsensus([2, 4, 6, 12])!;
    expect(c.submissions).toBe(4);
    expect(c.meanRank).toBe(6);
    expect(c.medianRank).toBe(5);
    expect(c.bestRank).toBe(2);
    expect(c.worstRank).toBe(12);
    expect(c.spread).toBe(10);
    expect(c.stddev).toBeCloseTo(3.74, 1);
    expect(c.insufficient).toBe(false);
    expect(c.warnings.join(" ")).toMatch(/disagree by 10 spots/);
  });

  it("flags insufficient submissions instead of hiding them", () => {
    const one = computeConsensus([3])!;
    expect(one.insufficient).toBe(true);
    expect(one.warnings.join(" ")).toMatch(/Only 1 scout ranking/);
    expect(computeConsensus([])).toBeNull();
    const two = computeConsensus([5, 5])!;
    expect(two.insufficient).toBe(true);
    expect(two.spread).toBe(0);
    expect(two.stddev).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Integration fixture                                                 */
/* ------------------------------------------------------------------ */

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

interface Fixture {
  orgId: string;
  otherOrgId: string;
  gmId: string;
  scout2Id: string;
  scout3Id: string;
  outsiderId: string;
  boardId: string;
  prospectIds: string[]; // 4 undrafted (2 D, 1 C, 1 G)
  draftedId: string;
  foreignBoardId: string;
}
const fx = {} as Fixture;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);

  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-b" }).returning();
  const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-b" }).returning();
  const mkUser = async (email: string, orgId: string) => {
    const [u] = await db.insert(schema.users).values({ email, fullName: email.split("@")[0]! }).returning();
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: u!.id, role: "scout" });
    return u!.id;
  };
  const gmId = await mkUser("gm@b.test", org!.id);
  const scout2Id = await mkUser("s2@b.test", org!.id);
  const scout3Id = await mkUser("s3@b.test", org!.id);
  const outsiderId = await mkUser("out@b.test", otherOrg!.id);

  const mkProspect = async (name: string, position: string, group: "F" | "D" | "G", opts?: { drafted?: boolean; org?: string }) => {
    const [p] = await db
      .insert(schema.amateurProspects)
      .values({
        organizationId: opts?.org ?? org!.id,
        fullName: name,
        position,
        positionGroup: group,
        classYear: "senior",
        nhlDraftStatus: opts?.drafted ? "drafted" : "undrafted",
        collegeFreeAgentStatus: "eligible",
        agentName: "Sample Agent",
      })
      .returning();
    return p!.id;
  };

  const prospectIds = [
    await mkProspect("Board D One", "D", "D"),
    await mkProspect("Board D Two", "D", "D"),
    await mkProspect("Board C One", "C", "F"),
    await mkProspect("Board G One", "G", "G"),
  ];
  const draftedId = await mkProspect("Drafted Guy", "C", "F", { drafted: true });

  const board = await createDraftBoard({ organizationId: org!.id, userId: gmId, name: "Test Board", draftYear: 2027 });
  const foreignBoard = await createDraftBoard({ organizationId: otherOrg!.id, userId: outsiderId, name: "Foreign Board", draftYear: 2027 });

  Object.assign(fx, {
    orgId: org!.id,
    otherOrgId: otherOrg!.id,
    gmId,
    scout2Id,
    scout3Id,
    outsiderId,
    boardId: board.id,
    prospectIds,
    draftedId,
    foreignBoardId: foreignBoard.id,
  });
});

afterAll(async () => {
  await pg.close();
});

/* ------------------------------------------------------------------ */
/* Draft-board lifecycle                                               */
/* ------------------------------------------------------------------ */

describe("draft board lifecycle", () => {
  it("creates a board at version 1 with an empty snapshot", async () => {
    const { board, versions } = await getBoardDetail(fx.boardId, fx.orgId);
    expect(board.version).toBe(1);
    expect(board.status).toBe("active");
    expect(versions).toHaveLength(1);
    const snap = await getBoardSnapshot(fx.boardId, fx.orgId, 1);
    expect(snap.snapshot).toEqual([]);
  });

  it("adds prospects with sequential ranks and per-group position ranks", async () => {
    for (const id of fx.prospectIds) {
      await addProspectToBoard({ boardId: fx.boardId, prospectId: id, organizationId: fx.orgId, userId: fx.gmId });
    }
    const { entries } = await getBoardDetail(fx.boardId, fx.orgId);
    expect(entries.map((r) => r.e.overallRank)).toEqual([1, 2, 3, 4]);
    expect(entries.map((r) => r.e.positionRank)).toEqual([1, 2, 1, 1]); // D1, D2, F1, G1
    await expect(
      addProspectToBoard({ boardId: fx.boardId, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId }),
    ).rejects.toThrow(/already on this board/);
  });

  it("reorders via the full drag order, persists, and records rank history", async () => {
    const [a, b, c, d] = fx.prospectIds as [string, string, string, string];
    await reorderBoard({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, orderedProspectIds: [b, a, c, d], reason: "Test swap" });
    const { entries, board } = await getBoardDetail(fx.boardId, fx.orgId);
    expect(entries.map((r) => r.p.id)).toEqual([b, a, c, d]);
    expect(entries[0]!.e.positionRank).toBe(1); // position ranks follow the new order
    expect(entries[1]!.e.positionRank).toBe(2);
    const history = await db
      .select()
      .from(schema.draftBoardRankHistory)
      .where(and(eq(schema.draftBoardRankHistory.boardId, fx.boardId), eq(schema.draftBoardRankHistory.field, "overall_rank")));
    expect(history).toHaveLength(2);
    const moved = history.find((h) => h.prospectId === b)!;
    expect(moved.previousRank).toBe(2);
    expect(moved.newRank).toBe(1);
    expect(moved.reason).toBe("Test swap");
    expect(moved.userId).toBe(fx.gmId);
    expect(moved.boardVersion).toBe(board.version);
    // Partial or duplicated orders are rejected; an unchanged order creates no version.
    await expect(reorderBoard({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, orderedProspectIds: [a, b] })).rejects.toThrow(/exactly once/);
    await expect(reorderBoard({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, orderedProspectIds: [a, a, c, d] })).rejects.toThrow(/exactly once/);
    await reorderBoard({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, orderedProspectIds: [b, a, c, d] });
    expect((await getBoardDetail(fx.boardId, fx.orgId)).board.version).toBe(board.version);
  });

  it("keeps ranking sources separate: director rank never touches the working order", async () => {
    const target = fx.prospectIds[2]!;
    const before = (await getBoardDetail(fx.boardId, fx.orgId)).entries.find((r) => r.p.id === target)!.e;
    await setDirectorRank({ boardId: fx.boardId, prospectId: target, organizationId: fx.orgId, userId: fx.gmId, rank: 1 });
    const after = (await getBoardDetail(fx.boardId, fx.orgId)).entries.find((r) => r.p.id === target)!.e;
    expect(after.directorFinalRank).toBe(1);
    expect(after.overallRank).toBe(before.overallRank);
    expect(after.modelRank).toBe(before.modelRank);
    expect(after.consensusRank).toBe(before.consensusRank);
  });

  it("computes scout consensus with spread and insufficient warnings; resubmission upserts", async () => {
    const target = fx.prospectIds[0]!;
    const consensusRow = async () =>
      (await db.select().from(schema.consensusRankings).where(and(eq(schema.consensusRankings.boardId, fx.boardId), eq(schema.consensusRankings.prospectId, target))))[0];
    await submitScoutRanking({ boardId: fx.boardId, prospectId: target, organizationId: fx.orgId, scoutId: fx.gmId, rank: 1 });
    await submitScoutRanking({ boardId: fx.boardId, prospectId: target, organizationId: fx.orgId, scoutId: fx.scout2Id, rank: 3 });
    expect((await consensusRow())?.insufficient).toBe(true); // 2 < 3
    await submitScoutRanking({ boardId: fx.boardId, prospectId: target, organizationId: fx.orgId, scoutId: fx.scout3Id, rank: 13 });
    const full = (await consensusRow())!;
    expect(full.insufficient).toBe(false);
    expect(full.submissions).toBe(3);
    expect(full.bestRank).toBe(1);
    expect(full.worstRank).toBe(13);
    expect(full.spread).toBe(12); // disagreement preserved, not averaged away
    expect(full.medianRank).toBe(3);
    expect(full.meanRank).toBeCloseTo(5.67, 1);
    // Individual rankings stay intact alongside the consensus.
    const individual = await db.select().from(schema.scoutRankings).where(and(eq(schema.scoutRankings.boardId, fx.boardId), eq(schema.scoutRankings.prospectId, target)));
    expect(individual.map((r) => r.rank).sort((x, y) => x - y)).toEqual([1, 3, 13]);
    await submitScoutRanking({ boardId: fx.boardId, prospectId: target, organizationId: fx.orgId, scoutId: fx.scout3Id, rank: 5 });
    const again = await db.select().from(schema.scoutRankings).where(and(eq(schema.scoutRankings.boardId, fx.boardId), eq(schema.scoutRankings.prospectId, target)));
    expect(again).toHaveLength(3);
    const entry = (await getBoardDetail(fx.boardId, fx.orgId)).entries.find((r) => r.p.id === target)!.e;
    expect(entry.consensusRank).toBeCloseTo(3, 0);
    expect(entry.directorFinalRank).toBeNull(); // consensus never writes the director column
  });

  it("removal closes rank gaps and is versioned in history", async () => {
    const victim = fx.prospectIds[3]!;
    await removeProspectFromBoard({ boardId: fx.boardId, prospectId: victim, organizationId: fx.orgId, userId: fx.gmId });
    const { entries } = await getBoardDetail(fx.boardId, fx.orgId);
    expect(entries.map((r) => r.e.overallRank)).toEqual([1, 2, 3]);
    const removed = await db
      .select()
      .from(schema.draftBoardRankHistory)
      .where(and(eq(schema.draftBoardRankHistory.boardId, fx.boardId), eq(schema.draftBoardRankHistory.field, "removed")));
    expect(removed[0]?.previousRank).toBe(4);
    await addProspectToBoard({ boardId: fx.boardId, prospectId: victim, organizationId: fx.orgId, userId: fx.gmId });
  });

  it("snapshots are immutable per version and can be compared against the current board", async () => {
    const { board, versions } = await getBoardDetail(fx.boardId, fx.orgId);
    expect(board.version).toBeGreaterThan(5);
    expect(versions[0]!.version).toBe(board.version);
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
    const v2 = await getBoardSnapshot(fx.boardId, fx.orgId, 2); // after first add
    expect((v2.snapshot as unknown[]).length).toBe(1);
    const v5 = await getBoardSnapshot(fx.boardId, fx.orgId, 5); // all four added, pre-swap
    const v6 = await getBoardSnapshot(fx.boardId, fx.orgId, 6); // after swap
    const first = (s: typeof v5) => (s.snapshot as Array<{ prospectId: string }>)[0]!.prospectId;
    expect(first(v5)).toBe(fx.prospectIds[0]);
    expect(first(v6)).toBe(fx.prospectIds[1]);
    await expect(getBoardSnapshot(fx.boardId, fx.orgId, 999)).rejects.toThrow(/No snapshot/);
  });

  it("locking freezes rankings and entries; notes stay editable; unlock restores", async () => {
    await setBoardStatus({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, status: "locked" });
    const { entries } = await getBoardDetail(fx.boardId, fx.orgId);
    const order = entries.map((r) => r.p.id);
    const a = order[0]!;
    await expect(reorderBoard({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, orderedProspectIds: [...order].reverse() })).rejects.toThrow(/locked/);
    await expect(addProspectToBoard({ boardId: fx.boardId, prospectId: fx.draftedId, organizationId: fx.orgId, userId: fx.gmId })).rejects.toThrow(/locked/);
    await expect(removeProspectFromBoard({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, userId: fx.gmId })).rejects.toThrow(/locked/);
    await expect(setDirectorRank({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, userId: fx.gmId, rank: 2 })).rejects.toThrow(/locked/);
    await expect(submitScoutRanking({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, scoutId: fx.scout2Id, rank: 2 })).rejects.toThrow(/locked/);
    await expect(updateBoardEntry({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, userId: fx.gmId, fields: { expectedRound: 2 } })).rejects.toThrow(/locked/);
    // Notes are blocked without the explicit allowance, allowed with it.
    await expect(updateBoardEntry({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, userId: fx.gmId, fields: { notes: "x" } })).rejects.toThrow(/locked/);
    await updateBoardEntry({ boardId: fx.boardId, prospectId: a, organizationId: fx.orgId, userId: fx.gmId, fields: { notes: "Locked-board note" }, allowOnLocked: true });
    const after = await getBoardDetail(fx.boardId, fx.orgId);
    expect(after.entries.find((r) => r.p.id === a)!.e.notes).toBe("Locked-board note");
    expect(after.entries.map((r) => r.p.id)).toEqual(order); // order untouched
    const lockRow = await db
      .select()
      .from(schema.draftBoardRankHistory)
      .where(and(eq(schema.draftBoardRankHistory.boardId, fx.boardId), eq(schema.draftBoardRankHistory.field, "status")))
      .orderBy(desc(schema.draftBoardRankHistory.createdAt));
    expect(lockRow[0]?.previousValue).toBe("active");
    expect(lockRow[0]?.newValue).toBe("locked");
    await setBoardStatus({ boardId: fx.boardId, organizationId: fx.orgId, userId: fx.gmId, status: "active" });
    expect((await getBoardDetail(fx.boardId, fx.orgId)).board.status).toBe("active");
  });

  it("archived boards reject every edit including notes", async () => {
    const tmp = await createDraftBoard({ organizationId: fx.orgId, userId: fx.gmId, name: "Tmp", draftYear: 2029 });
    await addProspectToBoard({ boardId: tmp.id, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId });
    await setBoardStatus({ boardId: tmp.id, organizationId: fx.orgId, userId: fx.gmId, status: "archived" });
    await expect(
      updateBoardEntry({ boardId: tmp.id, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId, fields: { notes: "n" }, allowOnLocked: true }),
    ).rejects.toThrow(/archived/);
  });

  it("enforces organization isolation on every board read and write", async () => {
    await expect(getBoardDetail(fx.boardId, fx.otherOrgId)).rejects.toThrow(ScoutingError);
    await expect(getBoardSnapshot(fx.boardId, fx.otherOrgId, 2)).rejects.toThrow(ScoutingError);
    await expect(addProspectToBoard({ boardId: fx.foreignBoardId, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId })).rejects.toThrow(ScoutingError);
    await expect(addProspectToBoard({ boardId: fx.boardId, prospectId: fx.prospectIds[0]!, organizationId: fx.otherOrgId, userId: fx.outsiderId })).rejects.toThrow(ScoutingError);
    await expect(setBoardStatus({ boardId: fx.boardId, organizationId: fx.otherOrgId, userId: fx.outsiderId, status: "locked" })).rejects.toThrow(ScoutingError);
    await expect(submitScoutRanking({ boardId: fx.boardId, prospectId: fx.prospectIds[0]!, organizationId: fx.otherOrgId, scoutId: fx.outsiderId, rank: 1 })).rejects.toThrow(ScoutingError);
  });

  it("records board exports", async () => {
    await recordBoardExport({ organizationId: fx.orgId, boardKind: "draft", boardId: fx.boardId, userId: fx.gmId });
    const rows = await db.select().from(schema.boardExports).where(eq(schema.boardExports.boardId, fx.boardId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exportedBy).toBe(fx.gmId);
  });
});

/* ------------------------------------------------------------------ */
/* College free-agent boards                                           */
/* ------------------------------------------------------------------ */

describe("college free-agent boards", () => {
  let boardId: string;
  let entryId: string;

  it("creates a board and adds undrafted candidates with priorities; drafted rejected", async () => {
    const board = await createCfaBoard({ organizationId: fx.orgId, userId: fx.gmId, name: "CFA Test", description: "d" });
    boardId = board.id;
    await addCfaEntry({ boardId, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId });
    await addCfaEntry({ boardId, prospectId: fx.prospectIds[2]!, organizationId: fx.orgId, userId: fx.gmId });
    await expect(addCfaEntry({ boardId, prospectId: fx.draftedId, organizationId: fx.orgId, userId: fx.gmId })).rejects.toThrow(/undrafted/);
    await expect(addCfaEntry({ boardId, prospectId: fx.prospectIds[0]!, organizationId: fx.orgId, userId: fx.gmId })).rejects.toThrow(/already/);
    const { entries } = await getCfaBoardDetail(boardId, fx.orgId);
    expect(entries.map((r) => r.e.priorityRank)).toEqual([1, 2]);
    expect(entries[0]!.e.agentName).toBe("Sample Agent"); // pulled from the prospect record
    expect(entries[0]!.e.relationshipStatus).toBe("not_contacted");
    entryId = entries[0]!.e.id;
  });

  it("records eligibility/availability/relationship/follow-up fields with field-level history", async () => {
    await updateCfaEntry({
      entryId,
      organizationId: fx.orgId,
      userId: fx.gmId,
      fields: {
        remainingEligibility: "1 season",
        expectedAvailability: "2026-04-01",
        readiness: "ahl_ready",
        relationshipStatus: "initial_contact",
        lastContactDate: "2026-07-01",
        nextAction: "Call agent",
        nextActionDate: "2026-08-01",
        assignedStaffId: fx.scout2Id,
      },
    });
    await updateCfaEntry({ entryId, organizationId: fx.orgId, userId: fx.scout2Id, fields: { relationshipStatus: "active_communication" } });
    const e = (await getCfaBoardDetail(boardId, fx.orgId)).entries.find((r) => r.e.id === entryId)!;
    expect(e.e.relationshipStatus).toBe("active_communication");
    expect(e.e.remainingEligibility).toBe("1 season");
    expect(e.e.expectedAvailability).toBe("2026-04-01");
    expect(e.e.assignedStaffId).toBe(fx.scout2Id);
    expect(e.staffName).toBe("s2");
    const history = await db
      .select()
      .from(schema.collegeFreeAgentStatusHistory)
      .where(eq(schema.collegeFreeAgentStatusHistory.entryId, entryId))
      .orderBy(asc(schema.collegeFreeAgentStatusHistory.createdAt));
    const rel = history.filter((h) => h.field === "relationshipStatus");
    expect(rel).toHaveLength(2);
    expect(rel[1]!.previousValue).toBe("initial_contact");
    expect(rel[1]!.newValue).toBe("active_communication");
    expect(rel[1]!.userId).toBe(fx.scout2Id);
  });

  it("rejects assigning follow-ups to staff outside the organization", async () => {
    await expect(updateCfaEntry({ entryId, organizationId: fx.orgId, userId: fx.gmId, fields: { assignedStaffId: fx.outsiderId } })).rejects.toThrow(/not in this organization/);
  });

  it("surfaces follow-up actions org-wide, ordered by due date", async () => {
    const [second] = (await getCfaBoardDetail(boardId, fx.orgId)).entries.filter((r) => r.e.id !== entryId);
    await updateCfaEntry({ entryId: second!.e.id, organizationId: fx.orgId, userId: fx.gmId, fields: { nextAction: "Visit", nextActionDate: "2026-07-15" } });
    const followUps = await getFollowUps(fx.orgId);
    expect(followUps.map((f) => f.e.nextActionDate)).toEqual(["2026-07-15", "2026-08-01"]);
    expect(await getFollowUps(fx.otherOrgId)).toHaveLength(0);
  });

  it("reorders signing priorities with history and rejects partial orders", async () => {
    const ids = (await getCfaBoardDetail(boardId, fx.orgId)).entries.map((r) => r.e.id);
    await reorderCfaPriorities({ boardId, organizationId: fx.orgId, userId: fx.gmId, orderedEntryIds: [ids[1]!, ids[0]!] });
    expect((await getCfaBoardDetail(boardId, fx.orgId)).entries.map((r) => r.e.id)).toEqual([ids[1], ids[0]]);
    const prio = await db
      .select()
      .from(schema.collegeFreeAgentStatusHistory)
      .where(and(eq(schema.collegeFreeAgentStatusHistory.entryId, ids[0]!), eq(schema.collegeFreeAgentStatusHistory.field, "priority_rank")));
    expect(prio[0]?.previousValue).toBe("1");
    expect(prio[0]?.newValue).toBe("2");
    await expect(reorderCfaPriorities({ boardId, organizationId: fx.orgId, userId: fx.gmId, orderedEntryIds: [ids[0]!] })).rejects.toThrow(/every entry/);
  });

  it("enforces org isolation on CFA reads and writes", async () => {
    await expect(getCfaBoardDetail(boardId, fx.otherOrgId)).rejects.toThrow(ScoutingError);
    await expect(updateCfaEntry({ entryId, organizationId: fx.otherOrgId, userId: fx.outsiderId, fields: { notes: "x" } })).rejects.toThrow(ScoutingError);
    await expect(addCfaEntry({ boardId, prospectId: fx.prospectIds[1]!, organizationId: fx.otherOrgId, userId: fx.outsiderId })).rejects.toThrow(ScoutingError);
  });
});

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

describe("board permissions (capability tiers)", () => {
  it("scouts submit rankings but cannot manage, finalize, or unlock boards", () => {
    expect(roleHasCapability("scout", "create_scouting_reports")).toBe(true);
    expect(roleHasCapability("scout", "manage_draft_boards")).toBe(false);
    expect(roleHasCapability("scout", "finalize_boards")).toBe(false);
    expect(roleHasCapability("scout", "unlock_boards")).toBe(false);
    expect(roleHasCapability("scout", "manage_contacts")).toBe(false);
  });
  it("assistant directors manage boards and the CFA workflow but cannot finalize or unlock", () => {
    for (const cap of ["manage_draft_boards", "manage_cfa_boards", "manage_contacts", "assign_followups", "export_scouting"] as const) {
      expect(roleHasCapability("scouting_asst_director", cap)).toBe(true);
    }
    expect(roleHasCapability("scouting_asst_director", "finalize_boards")).toBe(false);
    expect(roleHasCapability("scouting_asst_director", "unlock_boards")).toBe(false);
  });
  it("directors finalize and unlock; viewers can view but not export", () => {
    expect(roleHasCapability("scouting_director", "finalize_boards")).toBe(true);
    expect(roleHasCapability("scouting_director", "unlock_boards")).toBe(true);
    expect(roleHasCapability("viewer", "view_scouting")).toBe(true);
    expect(roleHasCapability("viewer", "export_scouting")).toBe(false);
  });
});
