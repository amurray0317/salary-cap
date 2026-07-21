"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";
import { runFitForNeed } from "@/server/services/fitService";
import { ScoutingError } from "@/server/services/scoutingService";

export interface FormState {
  error?: string;
}

/** Report-section keys a need may set 20–80 grade floors for. */
const GRADE_KEYS = ["skating", "hockey_sense", "puck_skills", "compete", "defensive_play"] as const;

const gradeField = z.coerce.number().int().min(20).max(80).optional();

const needSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  position: z.enum(["C", "LW", "RW", "D", "G", "F"]),
  secondaryPosition: z.enum(["C", "LW", "RW", "D", "G", "F"]).optional(),
  handedness: z.enum(["L", "R"]).optional(),
  targetRoleKey: z.string().max(80).optional(),
  targetScoutRoleKey: z.string().max(80).optional(),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  timelineYears: z.coerce.number().int().min(0).max(6).default(3),
  earliestArrivalYears: z.coerce.number().int().min(0).max(6).default(0),
  latestArrivalYears: z.coerce.number().int().min(0).max(8).default(4),
  targetArrivalSeason: z.string().max(20).optional(),
  preferredAcquisition: z.enum(["draft", "college_fa", "trade", "any"]).default("draft"),
  maxRiskTolerance: z.enum(["low", "medium", "high"]).default("medium"),
  sizePreference: z.enum(["no_preference", "prefers_size", "prefers_mobility"]).optional(),
  specialTeamsRequirement: z.enum(["pp", "pk", "none"]).optional(),
  nhlRosterNeed: z.coerce.boolean().default(false),
  ahlOpportunity: z.coerce.boolean().default(true),
  notes: z.string().max(2000).optional(),
  min_skating: gradeField,
  min_hockey_sense: gradeField,
  min_puck_skills: gradeField,
  min_compete: gradeField,
  min_defensive_play: gradeField,
});

function parseNeedForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const clean: Record<string, unknown> = { ...raw };
  // Empty selects/inputs mean "unset", not empty-string enum values.
  for (const k of [
    "secondaryPosition", "handedness", "targetRoleKey", "targetScoutRoleKey", "targetArrivalSeason",
    "sizePreference", "specialTeamsRequirement", "description", "notes",
    "min_skating", "min_hockey_sense", "min_puck_skills", "min_compete", "min_defensive_play",
  ]) {
    if (clean[k] === "") clean[k] = undefined;
  }
  clean.nhlRosterNeed = raw.nhlRosterNeed === "on" || raw.nhlRosterNeed === "true";
  clean.ahlOpportunity = raw.ahlOpportunity === "on" || raw.ahlOpportunity === "true";
  return needSchema.safeParse(clean);
}

function needValues(data: z.infer<typeof needSchema>, userId: string) {
  if (data.earliestArrivalYears > data.latestArrivalYears) {
    throw new ScoutingError("Earliest arrival cannot be after latest arrival");
  }
  return {
    name: data.name.trim(),
    description: data.description || null,
    position: data.position,
    secondaryPosition: data.secondaryPosition ?? null,
    handedness: data.handedness ?? null,
    targetRoleKey: data.targetRoleKey ?? null,
    targetScoutRoleKey: data.targetScoutRoleKey ?? null,
    priority: data.priority,
    timelineYears: data.timelineYears,
    earliestArrivalYears: data.earliestArrivalYears,
    latestArrivalYears: data.latestArrivalYears,
    targetArrivalSeason: data.targetArrivalSeason || null,
    preferredAcquisition: data.preferredAcquisition,
    maxRiskTolerance: data.maxRiskTolerance,
    sizePreference: data.sizePreference ?? null,
    specialTeamsRequirement: data.specialTeamsRequirement ?? null,
    nhlRosterNeed: data.nhlRosterNeed,
    ahlOpportunity: data.ahlOpportunity,
    notes: data.notes || null,
    createdBy: userId,
    updatedAt: new Date(),
  };
}

async function replaceGradeRequirements(needId: string, data: z.infer<typeof needSchema>) {
  const db = getDb();
  await db
    .delete(schema.organizationalNeedRequirements)
    .where(
      and(
        eq(schema.organizationalNeedRequirements.needId, needId),
        eq(schema.organizationalNeedRequirements.requirementType, "min_grade"),
      ),
    );
  const rows = GRADE_KEYS.map((key) => ({ key, min: data[`min_${key}` as const] })).filter(
    (r): r is { key: (typeof GRADE_KEYS)[number]; min: number } => r.min !== undefined,
  );
  if (rows.length > 0) {
    await db.insert(schema.organizationalNeedRequirements).values(
      rows.map((r) => ({ needId, requirementType: "min_grade", key: r.key, minValue: r.min })),
    );
  }
}

