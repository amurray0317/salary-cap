"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";
import { scenarioPayloadSchema, payloadKindToTransactionType, type ScenarioPayload } from "@/lib/scenario/payloads";

export interface FormState {
  error?: string;
}

async function requireScenario(scenarioId: string, organizationId: string) {
  const db = getDb();
  const [scenario] = await db
    .select()
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.id, scenarioId), eq(schema.scenarios.organizationId, organizationId)))
    .limit(1);
  return scenario ?? null;
}

const createSchema = z.object({
  organizationId: z.string().uuid(),
  teamId: z.string().uuid(),
  baseSeasonId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
});

export async function createScenarioAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const db = getDb();
  const [team] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.id, parsed.data.teamId), eq(schema.teams.organizationId, ctx.organizationId)))
    .limit(1);
  if (!team) return { error: "Team not found in this organization" };
  const [scenario] = await db
    .insert(schema.scenarios)
    .values({
      organizationId: ctx.organizationId,
      teamId: parsed.data.teamId,
      baseSeasonId: parsed.data.baseSeasonId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: "draft",
      createdBy: ctx.user.id,
    })
    .returning();
  if (!scenario) return { error: "Could not create scenario" };
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scenario.create",
    entityType: "scenario",
    entityId: scenario.id,
    newValues: { name: scenario.name },
  });
  redirect(`/scenarios/${scenario.id}`);
}

/**
 * Builds a typed payload from the transaction form. The form posts
 * kind-specific fields; season figures arrive as season_<name> inputs.
 */
function buildPayload(formData: FormData): { payload?: ScenarioPayload; error?: string } {
  const kind = String(formData.get("kind") ?? "");
  const seasonEntries: Array<{ seasonName: string; capHit: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("season_") && value !== "") {
      const capHit = Number(value);
      if (!Number.isFinite(capHit) || capHit < 0) return { error: `Invalid cap hit for ${key.slice(7)}` };
      if (capHit > 0) seasonEntries.push({ seasonName: key.slice(7), capHit: Math.round(capHit) });
    }
  }
  const contractId = String(formData.get("contractId") ?? "");
  const playerName = String(formData.get("playerName") ?? "").trim();
  const position = String(formData.get("position") ?? "C");
  const retainedPct = Number(formData.get("retainedPct") ?? 0) / 100;

  const raw: Record<string, unknown> = (() => {
    switch (kind) {
      case "sign_free_agent":
        return { kind, playerName, position, isTwoWay: formData.get("isTwoWay") === "on", seasons: seasonEntries };
      case "trade_in":
        return { kind, playerName, position, retainedByOthersPct: retainedPct, seasons: seasonEntries };
      case "trade_out":
        return { kind, contractId, retainedPct };
      case "call_up":
      case "send_down":
        return { kind, contractId };
      case "ir_placement":
        return { kind, contractId, longTerm: formData.get("longTerm") === "on" };
      case "extension":
        return { kind, contractId, seasons: seasonEntries };
      case "buyout":
        return { kind, contractId, deadCapFraction: 2 / 3 };
      default:
        return { kind };
    }
  })();

  const parsed = scenarioPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `Invalid transaction: ${issue?.path.join(".")} ${issue?.message}` };
  }
  return { payload: parsed.data };
}

const addTxSchema = z.object({
  organizationId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  label: z.string().min(1).max(200),
});

export async function addScenarioTransactionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = addTxSchema.safeParse({
    organizationId: formData.get("organizationId"),
    scenarioId: formData.get("scenarioId"),
    label: formData.get("label") || "Untitled move",
  });
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return { error: "Scenario not found" };
  if (scenario.status === "archived" || scenario.status === "applied") {
    return { error: "This scenario is read-only (archived or applied)" };
  }

  const { payload, error } = buildPayload(formData);
  if (error || !payload) return { error: error ?? "Invalid transaction" };

  const db = getDb();
  const [last] = await db
    .select({ sortOrder: schema.scenarioTransactions.sortOrder })
    .from(schema.scenarioTransactions)
    .where(eq(schema.scenarioTransactions.scenarioId, scenario.id))
    .orderBy(desc(schema.scenarioTransactions.sortOrder))
    .limit(1);

  await db.insert(schema.scenarioTransactions).values({
    scenarioId: scenario.id,
    sortOrder: (last?.sortOrder ?? -1) + 1,
    transactionType: payloadKindToTransactionType[payload.kind] as (typeof schema.transactionType.enumValues)[number],
    label: parsed.data.label,
    payload,
  });
  await db
    .update(schema.scenarios)
    .set({ updatedAt: new Date() })
    .where(eq(schema.scenarios.id, scenario.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scenario.transaction_add",
    entityType: "scenario",
    entityId: scenario.id,
    newValues: { label: parsed.data.label, kind: payload.kind },
  });
  revalidatePath(`/scenarios/${scenario.id}`);
  return {};
}

const txRefSchema = z.object({
  organizationId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  transactionId: z.string().uuid(),
});

