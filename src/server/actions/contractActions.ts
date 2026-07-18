"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";

export interface FormState {
  error?: string;
}

const contractSchema = z.object({
  organizationId: z.string().uuid(),
  playerId: z.string().uuid(),
  teamId: z.string().uuid(),
  contractType: z.enum(schema.contractType.enumValues).default("one_way"),
  signedDate: z.string().optional(),
});

const seasonRow = z.object({
  seasonId: z.string().uuid(),
  capHit: z.number().int().nonnegative(),
  baseSalary: z.number().int().nonnegative(),
  performanceBonus: z.number().int().nonnegative().default(0),
  minorLeagueSalary: z.number().int().nonnegative().nullable().default(null),
});

/**
 * Creates a contract with per-season salary schedule rows. Season rows come
 * in as capHit_<seasonId> / base_<seasonId> / bonus_<seasonId> form fields;
 * blank cap-hit fields mean the contract does not cover that season.
 */
export async function createContractAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = contractSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;
  const ctx = await requireOrgAccess(input.organizationId, "edit_data");
  const db = getDb();

  // Ownership checks: player and team must belong to this organization.
  const [player] = await db
    .select()
    .from(schema.players)
    .where(and(eq(schema.players.id, input.playerId), eq(schema.players.organizationId, ctx.organizationId)))
    .limit(1);
  if (!player) return { error: "Player not found in this organization" };
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, input.teamId), eq(schema.teams.organizationId, ctx.organizationId)))
    .limit(1);
  if (!team) return { error: "Team not found in this organization" };

  const seasons = await db
    .select()
    .from(schema.leagueSeasons)
    .where(eq(schema.leagueSeasons.leagueId, team.leagueId));

  const rows: Array<z.infer<typeof seasonRow>> = [];
  for (const season of seasons) {
    const rawHit = formData.get(`capHit_${season.id}`);
    if (rawHit === null || rawHit === "") continue;
    const capHit = Number(rawHit);
    const baseSalary = Number(formData.get(`base_${season.id}`) || rawHit);
    const performanceBonus = Number(formData.get(`bonus_${season.id}`) || 0);
    const minor = formData.get(`minor_${season.id}`);
    const parsedRow = seasonRow.safeParse({
      seasonId: season.id,
      capHit,
      baseSalary,
      performanceBonus,
      minorLeagueSalary: minor === null || minor === "" ? null : Number(minor),
    });
    if (!parsedRow.success) return { error: `Invalid figures for ${season.name}` };
    rows.push(parsedRow.data);
  }
  if (rows.length === 0) return { error: "Enter a cap hit for at least one season" };

  // Duplicate guard: one active contract per player.
  const existing = await db
    .select({ id: schema.contracts.id })
    .from(schema.contracts)
    .where(and(eq(schema.contracts.playerId, input.playerId), eq(schema.contracts.contractStatus, "active")))
    .limit(1);
  if (existing.length > 0) {
    return { error: "This player already has an active contract. Terminate it before adding another." };
  }

  const seasonById = new Map(seasons.map((s) => [s.id, s]));
  const covered = rows
    .map((r) => seasonById.get(r.seasonId))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const first = covered[0];
  const last = covered[covered.length - 1];
  if (!first || !last) return { error: "Invalid season selection" };

  const totalValue = rows.reduce((sum, r) => sum + r.baseSalary + r.performanceBonus, 0);
  const totalCapHit = rows.reduce((sum, r) => sum + r.capHit, 0);
  const aav = Math.round(totalCapHit / rows.length);

  const contractId = await db.transaction(async (tx) => {
    const [contract] = await tx
      .insert(schema.contracts)
      .values({
        organizationId: ctx.organizationId,
        playerId: input.playerId,
        teamId: input.teamId,
        leagueId: team.leagueId,
        contractType: input.contractType,
        contractStatus: "active",
        signedDate: input.signedDate || null,
        startDate: first.startDate,
        endDate: last.endDate,
        totalValue,
        averageAnnualValue: aav,
        guaranteedValue: totalValue,
        provenance: "user_entered",
        createdBy: ctx.user.id,
      })
      .returning();
    if (!contract) throw new Error("Contract insert failed");
    await tx.insert(schema.contractSeasons).values(
      rows.map((r) => ({
        contractId: contract.id,
        seasonId: r.seasonId,
        baseSalary: r.baseSalary,
        performanceBonus: r.performanceBonus,
        totalCash: r.baseSalary + r.performanceBonus,
        capHit: r.capHit,
        minorLeagueSalary: r.minorLeagueSalary,
      })),
    );
    // Player joins the team when a contract is added.
    await tx
      .update(schema.players)
      .set({
        currentTeamId: input.teamId,
        freeAgentStatus: "under_contract",
        rosterStatus: player.currentTeamId ? player.rosterStatus : "pro_active",
        updatedAt: new Date(),
      })
      .where(eq(schema.players.id, input.playerId));
    return contract.id;
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "contract.create",
    entityType: "contract",
    entityId: contractId,
    newValues: { playerId: input.playerId, teamId: input.teamId, aav, seasons: rows.length },
  });
  redirect(`/players/${input.playerId}`);
}

const statusSchema = z.object({
  organizationId: z.string().uuid(),
  playerId: z.string().uuid(),
  rosterStatus: z.enum(schema.rosterStatus.enumValues),
});

/** Official roster move: changes a player's roster status (call-up, demotion, IR…). */
export async function setPlayerStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const db = getDb();
  const [player] = await db
    .select()
    .from(schema.players)
    .where(and(eq(schema.players.id, parsed.data.playerId), eq(schema.players.organizationId, ctx.organizationId)))
    .limit(1);
  if (!player) return;
  await db
    .update(schema.players)
    .set({ rosterStatus: parsed.data.rosterStatus, updatedAt: new Date() })
    .where(eq(schema.players.id, player.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "player.status_change",
    entityType: "player",
    entityId: player.id,
    previousValues: { rosterStatus: player.rosterStatus },
    newValues: { rosterStatus: parsed.data.rosterStatus },
  });
  redirect(`/players/${player.id}`);
}

const terminateSchema = z.object({
  organizationId: z.string().uuid(),
  contractId: z.string().uuid(),
});

/** Marks a contract terminated (official data change, audited). */
export async function terminateContractAction(formData: FormData): Promise<void> {
  const parsed = terminateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  const db = getDb();
  const [contract] = await db
    .select()
    .from(schema.contracts)
    .where(
      and(
        eq(schema.contracts.id, parsed.data.contractId),
        eq(schema.contracts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!contract) return;
  await db
    .update(schema.contracts)
    .set({ contractStatus: "terminated", updatedAt: new Date() })
    .where(eq(schema.contracts.id, contract.id));
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "contract.terminate",
    entityType: "contract",
    entityId: contract.id,
    previousValues: { contractStatus: contract.contractStatus },
    newValues: { contractStatus: "terminated" },
  });
  redirect(`/players/${contract.playerId}`);
}