export async function createNeedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseNeedForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_org_needs");
  const db = getDb();
  let needId: string;
  try {
    const [need] = await db
      .insert(schema.organizationalNeeds)
      .values({ organizationId: ctx.organizationId, ...needValues(parsed.data, ctx.user.id) })
      .returning();
    if (!need) return { error: "Could not create need" };
    needId = need.id;
    await replaceGradeRequirements(need.id, parsed.data);
    await writeAudit({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      action: "scouting.need_create",
      entityType: "organizational_need",
      entityId: need.id,
      newValues: { name: need.name, position: need.position, targetRoleKey: need.targetRoleKey, priority: need.priority },
    });
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  revalidatePath("/scouting/needs");
  redirect(`/scouting/needs/${needId}`);
}

const updateSchema = needSchema.extend({ needId: z.string().uuid() });

export async function updateNeedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = updateSchema.safeParse({
    ...Object.fromEntries(formData.entries()),
    ...Object.fromEntries(
      Object.entries(Object.fromEntries(formData.entries())).map(([k, v]) => [k, v === "" ? undefined : v]),
    ),
    nhlRosterNeed: formData.get("nhlRosterNeed") === "on" || formData.get("nhlRosterNeed") === "true",
    ahlOpportunity: formData.get("ahlOpportunity") === "on" || formData.get("ahlOpportunity") === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_org_needs");
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(
      and(
        eq(schema.organizationalNeeds.id, parsed.data.needId),
        eq(schema.organizationalNeeds.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!existing) return { error: "Need not found" };
  try {
    const { createdBy: _createdBy, ...values } = needValues(parsed.data, ctx.user.id);
    await db.update(schema.organizationalNeeds).set(values).where(eq(schema.organizationalNeeds.id, existing.id));
    await replaceGradeRequirements(existing.id, parsed.data);
  } catch (err) {
    if (err instanceof ScoutingError) return { error: err.message };
    throw err;
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scouting.need_update",
    entityType: "organizational_need",
    entityId: existing.id,
    previousValues: { name: existing.name, position: existing.position, priority: existing.priority },
    newValues: { name: parsed.data.name, position: parsed.data.position, priority: parsed.data.priority },
  });
  revalidatePath("/scouting/needs");
  revalidatePath(`/scouting/needs/${existing.id}`);
  return {};
}

const archiveSchema = z.object({
  organizationId: z.string().uuid(),
  needId: z.string().uuid(),
});

/** Toggles a need between active and archived. */
export async function archiveNeedAction(formData: FormData): Promise<void> {
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_org_needs");
  const db = getDb();
  const [need] = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(
      and(
        eq(schema.organizationalNeeds.id, parsed.data.needId),
        eq(schema.organizationalNeeds.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!need) return;
  await db
    .update(schema.organizationalNeeds)
    .set({ isActive: !need.isActive, updatedAt: new Date() })
    .where(eq(schema.organizationalNeeds.id, need.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: need.isActive ? "scouting.need_archive" : "scouting.need_unarchive",
    entityType: "organizational_need",
    entityId: need.id,
    previousValues: { isActive: need.isActive },
    newValues: { isActive: !need.isActive },
  });
  revalidatePath("/scouting/needs");
  revalidatePath(`/scouting/needs/${need.id}`);
}

const runSchema = z.object({
  organizationId: z.string().uuid(),
  needId: z.string().uuid(),
});

/** Runs the fit model for every eligible prospect against one need. */
export async function runFitAction(formData: FormData): Promise<void> {
  const parsed = runSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "run_fit_models");
  try {
    const result = await runFitForNeed(parsed.data.needId, ctx.organizationId, ctx.user.id);
    await writeAudit({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      action: "scouting.fit_run",
      entityType: "fit_calculation_run",
      entityId: result.runId,
      newValues: {
        needId: parsed.data.needId,
        modelVersion: result.modelVersion,
        evaluated: result.evaluated,
        scored: result.scored,
        weightsSource: result.weightsSource,
      },
    });
  } catch (err) {
    if (err instanceof ScoutingError) return; // isolation failure: silently no-op like other void actions
    throw err;
  }
  revalidatePath(`/scouting/needs/${parsed.data.needId}`);
  revalidatePath("/scouting/needs");
  revalidatePath("/scouting/fit");
}