export async function removeScenarioTransactionAction(formData: FormData): Promise<void> {
  const parsed = txRefSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return;
  const db = getDb();
  await db
    .delete(schema.scenarioTransactions)
    .where(
      and(
        eq(schema.scenarioTransactions.id, parsed.data.transactionId),
        eq(schema.scenarioTransactions.scenarioId, scenario.id),
      ),
    );
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scenario.transaction_remove",
    entityType: "scenario",
    entityId: scenario.id,
    previousValues: { transactionId: parsed.data.transactionId },
  });
  revalidatePath(`/scenarios/${scenario.id}`);
}

export async function toggleScenarioTransactionAction(formData: FormData): Promise<void> {
  const parsed = txRefSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.scenarioTransactions)
    .where(
      and(
        eq(schema.scenarioTransactions.id, parsed.data.transactionId),
        eq(schema.scenarioTransactions.scenarioId, scenario.id),
      ),
    )
    .limit(1);
  if (!row) return;
  await db
    .update(schema.scenarioTransactions)
    .set({ isEnabled: !row.isEnabled })
    .where(eq(schema.scenarioTransactions.id, row.id));
  revalidatePath(`/scenarios/${scenario.id}`);
}

const statusSchema = z.object({
  organizationId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  status: z.enum(schema.scenarioStatus.enumValues),
});

export async function setScenarioStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return;
  const db = getDb();
  await db
    .update(schema.scenarios)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(schema.scenarios.id, scenario.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scenario.status_change",
    entityType: "scenario",
    entityId: scenario.id,
    previousValues: { status: scenario.status },
    newValues: { status: parsed.data.status },
  });
  revalidatePath(`/scenarios/${scenario.id}`);
  revalidatePath("/scenarios");
}

const dupSchema = z.object({
  organizationId: z.string().uuid(),
  scenarioId: z.string().uuid(),
});

export async function duplicateScenarioAction(formData: FormData): Promise<void> {
  const parsed = dupSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return;
  const db = getDb();
  const txs = await db
    .select()
    .from(schema.scenarioTransactions)
    .where(eq(schema.scenarioTransactions.scenarioId, scenario.id))
    .orderBy(asc(schema.scenarioTransactions.sortOrder));
  const newId = await db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(schema.scenarios)
      .values({
        organizationId: scenario.organizationId,
        teamId: scenario.teamId,
        baseSeasonId: scenario.baseSeasonId,
        name: `${scenario.name} (copy)`,
        description: scenario.description,
        status: "draft",
        createdBy: ctx.user.id,
      })
      .returning();
    if (!copy) throw new Error("duplicate failed");
    for (const t of txs) {
      await tx.insert(schema.scenarioTransactions).values({
        scenarioId: copy.id,
        sortOrder: t.sortOrder,
        transactionType: t.transactionType,
        label: t.label,
        payload: t.payload,
        isEnabled: t.isEnabled,
        notes: t.notes,
      });
    }
    return copy.id;
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "scenario.duplicate",
    entityType: "scenario",
    entityId: newId,
    previousValues: { sourceScenarioId: scenario.id },
  });
  redirect(`/scenarios/${newId}`);
}

const applySchema = z.object({
  organizationId: z.string().uuid(),
  scenarioId: z.string().uuid(),
  confirm: z.literal("yes"),
});

/**
 * Applies a scenario to official records. Requires the manage_team
 * capability, an explicit confirmation field, and a projection free of
 * blocking violations — the same gate the preview page shows.
 */
export async function applyScenarioAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = applySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Confirmation missing" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "manage_team");
  const scenario = await requireScenario(parsed.data.scenarioId, ctx.organizationId);
  if (!scenario) return { error: "Scenario not found" };

  // Re-run the projection server-side; never trust the page state.
  const { getScenarioProjection } = await import("@/server/services/scenarioService");
  const projection = await getScenarioProjection(scenario.id);
  const baseIdx = Math.max(0, projection.seasons.findIndex((s) => s.id === scenario.baseSeasonId));
  const projected = projection.projectedResults[baseIdx];
  if (projected && projected.violations.length > 0) {
    return {
      error: `Cannot apply: the projected roster has ${projected.violations.length} blocking violation(s). Resolve them in the scenario first.`,
    };
  }
  if (projection.invalidTransactions.length > 0) {
    return { error: "Cannot apply: the scenario contains transactions with invalid payloads." };
  }

  const { applyScenario, ApplyError } = await import("@/server/services/applyService");
  try {
    await applyScenario(getDb(), {
      scenarioId: scenario.id,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
    });
  } catch (err) {
    if (err instanceof ApplyError) return { error: err.message };
    throw err;
  }
  revalidatePath("/dashboard");
  revalidatePath("/players");
  revalidatePath("/contracts");
  revalidatePath("/transactions");
  revalidatePath(`/scenarios/${scenario.id}`);
  redirect(`/scenarios/${scenario.id}?applied=1`);
}
