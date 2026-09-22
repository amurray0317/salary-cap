/**
 * Acquisition-board service: draft boards and college free-agent boards.
 *
 * Versioning: every meaningful mutation (add/remove/reorder/rank/lock)
 * increments board.version, writes a draft_board_versions row, an immutable
 * ordered snapshot (draft_board_snapshots), and per-change rank-history rows
 * carrying previous/new values, the user, and the new version.
 *
 * Ranking sources are separate columns and are NEVER overwritten by one
 * another: overall (working order), model, scout consensus, organizational
 * fit, and the director's final rank all coexist.
 *
 * No "server-only" import (project convention): integration tests exercise
 * this against in-memory PGlite via setDbForTesting.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { computeConsensus } from "@/lib/scouting/consensus";
import { ScoutingError } from "@/server/services/scoutingService";

export type DraftBoardRow = typeof schema.draftBoards.$inferSelect;
export type CfaBoardRow = typeof schema.collegeFreeAgentBoards.$inferSelect;

/* ------------------------------------------------------------------ */
/* Ownership + lock guards                                             */
/* ------------------------------------------------------------------ */

export async function getOwnedBoard(boardId: string, organizationId: string): Promise<DraftBoardRow> {
  const db = getDb();
  const [board] = await db
    .select()
    .from(schema.draftBoards)
    .where(and(eq(schema.draftBoards.id, boardId), eq(schema.draftBoards.organizationId, organizationId)))
    .limit(1);
  if (!board) throw new ScoutingError("Board not found in this organization");
  return board;
}

export async function getOwnedCfaBoard(boardId: string, organizationId: string): Promise<CfaBoardRow> {
  const db = getDb();
  const [board] = await db
    .select()
    .from(schema.collegeFreeAgentBoards)
    .where(and(eq(schema.collegeFreeAgentBoards.id, boardId), eq(schema.collegeFreeAgentBoards.organizationId, organizationId)))
    .limit(1);
  if (!board) throw new ScoutingError("Board not found in this organization");
  return board;
}

function assertUnlocked(board: DraftBoardRow): void {
  if (board.status === "locked") throw new ScoutingError("Board is locked — rankings and entries cannot change");
  if (board.status === "archived") throw new ScoutingError("Board is archived");
}

/* ------------------------------------------------------------------ */
/* Versioning primitives                                               */
/* ------------------------------------------------------------------ */

async function orderedEntries(boardId: string) {
  const db = getDb();
  return db
    .select({ e: schema.draftBoardEntries, p: schema.amateurProspects })
    .from(schema.draftBoardEntries)
    .innerJoin(schema.amateurProspects, eq(schema.draftBoardEntries.prospectId, schema.amateurProspects.id))
    .where(eq(schema.draftBoardEntries.boardId, boardId))
    .orderBy(asc(schema.draftBoardEntries.overallRank));
}

interface HistoryEvent {
  prospectId?: string | null;
  field: string;
  previousValue?: string | null;
  newValue?: string | null;
  previousRank?: number | null;
  newRank?: number | null;
  reason?: string | null;
}

/** Bumps the version, snapshots the *new* state, and writes history rows. */
async function commitBoardVersion(
  board: DraftBoardRow,
  userId: string | null,
  reason: string | null,
  events: HistoryEvent[],
): Promise<number> {
  const db = getDb();
  const [current] = await db
    .select({ version: schema.draftBoards.version })
    .from(schema.draftBoards)
    .where(eq(schema.draftBoards.id, board.id))
    .limit(1);
  const newVersion = (current?.version ?? board.version) + 1;
  const rows = await orderedEntries(board.id);
  const snapshot = rows.map((r) => ({
    prospectId: r.p.id,
    prospectName: r.p.fullName,
    position: r.p.position,
    overallRank: r.e.overallRank,
    positionRank: r.e.positionRank,
    modelRank: r.e.modelRank,
    consensusRank: r.e.consensusRank,
    fitRank: r.e.fitRank,
    directorFinalRank: r.e.directorFinalRank,
    expectedRound: r.e.expectedRound,
    risk: r.e.risk,
    recommendation: r.e.recommendation,
  }));
  await db
    .update(schema.draftBoards)
    .set({ version: newVersion, updatedAt: new Date() })
    .where(eq(schema.draftBoards.id, board.id));
  await db.insert(schema.draftBoardVersions).values({ boardId: board.id, version: newVersion, reason, createdBy: userId });
  await db.insert(schema.draftBoardSnapshots).values({ boardId: board.id, version: newVersion, snapshot });
  if (events.length > 0) {
    await db.insert(schema.draftBoardRankHistory).values(
      events.map((ev) => ({
        boardId: board.id,
        prospectId: ev.prospectId ?? null,
        field: ev.field,
        previousValue: ev.previousValue ?? null,
        newValue: ev.newValue ?? null,
        previousRank: ev.previousRank ?? null,
        newRank: ev.newRank ?? null,
        boardVersion: newVersion,
        reason: ev.reason ?? null,
        userId,
      })),
    );
  }
  return newVersion;
}

