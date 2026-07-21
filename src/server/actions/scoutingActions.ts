"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";

export interface FormState {
  error?: string;
}

async function ownedProspect(prospectId: string, organizationId: string) {
  const db = getDb();
  const [p] = await db
    .select()
    .from(schema.amateurProspects)
    .where(and(eq(schema.amateurProspects.id, prospectId), eq(schema.amateurProspects.organizationId, organizationId)))
    .limit(1);
  return p ?? null;
}

/* ---------------- Scout-assigned roles ---------------- */

const roleSchema = z.object({
  organizationId: z.string().uuid(),
  prospectId: z.string().uuid(),
  scoutAssignedRoleKey: z.string().max(80).optional(),
  projectedProRoleKey: z.string().max(80).optional(),
});

export async function setScoutRolesAction(formData: FormData): Promise<void> {
  const parsed = roleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_prospects");
  const prospect = await ownedProspect(parsed.data.prospectId, ctx.organizationId);
  if (!prospect) return;
  const db = getDb();
  await db
    .update(schema.amateurProspects)
    .set({
      scoutAssignedRoleKey: parsed.data.scoutAssignedRoleKey || null,
      projectedProRoleKey: parsed.data.projectedProRoleKey || null,
      updatedAt: new Date(),
    })
    .where(eq(schema.amateurProspects.id, prospect.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.role_assign",
    entityType: "amateur_prospect",
    entityId: prospect.id,
    previousValues: { scoutAssignedRoleKey: prospect.scoutAssignedRoleKey, projectedProRoleKey: prospect.projectedProRoleKey },
    newValues: { scoutAssignedRoleKey: parsed.data.scoutAssignedRoleKey ?? null, projectedProRoleKey: parsed.data.projectedProRoleKey ?? null },
  });
  revalidatePath(`/scouting/players/${prospect.id}`);
}

/* ---------------- Scouting reports ---------------- */

const REPORT_SECTIONS = [
  "hockey_sense", "skating", "puck_skills", "compete", "offensive_play",
  "defensive_play", "transition", "special_teams", "physical_profile",
] as const;

const reportSchema = z.object({
  organizationId: z.string().uuid(),
  prospectId: z.string().uuid(),
  viewingType: z.enum(schema.viewingType.enumValues).default("live"),
  gameDate: z.string().optional(),
  opponent: z.string().max(120).optional(),
  venue: z.string().max(120).optional(),
  gradingScale: z.enum(["20-80", "1-10", "1-5"]).default("20-80"),
  strengths: z.string().max(4000).optional(),
  concerns: z.string().max(4000).optional(),
  developmentPriorities: z.string().max(4000).optional(),
  nhlProjection: z.string().max(400).optional(),
  professionalFloor: z.string().max(400).optional(),
  professionalCeiling: z.string().max(400).optional(),
  developmentTimeline: z.string().max(400).optional(),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  recommendation: z.string().max(2000).optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

const SCALE_BOUNDS: Record<string, [number, number]> = {
  "20-80": [20, 80],
  "1-10": [1, 10],
  "1-5": [1, 5],
};

export async function createScoutingReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "create_scouting_reports");
  const prospect = await ownedProspect(parsed.data.prospectId, ctx.organizationId);
  if (!prospect) return { error: "Prospect not found" };

  const [lo, hi] = SCALE_BOUNDS[parsed.data.gradingScale] ?? [20, 80];
  const grades: Record<string, number> = {};
  for (const section of REPORT_SECTIONS) {
    const value = formData.get(`grade_${section}`);
    if (value === null || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      return { error: `Grade for ${section.replace(/_/g, " ")} must be between ${lo} and ${hi}` };
    }
    grades[section] = n;
  }

  const db = getDb();
  const [report] = await db
    .insert(schema.scoutingReports)
    .values({
      organizationId: ctx.organizationId,
      prospectId: prospect.id,
      scoutId: ctx.user.id,
      viewingType: parsed.data.viewingType,
      gameDate: parsed.data.gameDate || null,
      opponent: parsed.data.opponent || null,
      venue: parsed.data.venue || null,
      gradingScale: parsed.data.gradingScale,
      grades,
      strengths: parsed.data.strengths || null,
      concerns: parsed.data.concerns || null,
      developmentPriorities: parsed.data.developmentPriorities || null,
      nhlProjection: parsed.data.nhlProjection || null,
      professionalFloor: parsed.data.professionalFloor || null,
      professionalCeiling: parsed.data.professionalCeiling || null,
      developmentTimeline: parsed.data.developmentTimeline || null,
      risk: parsed.data.risk,
      recommendation: parsed.data.recommendation || null,
      confidence: parsed.data.confidence ?? null,
      status: "submitted",
    })
    .returning();
  if (!report) return { error: "Could not save report" };
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.report_create",
    entityType: "scouting_report",
    entityId: report.id,
    newValues: { prospectId: prospect.id, viewingType: report.viewingType, risk: report.risk },
  });
  revalidatePath(`/scouting/players/${prospect.id}`);
  revalidatePath("/scouting/reports");
  return {};
}

