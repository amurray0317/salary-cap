"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";
import { eq, and } from "drizzle-orm";

export interface FormState {
  error?: string;
}

const playerSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().min(2).max(120),
  position: z.enum(["C", "LW", "RW", "D", "G"]),
  dateOfBirth: z.string().optional(),
  shootsCatches: z.enum(["L", "R"]).optional(),
  nationality: z.string().max(60).optional(),
  teamId: z.string().optional(),
  rosterStatus: z.enum(schema.rosterStatus.enumValues).default("pro_active"),
  freeAgentStatus: z.enum(schema.freeAgentStatus.enumValues).default("under_contract"),
});

export async function createPlayerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = playerSchema.safeParse({
    ...raw,
    dateOfBirth: raw.dateOfBirth || undefined,
    shootsCatches: raw.shootsCatches || undefined,
    nationality: raw.nationality || undefined,
    teamId: raw.teamId || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;
  const ctx = await requireOrgAccess(input.organizationId, "edit_data");

  const db = getDb();
  if (input.teamId) {
    const team = await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.id, input.teamId), eq(schema.teams.organizationId, ctx.organizationId)))
      .limit(1);
    if (team.length === 0) return { error: "Team does not belong to this organization" };
  }

  const [player] = await db
    .insert(schema.players)
    .values({
      organizationId: ctx.organizationId,
      fullName: input.fullName,
      position: input.position,
      dateOfBirth: input.dateOfBirth ?? null,
      shootsCatches: input.shootsCatches ?? null,
      nationality: input.nationality ?? null,
      currentTeamId: input.teamId ?? null,
      rosterStatus: input.teamId ? input.rosterStatus : "non_roster",
      freeAgentStatus: input.teamId ? input.freeAgentStatus : parsed.data.freeAgentStatus,
      provenance: "user_entered",
    })
    .returning();
  if (!player) return { error: "Could not create player" };
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "player.create",
    entityType: "player",
    entityId: player.id,
    newValues: { fullName: player.fullName, position: player.position },
  });
  redirect(`/players/${player.id}`);
}
