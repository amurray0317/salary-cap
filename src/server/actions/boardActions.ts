"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";
import {
  addCfaEntry,
  addProspectToBoard,
  createCfaBoard,
  createDraftBoard,
  getOwnedBoard,
  getOwnedCfaBoard,
  removeProspectFromBoard,
  reorderBoard,
  reorderCfaPriorities,
  setBoardStatus,
  setCfaBoardStatus,
  setDirectorRank,
  submitScoutRanking,
  updateBoardEntry,
  updateCfaEntry,
  type CfaField,
} from "@/server/services/boardService";
import { ScoutingError } from "@/server/services/scoutingService";
import { roleHasCapability } from "@/lib/auth/roles";

export interface FormState {
  error?: string;
}

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ------------------------------------------------------------------ */
/* Draft boards                                                        */
/* ------------------------------------------------------------------ */

const createBoardSchema = z.object({
  organizationId: id,
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  draftYear: z.coerce.number().int().min(2020).max(2040),
});

export async function createDraftBoardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createBoardSchema.safeParse({ ...raw, description: raw.description || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  const board = await createDraftBoard({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    name: parsed.data.name.trim(),
    description: parsed.data.description ?? null,
    draftYear: parsed.data.draftYear,
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.create",
    entityType: "draft_board",
    entityId: board.id,
    newValues: { name: board.name, draftYear: board.draftYear },
  });
  revalidatePath("/scouting/board");
  redirect(`/scouting/board/${board.id}`);
}

const boardProspectSchema = z.object({ organizationId: id, boardId: id, prospectId: id });

export async function addBoardProspectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = boardProspectSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  try {
    await addProspectToBoard({ ...parsed.data, organizationId: ctx.organizationId, userId: ctx.user.id });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.entry_add",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    newValues: { prospectId: parsed.data.prospectId },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
  return {};
}

export async function removeBoardProspectAction(formData: FormData): Promise<void> {
  const parsed = boardProspectSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  try {
    await removeProspectFromBoard({ ...parsed.data, organizationId: ctx.organizationId, userId: ctx.user.id });
  } catch (err) {
    if (err instanceof ScoutingError) return;
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.entry_remove",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    previousValues: { prospectId: parsed.data.prospectId },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
}

const reorderSchema = z.object({
  organizationId: id,
  boardId: id,
  order: z.string().min(1), // comma-separated ids (drag result)
  reason: z.string().max(300).optional(),
});

export async function reorderBoardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = reorderSchema.safeParse({ ...raw, reason: raw.reason || undefined });
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  const orderedProspectIds = parsed.data.order.split(",").filter(Boolean);
  try {
    await reorderBoard({
      boardId: parsed.data.boardId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      orderedProspectIds,
      reason: parsed.data.reason ?? null,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.reorder",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    newValues: { entries: orderedProspectIds.length, reason: parsed.data.reason ?? null },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
  return {};
}

const directorRankSchema = z.object({
  organizationId: id,
  boardId: id,
  prospectId: id,
  rank: z.union([z.literal(""), z.coerce.number().int().min(1).max(500)]),
});

export async function setDirectorRankAction(formData: FormData): Promise<void> {
  const parsed = directorRankSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "finalize_boards");
  const rank = parsed.data.rank === "" ? null : parsed.data.rank;
  try {
    await setDirectorRank({
      boardId: parsed.data.boardId,
      prospectId: parsed.data.prospectId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      rank,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return;
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.director_rank",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    newValues: { prospectId: parsed.data.prospectId, rank },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
}

const entryFieldsSchema = z.object({
  organizationId: id,
  boardId: id,
  prospectId: id,
  expectedRound: z.union([z.literal(""), z.coerce.number().int().min(1).max(7)]).optional(),
  expectedRangeStart: z.union([z.literal(""), z.coerce.number().int().min(1).max(300)]).optional(),
  expectedRangeEnd: z.union([z.literal(""), z.coerce.number().int().min(1).max(300)]).optional(),
  risk: z.union([z.literal(""), z.enum(["low", "medium", "high"])]).optional(),
  floor: z.string().max(120).optional(),
  ceiling: z.string().max(120).optional(),
  recommendation: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export async function updateBoardEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = entryFieldsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_draft_boards");
  // Empty inputs mean "leave unchanged" — partial edits never wipe stored values.
  const fields: Record<string, string | number> = {};
  for (const key of ["expectedRound", "expectedRangeStart", "expectedRangeEnd", "risk", "floor", "ceiling", "recommendation", "notes"] as const) {
    const v = parsed.data[key];
    if (v !== undefined && v !== "") fields[key] = v;
  }
  if (Object.keys(fields).length === 0) return { error: "Fill at least one field to update" };
  try {
    await updateBoardEntry({
      boardId: parsed.data.boardId,
      prospectId: parsed.data.prospectId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      fields,
      // Board managers may still add notes/recommendations on a locked board.
      allowOnLocked: true,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.entry_update",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    newValues: { prospectId: parsed.data.prospectId, fields: Object.keys(fields) },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
  return {};
}

const statusSchema = z.object({
  organizationId: id,
  boardId: id,
  status: z.enum(["active", "locked", "archived"]),
});

export async function setBoardStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  // Locking finalizes the board; reactivating a locked board needs unlock rights.
  const capability =
    parsed.data.status === "locked" ? "finalize_boards" : parsed.data.status === "active" ? "unlock_boards" : "manage_draft_boards";
  const ctx = await requireOrgAccess(parsed.data.organizationId, capability);
  let previous: string;
  try {
    previous = (await getOwnedBoard(parsed.data.boardId, ctx.organizationId)).status;
    await setBoardStatus({
      boardId: parsed.data.boardId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      status: parsed.data.status,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return;
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: parsed.data.status === "locked" ? "board.lock" : parsed.data.status === "active" ? "board.unlock" : "board.archive",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    previousValues: { status: previous },
    newValues: { status: parsed.data.status },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
  revalidatePath("/scouting/board");
}

const scoutRankSchema = z.object({
  organizationId: id,
  boardId: id,
  prospectId: id,
  rank: z.coerce.number().int().min(1).max(500),
  notes: z.string().max(500).optional(),
});

export async function submitScoutRankingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = scoutRankSchema.safeParse({ ...raw, notes: raw.notes || undefined });
  if (!parsed.success) return { error: "Rank must be a whole number ≥ 1" };
  // Any scouting contributor may submit a personal ranking.
  const ctx = await requireOrgAccess(parsed.data.organizationId, "create_scouting_reports");
  try {
    await submitScoutRanking({
      boardId: parsed.data.boardId,
      prospectId: parsed.data.prospectId,
      organizationId: ctx.organizationId,
      scoutId: ctx.user.id,
      rank: parsed.data.rank,
      notes: parsed.data.notes ?? null,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "board.scout_ranking",
    entityType: "draft_board",
    entityId: parsed.data.boardId,
    newValues: { prospectId: parsed.data.prospectId, rank: parsed.data.rank },
  });
  revalidatePath(`/scouting/board/${parsed.data.boardId}`);
  return {};
}

/* ------------------------------------------------------------------ */
/* College free-agent boards                                           */
/* ------------------------------------------------------------------ */

const createCfaSchema = z.object({
  organizationId: id,
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
});

export async function createCfaBoardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createCfaSchema.safeParse({ ...raw, description: raw.description || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_cfa_boards");
  const board = await createCfaBoard({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    name: parsed.data.name.trim(),
    description: parsed.data.description ?? null,
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "cfa_board.create",
    entityType: "college_free_agent_board",
    entityId: board.id,
    newValues: { name: board.name },
  });
  revalidatePath("/scouting/free-agents");
  redirect(`/scouting/free-agents/${board.id}`);
}

const cfaStatusSchema = z.object({ organizationId: id, boardId: id, status: z.enum(["active", "archived"]) });

export async function setCfaBoardStatusAction(formData: FormData): Promise<void> {
  const parsed = cfaStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_cfa_boards");
  try {
    await setCfaBoardStatus({ boardId: parsed.data.boardId, organizationId: ctx.organizationId, status: parsed.data.status });
  } catch (err) {
    if (err instanceof ScoutingError) return;
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: parsed.data.status === "archived" ? "cfa_board.archive" : "cfa_board.unarchive",
    entityType: "college_free_agent_board",
    entityId: parsed.data.boardId,
    newValues: { status: parsed.data.status },
  });
  revalidatePath(`/scouting/free-agents/${parsed.data.boardId}`);
  revalidatePath("/scouting/free-agents");
}

const cfaAddSchema = z.object({ organizationId: id, boardId: id, prospectId: id });

export async function addCfaEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = cfaAddSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_cfa_boards");
  try {
    await addCfaEntry({ ...parsed.data, organizationId: ctx.organizationId, userId: ctx.user.id });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "cfa_board.entry_add",
    entityType: "college_free_agent_board",
    entityId: parsed.data.boardId,
    newValues: { prospectId: parsed.data.prospectId },
  });
  revalidatePath(`/scouting/free-agents/${parsed.data.boardId}`);
  return {};
}

const RELATIONSHIP = [
  "not_contacted", "researching", "initial_contact", "active_communication", "strong_interest",
  "mutual_interest", "offer_under_consideration", "signed_elsewhere", "signed_by_organization", "no_longer_pursuing",
] as const;

const cfaUpdateSchema = z.object({
  organizationId: id,
  boardId: id,
  entryId: id,
  nhlRightsStatus: z.enum(["unowned", "rights_held_by_other", "rights_held_by_us"]).optional(),
  remainingEligibility: z.string().max(60).optional(),
  expectedAvailability: isoDate.optional(),
  projectedAhlRole: z.string().max(80).optional(),
  projectedNhlRole: z.string().max(80).optional(),
  readiness: z.enum(["nhl_ready", "ahl_ready", "development_needed"]).optional(),
  marketCompetition: z.enum(["low", "medium", "high"]).optional(),
  agentName: z.string().max(120).optional(),
  relationshipStatus: z.enum(RELATIONSHIP).optional(),
  lastContactDate: isoDate.optional(),
  nextAction: z.string().max(300).optional(),
  nextActionDate: isoDate.optional(),
  assignedStaffId: id.optional(),
  recommendation: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  entryStatus: z.enum(["active", "archived"]).optional(),
});

export async function updateCfaEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (v !== "") clean[k] = v;
  const parsed = cfaUpdateSchema.safeParse(clean);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_cfa_boards");
  // Relationship/contact records and follow-up assignment are separately permissioned.
  const touchesContacts =
    parsed.data.relationshipStatus !== undefined || parsed.data.lastContactDate !== undefined || parsed.data.agentName !== undefined;
  const touchesFollowUp =
    parsed.data.nextAction !== undefined || parsed.data.nextActionDate !== undefined || parsed.data.assignedStaffId !== undefined;
  if (touchesContacts && !roleHasCapability(ctx.role, "manage_contacts")) {
    return { error: "Your role cannot manage relationship or contact records" };
  }
  if (touchesFollowUp && !roleHasCapability(ctx.role, "assign_followups")) {
    return { error: "Your role cannot assign follow-up actions" };
  }
  const { organizationId: _org, boardId, entryId, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) return { error: "Fill at least one field to update" };
  try {
    await updateCfaEntry({
      entryId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      fields: fields as Partial<Record<CfaField, string>>,
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "cfa_board.entry_update",
    entityType: "college_free_agent_board",
    entityId: boardId,
    newValues: { entryId, fields: Object.keys(fields) },
  });
  revalidatePath(`/scouting/free-agents/${boardId}`);
  revalidatePath("/scouting/free-agents");
  return {};
}

const cfaReorderSchema = z.object({ organizationId: id, boardId: id, order: z.string().min(1) });

export async function reorderCfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = cfaReorderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_cfa_boards");
  try {
    await reorderCfaPriorities({
      boardId: parsed.data.boardId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      orderedEntryIds: parsed.data.order.split(",").filter(Boolean),
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "cfa_board.reorder",
    entityType: "college_free_agent_board",
    entityId: parsed.data.boardId,
  });
  revalidatePath(`/scouting/free-agents/${parsed.data.boardId}`);
  return {};
}

/* ------------------------------------------------------------------ */
/* Meeting notes (either board kind)                                   */
/* ------------------------------------------------------------------ */

const noteSchema = z.object({
  organizationId: id,
  boardKind: z.enum(["draft", "college_free_agent"]),
  boardId: id,
  note: z.string().min(2).max(2000),
});

export async function addBoardNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = noteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Note must be at least 2 characters" };
  const isDraft = parsed.data.boardKind === "draft";
  const ctx = await requireOrgAccess(parsed.data.organizationId, isDraft ? "manage_draft_boards" : "manage_cfa_boards");
  try {
    if (isDraft) await getOwnedBoard(parsed.data.boardId, ctx.organizationId);
    else await getOwnedCfaBoard(parsed.data.boardId, ctx.organizationId);
  } catch {
    return { error: "Board not found" };
  }
  await getDb().insert(schema.boardMeetingNotes).values({
    organizationId: ctx.organizationId,
    boardKind: parsed.data.boardKind,
    boardId: parsed.data.boardId,
    authorId: ctx.user.id,
    note: parsed.data.note.trim(),
  });
  revalidatePath(isDraft ? `/scouting/board/${parsed.data.boardId}` : `/scouting/free-agents/${parsed.data.boardId}`);
  return {};
}