/* Organizational-need actions live in fitActions.ts (Phase 2). */

/* ---------------- Watchlists ---------------- */

const watchlistAddSchema = z.object({
  organizationId: z.string().uuid(),
  prospectId: z.string().uuid(),
  watchlistId: z.string().uuid().optional(),
  newWatchlistName: z.string().max(120).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  reason: z.string().max(500).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function addToWatchlistAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = watchlistAddSchema.safeParse({
    ...raw,
    watchlistId: raw.watchlistId || undefined,
    newWatchlistName: raw.newWatchlistName || undefined,
    priority: raw.priority || undefined,
    reason: raw.reason || undefined,
    followUpDate: raw.followUpDate || undefined,
  });
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_watchlists");
  const prospect = await ownedProspect(parsed.data.prospectId, ctx.organizationId);
  if (!prospect) return { error: "Prospect not found" };
  const db = getDb();

  let watchlistId = parsed.data.watchlistId ?? null;
  if (!watchlistId) {
    const name = parsed.data.newWatchlistName?.trim();
    if (!name) return { error: "Pick a watchlist or name a new one" };
    const [wl] = await db
      .insert(schema.prospectWatchlists)
      .values({ organizationId: ctx.organizationId, name, createdBy: ctx.user.id })
      .returning();
    if (!wl) return { error: "Could not create watchlist" };
    watchlistId = wl.id;
  } else {
    const [wl] = await db
      .select({ id: schema.prospectWatchlists.id })
      .from(schema.prospectWatchlists)
      .where(and(eq(schema.prospectWatchlists.id, watchlistId), eq(schema.prospectWatchlists.organizationId, ctx.organizationId)))
      .limit(1);
    if (!wl) return { error: "Watchlist not found" };
  }

  await db
    .insert(schema.prospectWatchlistMembers)
    .values({
      watchlistId,
      prospectId: prospect.id,
      addedBy: ctx.user.id,
      priority: parsed.data.priority ?? 3,
      reason: parsed.data.reason || null,
      followUpDate: parsed.data.followUpDate || null,
    })
    .onConflictDoNothing();
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.watchlist_add",
    entityType: "prospect_watchlist",
    entityId: watchlistId,
    newValues: { prospectId: prospect.id, priority: parsed.data.priority ?? 3, reason: parsed.data.reason ?? null },
  });
  revalidatePath(`/scouting/players/${prospect.id}`);
  revalidatePath("/scouting/watchlists");
  return {};
}

const watchlistRemoveSchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
});