/** Recomputes rank-within-position-group for every entry on the board. */
async function recomputePositionRanks(boardId: string): Promise<void> {
  const db = getDb();
  const rows = await orderedEntries(boardId);
  const counters = new Map<string, number>();
  for (const r of rows) {
    const next = (counters.get(r.p.positionGroup) ?? 0) + 1;
    counters.set(r.p.positionGroup, next);
    if (r.e.positionRank !== next) {
      await db.update(schema.draftBoardEntries).set({ positionRank: next }).where(eq(schema.draftBoardEntries.id, r.e.id));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Derived ranking sources (model / fit / counts) — never overwrite     */
/* the working order or the director's final rank.                     */
/* ------------------------------------------------------------------ */

export async function refreshBoardDerived(boardId: string, organizationId: string): Promise<void> {
  const db = getDb();
  const rows = await orderedEntries(boardId);
  const ids = rows.map((r) => r.p.id);
  if (ids.length === 0) return;

  // Statistical-model rank: best persisted role score per prospect.
  const roleRows = await db
    .select({ prospectId: schema.prospectRoleScores.prospectId, score: schema.prospectRoleScores.score })
    .from(schema.prospectRoleScores)
    .where(inArray(schema.prospectRoleScores.prospectId, ids));
  const bestRole = new Map<string, number>();
  for (const r of roleRows) if ((bestRole.get(r.prospectId) ?? -1) < r.score) bestRole.set(r.prospectId, r.score);
  const modelOrder = ids.filter((id) => bestRole.has(id)).sort((a, b) => bestRole.get(b)! - bestRole.get(a)!);

  // Organizational-fit rank: best fit score per prospect across needs.
  const fitRows = await db
    .select({ prospectId: schema.prospectFitScores.prospectId, score: schema.prospectFitScores.overallScore })
    .from(schema.prospectFitScores)
    .where(and(eq(schema.prospectFitScores.organizationId, organizationId), inArray(schema.prospectFitScores.prospectId, ids)));
  const bestFit = new Map<string, number>();
  for (const r of fitRows) if ((bestFit.get(r.prospectId) ?? -1) < r.score) bestFit.set(r.prospectId, r.score);
  const fitOrder = ids.filter((id) => bestFit.has(id)).sort((a, b) => bestFit.get(b)! - bestFit.get(a)!);

  // Viewing + report counts.
  const viewings = await db
    .select({ prospectId: schema.scoutViewings.prospectId, gameDate: schema.scoutViewings.gameDate })
    .from(schema.scoutViewings)
    .where(and(eq(schema.scoutViewings.organizationId, organizationId), inArray(schema.scoutViewings.prospectId, ids)));
  const reports = await db
    .select({ prospectId: schema.scoutingReports.prospectId })
    .from(schema.scoutingReports)
    .where(and(eq(schema.scoutingReports.organizationId, organizationId), inArray(schema.scoutingReports.prospectId, ids)));
  const viewCount = new Map<string, number>();
  const lastViewed = new Map<string, string>();
  for (const v of viewings) {
    if (!v.prospectId) continue;
    viewCount.set(v.prospectId, (viewCount.get(v.prospectId) ?? 0) + 1);
    if (v.gameDate && (lastViewed.get(v.prospectId) ?? "") < v.gameDate) lastViewed.set(v.prospectId, v.gameDate);
  }
  const reportCount = new Map<string, number>();
  for (const r of reports) reportCount.set(r.prospectId, (reportCount.get(r.prospectId) ?? 0) + 1);

  const consensusRows = await db.select().from(schema.consensusRankings).where(eq(schema.consensusRankings.boardId, boardId));
  const consensusMean = new Map(consensusRows.map((c) => [c.prospectId, c.meanRank]));

  for (const r of rows) {
    const modelIdx = modelOrder.indexOf(r.p.id);
    const fitIdx = fitOrder.indexOf(r.p.id);
    await db
      .update(schema.draftBoardEntries)
      .set({
        modelRank: modelIdx >= 0 ? modelIdx + 1 : null,
        fitRank: fitIdx >= 0 ? fitIdx + 1 : null,
        fitScore: bestFit.get(r.p.id) ?? null,
        consensusRank: consensusMean.get(r.p.id) ?? null,
        viewingCount: viewCount.get(r.p.id) ?? 0,
        reportCount: reportCount.get(r.p.id) ?? 0,
        lastViewedAt: lastViewed.get(r.p.id) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftBoardEntries.id, r.e.id));
  }
}

/* ------------------------------------------------------------------ */
/* Draft-board mutations                                               */
/* ------------------------------------------------------------------ */

export async function createDraftBoard(opts: {
  organizationId: string;
  userId: string;
  name: string;
  description?: string | null;
  draftYear: number;
}): Promise<DraftBoardRow> {
  const db = getDb();
  const [board] = await db
    .insert(schema.draftBoards)
    .values({
      organizationId: opts.organizationId,
      name: opts.name,
      description: opts.description ?? null,
      boardType: "draft",
      draftYear: opts.draftYear,
      createdBy: opts.userId,
    })
    .returning();
  if (!board) throw new ScoutingError("Could not create board");
  await db.insert(schema.draftBoardVersions).values({ boardId: board.id, version: 1, reason: "Board created", createdBy: opts.userId });
  await db.insert(schema.draftBoardSnapshots).values({ boardId: board.id, version: 1, snapshot: [] });
  return board;
}

export async function addProspectToBoard(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  assertUnlocked(board);
  const [prospect] = await db
    .select()
    .from(schema.amateurProspects)
    .where(and(eq(schema.amateurProspects.id, opts.prospectId), eq(schema.amateurProspects.organizationId, opts.organizationId)))
    .limit(1);
  if (!prospect) throw new ScoutingError("Prospect not found in this organization");
  const existing = await orderedEntries(board.id);
  if (existing.some((r) => r.p.id === prospect.id)) throw new ScoutingError("Prospect is already on this board");
  const rank = existing.length + 1;
  await db.insert(schema.draftBoardEntries).values({
    boardId: board.id,
    prospectId: prospect.id,
    overallRank: rank,
    addedBy: opts.userId,
  });
  await recomputePositionRanks(board.id);
  await refreshBoardDerived(board.id, opts.organizationId);
  await commitBoardVersion(board, opts.userId, `Added ${prospect.fullName}`, [
    { prospectId: prospect.id, field: "added", newValue: prospect.fullName, newRank: rank },
  ]);
}

export async function removeProspectFromBoard(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  assertUnlocked(board);
  const rows = await orderedEntries(board.id);
  const target = rows.find((r) => r.p.id === opts.prospectId);
  if (!target) throw new ScoutingError("Prospect is not on this board");
  await db.delete(schema.draftBoardEntries).where(eq(schema.draftBoardEntries.id, target.e.id));
  const remaining = await orderedEntries(board.id);
  for (const [i, r] of remaining.entries()) {
    if (r.e.overallRank !== i + 1) {
      await db.update(schema.draftBoardEntries).set({ overallRank: i + 1 }).where(eq(schema.draftBoardEntries.id, r.e.id));
    }
  }
  await recomputePositionRanks(board.id);
  await commitBoardVersion(board, opts.userId, `Removed ${target.p.fullName}`, [
    { prospectId: target.p.id, field: "removed", previousValue: target.p.fullName, previousRank: target.e.overallRank },
  ]);
}

/** Applies a full new order (drag-and-drop result) in one version bump. */
export async function reorderBoard(opts: {
  boardId: string;
  organizationId: string;
  userId: string;
  orderedProspectIds: string[];
  reason?: string | null;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  assertUnlocked(board);
  const rows = await orderedEntries(board.id);
  const byProspect = new Map(rows.map((r) => [r.p.id, r]));
  if (
    opts.orderedProspectIds.length !== rows.length ||
    new Set(opts.orderedProspectIds).size !== rows.length ||
    opts.orderedProspectIds.some((id) => !byProspect.has(id))
  ) {
    throw new ScoutingError("Reorder must include every current board entry exactly once");
  }
  const events: HistoryEvent[] = [];
  for (const [i, prospectId] of opts.orderedProspectIds.entries()) {
    const row = byProspect.get(prospectId)!;
    const newRank = i + 1;
    if (row.e.overallRank !== newRank) {
      events.push({
        prospectId,
        field: "overall_rank",
        previousRank: row.e.overallRank,
        newRank,
        previousValue: String(row.e.overallRank),
        newValue: String(newRank),
        reason: opts.reason ?? null,
      });
      await db
        .update(schema.draftBoardEntries)
        .set({ overallRank: newRank, updatedAt: new Date() })
        .where(eq(schema.draftBoardEntries.id, row.e.id));
    }
  }
  if (events.length === 0) return; // no-op reorder — no version churn
  await recomputePositionRanks(board.id);
  await commitBoardVersion(board, opts.userId, opts.reason ?? "Reordered board", events);
}

/** Director's final rank — its own column; never touches the working order. */
export async function setDirectorRank(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  userId: string;
  rank: number | null;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  assertUnlocked(board);
  const rows = await orderedEntries(board.id);
  const target = rows.find((r) => r.p.id === opts.prospectId);
  if (!target) throw new ScoutingError("Prospect is not on this board");
  if (target.e.directorFinalRank === opts.rank) return;
  await db
    .update(schema.draftBoardEntries)
    .set({ directorFinalRank: opts.rank, updatedAt: new Date() })
    .where(eq(schema.draftBoardEntries.id, target.e.id));
  await commitBoardVersion(board, opts.userId, "Director final rank", [
    {
      prospectId: opts.prospectId,
      field: "director_final_rank",
      previousValue: target.e.directorFinalRank === null ? null : String(target.e.directorFinalRank),
      newValue: opts.rank === null ? null : String(opts.rank),
      previousRank: target.e.directorFinalRank,
      newRank: opts.rank,
    },
  ]);
}

const ENTRY_FIELDS = ["expectedRound", "expectedRangeStart", "expectedRangeEnd", "risk", "floor", "ceiling", "recommendation", "notes"] as const;
type EntryField = (typeof ENTRY_FIELDS)[number];
const NOTE_FIELDS: readonly string[] = ["notes", "recommendation"];

export async function updateBoardEntry(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  userId: string;
  fields: Partial<Record<EntryField, string | number | null>>;
  /** Notes/recommendation may change on a locked board when the caller holds the right capability. */
  allowOnLocked?: boolean;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  const onlyNotes = Object.keys(opts.fields).every((k) => NOTE_FIELDS.includes(k));
  if (board.status === "archived") throw new ScoutingError("Board is archived");
  if (!(opts.allowOnLocked && onlyNotes)) assertUnlocked(board);
  const rows = await orderedEntries(board.id);
  const target = rows.find((r) => r.p.id === opts.prospectId);
  if (!target) throw new ScoutingError("Prospect is not on this board");
  const events: HistoryEvent[] = [];
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(opts.fields)) {
    if (!ENTRY_FIELDS.includes(key as EntryField)) continue;
    const prev = target.e[key as EntryField];
    if (prev === value) continue;
    set[key] = value;
    events.push({
      prospectId: opts.prospectId,
      field: key,
      previousValue: prev === null || prev === undefined ? null : String(prev),
      newValue: value === null || value === undefined ? null : String(value),
    });
  }
  if (events.length === 0) return;
  await db.update(schema.draftBoardEntries).set(set).where(eq(schema.draftBoardEntries.id, target.e.id));
  await commitBoardVersion(board, opts.userId, "Entry fields updated", events);
}

export async function setBoardStatus(opts: {
  boardId: string;
  organizationId: string;
  userId: string;
  status: "active" | "locked" | "archived";
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  if (board.status === opts.status) return;
  await db
    .update(schema.draftBoards)
    .set({
      status: opts.status,
      lockedBy: opts.status === "locked" ? opts.userId : board.lockedBy,
      lockedAt: opts.status === "locked" ? new Date() : board.lockedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.draftBoards.id, board.id));
  await commitBoardVersion(board, opts.userId, `Board ${opts.status}`, [
    { field: "status", previousValue: board.status, newValue: opts.status },
  ]);
}

/* ------------------------------------------------------------------ */
/* Scout rankings + consensus                                          */
/* ------------------------------------------------------------------ */

export async function submitScoutRanking(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  scoutId: string;
  rank: number;
  notes?: string | null;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedBoard(opts.boardId, opts.organizationId);
  assertUnlocked(board);
  const rows = await orderedEntries(board.id);
  if (!rows.some((r) => r.p.id === opts.prospectId)) throw new ScoutingError("Prospect is not on this board");
  await db
    .insert(schema.scoutRankings)
    .values({
      organizationId: opts.organizationId,
      boardId: board.id,
      prospectId: opts.prospectId,
      scoutId: opts.scoutId,
      rank: opts.rank,
      notes: opts.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.scoutRankings.boardId, schema.scoutRankings.prospectId, schema.scoutRankings.scoutId],
      set: { rank: opts.rank, notes: opts.notes ?? null, updatedAt: new Date() },
    });
  await recomputeConsensus(board.id, opts.prospectId);
}

/** Recomputes the transparent consensus row for one board prospect. */
export async function recomputeConsensus(boardId: string, prospectId: string): Promise<void> {
  const db = getDb();
  const rankings = await db
    .select({ rank: schema.scoutRankings.rank })
    .from(schema.scoutRankings)
    .where(and(eq(schema.scoutRankings.boardId, boardId), eq(schema.scoutRankings.prospectId, prospectId)));
  const result = computeConsensus(rankings.map((r) => r.rank));
  const entryWhere = and(eq(schema.draftBoardEntries.boardId, boardId), eq(schema.draftBoardEntries.prospectId, prospectId));
  if (!result) {
    await db
      .delete(schema.consensusRankings)
      .where(and(eq(schema.consensusRankings.boardId, boardId), eq(schema.consensusRankings.prospectId, prospectId)));
    await db.update(schema.draftBoardEntries).set({ consensusRank: null }).where(entryWhere);
    return;
  }
  const values = {
    submissions: result.submissions,
    meanRank: result.meanRank,
    medianRank: result.medianRank,
    bestRank: result.bestRank,
    worstRank: result.worstRank,
    spread: result.spread,
    stddev: result.stddev,
    insufficient: result.insufficient,
  };
  await db
    .insert(schema.consensusRankings)
    .values({ boardId, prospectId, ...values })
    .onConflictDoUpdate({
      target: [schema.consensusRankings.boardId, schema.consensusRankings.prospectId],
      set: { ...values, computedAt: new Date() },
    });
  await db.update(schema.draftBoardEntries).set({ consensusRank: result.meanRank }).where(entryWhere);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getBoardDetail(boardId: string, organizationId: string) {
  const db = getDb();
  const board = await getOwnedBoard(boardId, organizationId);
  const entries = await orderedEntries(board.id);
  const consensus = await db.select().from(schema.consensusRankings).where(eq(schema.consensusRankings.boardId, board.id));
  const rankings = await db
    .select({ r: schema.scoutRankings, scoutName: schema.users.fullName })
    .from(schema.scoutRankings)
    .innerJoin(schema.users, eq(schema.scoutRankings.scoutId, schema.users.id))
    .where(eq(schema.scoutRankings.boardId, board.id));
  const versions = await db
    .select()
    .from(schema.draftBoardVersions)
    .where(eq(schema.draftBoardVersions.boardId, board.id))
    .orderBy(desc(schema.draftBoardVersions.version));
  return { board, entries, consensus, rankings, versions };
}

export async function getBoardSnapshot(boardId: string, organizationId: string, version: number) {
  const db = getDb();
  await getOwnedBoard(boardId, organizationId);
  const [snap] = await db
    .select()
    .from(schema.draftBoardSnapshots)
    .where(and(eq(schema.draftBoardSnapshots.boardId, boardId), eq(schema.draftBoardSnapshots.version, version)))
    .limit(1);
  if (!snap) throw new ScoutingError(`No snapshot stored for version ${version}`);
  return snap;
}

/* ------------------------------------------------------------------ */
/* College free-agent boards                                           */
/* ------------------------------------------------------------------ */

export async function createCfaBoard(opts: {
  organizationId: string;
  userId: string;
  name: string;
  description?: string | null;
}): Promise<CfaBoardRow> {
  const db = getDb();
  const [board] = await db
    .insert(schema.collegeFreeAgentBoards)
    .values({ organizationId: opts.organizationId, name: opts.name, description: opts.description ?? null, createdBy: opts.userId })
    .returning();
  if (!board) throw new ScoutingError("Could not create board");
  return board;
}

export async function setCfaBoardStatus(opts: {
  boardId: string;
  organizationId: string;
  status: "active" | "archived";
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedCfaBoard(opts.boardId, opts.organizationId);
  await db
    .update(schema.collegeFreeAgentBoards)
    .set({ status: opts.status, updatedAt: new Date() })
    .where(eq(schema.collegeFreeAgentBoards.id, board.id));
}

export async function addCfaEntry(opts: {
  boardId: string;
  prospectId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedCfaBoard(opts.boardId, opts.organizationId);
  if (board.status !== "active") throw new ScoutingError(`Board is ${board.status}`);
  const [prospect] = await db
    .select()
    .from(schema.amateurProspects)
    .where(and(eq(schema.amateurProspects.id, opts.prospectId), eq(schema.amateurProspects.organizationId, opts.organizationId)))
    .limit(1);
  if (!prospect) throw new ScoutingError("Prospect not found in this organization");
  if (prospect.nhlDraftStatus === "drafted") {
    throw new ScoutingError("Only undrafted prospects belong on a college free-agent board");
  }
  const existing = await db
    .select({ id: schema.collegeFreeAgentEntries.id, prospectId: schema.collegeFreeAgentEntries.prospectId })
    .from(schema.collegeFreeAgentEntries)
    .where(eq(schema.collegeFreeAgentEntries.boardId, board.id));
  if (existing.some((e) => e.prospectId === prospect.id)) throw new ScoutingError("Prospect is already on this board");
  const fits = await db
    .select({ score: schema.prospectFitScores.overallScore })
    .from(schema.prospectFitScores)
    .where(and(eq(schema.prospectFitScores.organizationId, opts.organizationId), eq(schema.prospectFitScores.prospectId, prospect.id)))
    .orderBy(desc(schema.prospectFitScores.overallScore))
    .limit(1);
  const [entry] = await db
    .insert(schema.collegeFreeAgentEntries)
    .values({
      boardId: board.id,
      prospectId: prospect.id,
      priorityRank: existing.length + 1,
      fitScore: fits[0]?.score ?? null,
      agentName: prospect.agentName,
    })
    .returning();
  if (!entry) throw new ScoutingError("Could not add entry");
  await db.insert(schema.collegeFreeAgentStatusHistory).values({
    entryId: entry.id,
    field: "added",
    newValue: prospect.fullName,
    userId: opts.userId,
  });
}

const CFA_FIELDS = [
  "nhlRightsStatus", "remainingEligibility", "expectedAvailability", "projectedAhlRole", "projectedNhlRole",
  "readiness", "marketCompetition", "agentName", "relationshipStatus", "lastContactDate",
  "nextAction", "nextActionDate", "assignedStaffId", "recommendation", "notes", "entryStatus",
] as const;
export type CfaField = (typeof CFA_FIELDS)[number];

export async function updateCfaEntry(opts: {
  entryId: string;
  organizationId: string;
  userId: string;
  fields: Partial<Record<CfaField, string | null>>;
}): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ e: schema.collegeFreeAgentEntries, b: schema.collegeFreeAgentBoards })
    .from(schema.collegeFreeAgentEntries)
    .innerJoin(schema.collegeFreeAgentBoards, eq(schema.collegeFreeAgentEntries.boardId, schema.collegeFreeAgentBoards.id))
    .where(and(eq(schema.collegeFreeAgentEntries.id, opts.entryId), eq(schema.collegeFreeAgentBoards.organizationId, opts.organizationId)))
    .limit(1);
  if (!row) throw new ScoutingError("Entry not found in this organization");
  if (row.b.status === "archived") throw new ScoutingError("Board is archived");
  if (opts.fields.assignedStaffId) {
    const [member] = await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.organizationId, opts.organizationId), eq(schema.organizationMembers.userId, opts.fields.assignedStaffId)))
      .limit(1);
    if (!member) throw new ScoutingError("Assigned staff member is not in this organization");
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const history: Array<{ field: string; previousValue: string | null; newValue: string | null }> = [];
  for (const [key, value] of Object.entries(opts.fields)) {
    if (!CFA_FIELDS.includes(key as CfaField)) continue;
    const prev = row.e[key as CfaField];
    const prevStr = prev === null || prev === undefined ? null : String(prev);
    const nextStr = value === null || value === undefined || value === "" ? null : String(value);
    if (prevStr === nextStr) continue;
    set[key] = nextStr;
    history.push({ field: key, previousValue: prevStr, newValue: nextStr });
  }
  if (history.length === 0) return;
  await db.update(schema.collegeFreeAgentEntries).set(set).where(eq(schema.collegeFreeAgentEntries.id, row.e.id));
  await db.insert(schema.collegeFreeAgentStatusHistory).values(history.map((h) => ({ entryId: row.e.id, ...h, userId: opts.userId })));
}

export async function reorderCfaPriorities(opts: {
  boardId: string;
  organizationId: string;
  userId: string;
  orderedEntryIds: string[];
}): Promise<void> {
  const db = getDb();
  const board = await getOwnedCfaBoard(opts.boardId, opts.organizationId);
  if (board.status !== "active") throw new ScoutingError(`Board is ${board.status}`);
  const entries = await db.select().from(schema.collegeFreeAgentEntries).where(eq(schema.collegeFreeAgentEntries.boardId, board.id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (
    opts.orderedEntryIds.length !== entries.length ||
    new Set(opts.orderedEntryIds).size !== entries.length ||
    opts.orderedEntryIds.some((id) => !byId.has(id))
  ) {
    throw new ScoutingError("Reorder must include every entry exactly once");
  }
  for (const [i, id] of opts.orderedEntryIds.entries()) {
    const entry = byId.get(id)!;
    if (entry.priorityRank === i + 1) continue;
    await db.update(schema.collegeFreeAgentEntries).set({ priorityRank: i + 1, updatedAt: new Date() }).where(eq(schema.collegeFreeAgentEntries.id, id));
    await db.insert(schema.collegeFreeAgentStatusHistory).values({
      entryId: id,
      field: "priority_rank",
      previousValue: String(entry.priorityRank),
      newValue: String(i + 1),
      userId: opts.userId,
    });
  }
}

export async function getCfaBoardDetail(boardId: string, organizationId: string) {
  const db = getDb();
  const board = await getOwnedCfaBoard(boardId, organizationId);
  const entries = await db
    .select({
      e: schema.collegeFreeAgentEntries,
      p: schema.amateurProspects,
      schoolName: schema.schools.name,
      staffName: schema.users.fullName,
    })
    .from(schema.collegeFreeAgentEntries)
    .innerJoin(schema.amateurProspects, eq(schema.collegeFreeAgentEntries.prospectId, schema.amateurProspects.id))
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .leftJoin(schema.users, eq(schema.collegeFreeAgentEntries.assignedStaffId, schema.users.id))
    .where(eq(schema.collegeFreeAgentEntries.boardId, board.id))
    .orderBy(asc(schema.collegeFreeAgentEntries.priorityRank));
  return { board, entries };
}

/** Upcoming follow-up actions across every CFA board in the org. */
export async function getFollowUps(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select({
      e: schema.collegeFreeAgentEntries,
      p: schema.amateurProspects,
      boardName: schema.collegeFreeAgentBoards.name,
      boardId: schema.collegeFreeAgentBoards.id,
      staffName: schema.users.fullName,
    })
    .from(schema.collegeFreeAgentEntries)
    .innerJoin(schema.collegeFreeAgentBoards, eq(schema.collegeFreeAgentEntries.boardId, schema.collegeFreeAgentBoards.id))
    .innerJoin(schema.amateurProspects, eq(schema.collegeFreeAgentEntries.prospectId, schema.amateurProspects.id))
    .leftJoin(schema.users, eq(schema.collegeFreeAgentEntries.assignedStaffId, schema.users.id))
    .where(eq(schema.collegeFreeAgentBoards.organizationId, organizationId));
  return rows
    .filter((r) => r.e.nextActionDate !== null && r.e.entryStatus === "active")
    .sort((a, b) => (a.e.nextActionDate! < b.e.nextActionDate! ? -1 : a.e.nextActionDate! > b.e.nextActionDate! ? 1 : 0));
}

/** Records an export event (called by the export routes). */
export async function recordBoardExport(opts: {
  organizationId: string;
  boardKind: "draft" | "college_free_agent";
  boardId: string;
  userId: string | null;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.boardExports).values({
    organizationId: opts.organizationId,
    boardKind: opts.boardKind,
    boardId: opts.boardId,
    exportedBy: opts.userId,
  });
}