export async function removeFromWatchlistAction(formData: FormData): Promise<void> {
  const parsed = watchlistRemoveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_watchlists");
  const db = getDb();
  // Row ownership: the member's watchlist must belong to this org.
  const [member] = await db
    .select({ m: schema.prospectWatchlistMembers, w: schema.prospectWatchlists })
    .from(schema.prospectWatchlistMembers)
    .innerJoin(schema.prospectWatchlists, eq(schema.prospectWatchlistMembers.watchlistId, schema.prospectWatchlists.id))
    .where(
      and(
        eq(schema.prospectWatchlistMembers.id, parsed.data.memberId),
        eq(schema.prospectWatchlists.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!member) return;
  await db.delete(schema.prospectWatchlistMembers).where(eq(schema.prospectWatchlistMembers.id, member.m.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.watchlist_remove",
    entityType: "prospect_watchlist",
    entityId: member.w.id,
    previousValues: { prospectId: member.m.prospectId, priority: member.m.priority, reason: member.m.reason },
  });
  revalidatePath(`/scouting/players/${member.m.prospectId}`);
  revalidatePath("/scouting/watchlists");
}

/* ---------------- Draft boards ---------------- */

const boardAddSchema = z.object({
  organizationId: z.string().uuid(),
  prospectId: z.string().uuid(),
  boardId: z.string().uuid(),
});

export async function addToDraftBoardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = boardAddSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  const prospect = await ownedProspect(parsed.data.prospectId, ctx.organizationId);
  if (!prospect) return { error: "Prospect not found" };
  const db = getDb();
  const [board] = await db
    .select()
    .from(schema.draftBoards)
    .where(and(eq(schema.draftBoards.id, parsed.data.boardId), eq(schema.draftBoards.organizationId, ctx.organizationId)))
    .limit(1);
  if (!board) return { error: "Board not found" };

  const [last] = await db
    .select({ overallRank: schema.draftBoardEntries.overallRank })
    .from(schema.draftBoardEntries)
    .where(eq(schema.draftBoardEntries.boardId, board.id))
    .orderBy(desc(schema.draftBoardEntries.overallRank))
    .limit(1);
  await db
    .insert(schema.draftBoardEntries)
    .values({ boardId: board.id, prospectId: prospect.id, overallRank: (last?.overallRank ?? 0) + 1 })
    .onConflictDoNothing();
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.board_add",
    entityType: "draft_board",
    entityId: board.id,
    newValues: { prospectId: prospect.id },
  });
  revalidatePath(`/scouting/players/${prospect.id}`);
  revalidatePath("/scouting/board");
  return {};
}

const boardRankSchema = z.object({
  organizationId: z.string().uuid(),
  entryId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

/** Swaps an entry with its neighbor (simple, atomic re-ranking). */
export async function moveBoardEntryAction(formData: FormData): Promise<void> {
  const parsed = boardRankSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  const db = getDb();
  const [entry] = await db
    .select({ entry: schema.draftBoardEntries, board: schema.draftBoards })
    .from(schema.draftBoardEntries)
    .innerJoin(schema.draftBoards, eq(schema.draftBoardEntries.boardId, schema.draftBoards.id))
    .where(and(eq(schema.draftBoardEntries.id, parsed.data.entryId), eq(schema.draftBoards.organizationId, ctx.organizationId)))
    .limit(1);
  if (!entry) return;
  const targetRank = parsed.data.direction === "up" ? entry.entry.overallRank - 1 : entry.entry.overallRank + 1;
  if (targetRank < 1) return;
  const [neighbor] = await db
    .select()
    .from(schema.draftBoardEntries)
    .where(and(eq(schema.draftBoardEntries.boardId, entry.entry.boardId), eq(schema.draftBoardEntries.overallRank, targetRank)))
    .limit(1);
  await db.transaction(async (tx) => {
    if (neighbor) {
      await tx.update(schema.draftBoardEntries).set({ overallRank: entry.entry.overallRank, updatedAt: new Date() }).where(eq(schema.draftBoardEntries.id, neighbor.id));
    }
    await tx.update(schema.draftBoardEntries).set({ overallRank: targetRank, updatedAt: new Date() }).where(eq(schema.draftBoardEntries.id, entry.entry.id));
  });
  revalidatePath("/scouting/board");
}

/* ---------------- Assignments ---------------- */

const assignmentSchema = z.object({
  organizationId: z.string().uuid(),
  scoutEmail: z.string().email().optional(),
  prospectId: z.string().uuid().optional(),
  region: z.string().max(120).optional(),
  assignmentType: z.enum(["player", "region", "school", "game", "cross_check"]).default("player"),
  dueDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export async function createAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = assignmentSchema.safeParse({
    ...raw,
    scoutEmail: raw.scoutEmail || undefined,
    prospectId: raw.prospectId || undefined,
    region: raw.region || undefined,
    dueDate: raw.dueDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "assign_scouts");
  const db = getDb();

  let scoutId: string | null = null;
  if (parsed.data.scoutEmail) {
    const [member] = await db
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.organizationMembers.userId, schema.users.id))
      .where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), eq(schema.users.email, parsed.data.scoutEmail)))
      .limit(1);
    if (!member) return { error: "No organization member with that email" };
    scoutId = member.userId;
  }
  if (parsed.data.prospectId) {
    const prospect = await ownedProspect(parsed.data.prospectId, ctx.organizationId);
    if (!prospect) return { error: "Prospect not found" };
  }

  const [assignment] = await db
    .insert(schema.scoutingAssignments)
    .values({
      organizationId: ctx.organizationId,
      scoutId,
      prospectId: parsed.data.prospectId ?? null,
      region: parsed.data.region ?? null,
      assignmentType: parsed.data.assignmentType,
      dueDate: parsed.data.dueDate ?? null,
      notes: parsed.data.notes || null,
      createdBy: ctx.user.id,
    })
    .returning();
  if (!assignment) return { error: "Could not create assignment" };
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.assignment_create",
    entityType: "scouting_assignment",
    entityId: assignment.id,
    newValues: { scoutId, type: assignment.assignmentType },
  });
  revalidatePath("/scouting/assignments");
  return {};
}

const fitSchema = z.object({
  organizationId: z.string().uuid(),
  prospectId: z.string().uuid(),
  needId: z.string().uuid(),
});

/** Computes and persists an explainable fit score (model riq-fit-v0.1). */
export async function computeFitAction(formData: FormData): Promise<void> {
  const parsed = fitSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_prospects");
  const { computeFit, ScoutingError } = await import("@/server/services/scoutingService");
  try {
    await computeFit(parsed.data.prospectId, parsed.data.needId, ctx.organizationId);
  } catch (err) {
    if (!(err instanceof ScoutingError)) throw err;
    return;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.fit_compute",
    entityType: "amateur_prospect",
    entityId: parsed.data.prospectId,
    newValues: { needId: parsed.data.needId },
  });
  revalidatePath(`/scouting/players/${parsed.data.prospectId}`);
  revalidatePath("/scouting/fit");
}

/* ---------------- Saved filter views (NCAA players list) ---------------- */

const savedViewSchema = z.object({
  organizationId: z.string().uuid(),
  viewKey: z.enum(["ncaa_players"]),
  name: z.string().min(1).max(80),
  filters: z.string().max(2000), // querystring snapshot, e.g. "pos=D&conf=..."
});

export async function saveScoutingViewAction(formData: FormData): Promise<void> {
  const parsed = savedViewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "view_scouting");
  const db = getDb();
  await db.insert(schema.savedViews).values({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    viewKey: parsed.data.viewKey,
    name: parsed.data.name.trim(),
    filters: { query: parsed.data.filters },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.view_save",
    entityType: "saved_view",
    newValues: { viewKey: parsed.data.viewKey, name: parsed.data.name },
  });
  revalidatePath("/scouting/players");
}

const deleteViewSchema = z.object({
  organizationId: z.string().uuid(),
  viewId: z.string().uuid(),
});

export async function deleteScoutingViewAction(formData: FormData): Promise<void> {
  const parsed = deleteViewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "view_scouting");
  const db = getDb();
  // Users may only delete their own saved views within their organization.
  await db
    .delete(schema.savedViews)
    .where(
      and(
        eq(schema.savedViews.id, parsed.data.viewId),
        eq(schema.savedViews.organizationId, ctx.organizationId),
        eq(schema.savedViews.userId, ctx.user.id),
      ),
    );
  revalidatePath("/scouting/players");
}
