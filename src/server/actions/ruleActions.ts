"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  ruleId: z.string().uuid(),
  numericValue: z.coerce.number(),
});

/**
 * Rule edits never overwrite: the current row is deactivated and a new row is
 * inserted with version+1, keeping the full version history queryable.
 */
export async function updateRuleAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "admin");
  const db = getDb();
  const [rule] = await db
    .select()
    .from(schema.leagueRules)
    .where(and(eq(schema.leagueRules.id, parsed.data.ruleId), eq(schema.leagueRules.isActive, true)))
    .limit(1);
  if (!rule) return;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.leagueRules)
      .set({ isActive: false, notes: `${rule.notes ?? ""} [superseded by v${rule.ruleVersion + 1}]`.trim() })
      .where(eq(schema.leagueRules.id, rule.id));
    const [next] = await tx
      .insert(schema.leagueRules)
      .values({
        leagueId: rule.leagueId,
        seasonId: rule.seasonId,
        ruleKey: rule.ruleKey,
        ruleName: rule.ruleName,
        ruleCategory: rule.ruleCategory,
        numericValue: Math.round(parsed.data.numericValue),
        textValue: rule.textValue,
        calculationMethod: rule.calculationMethod,
        effectiveDate: new Date().toISOString().slice(0, 10),
        sourceId: rule.sourceId,
        ruleVersion: rule.ruleVersion + 1,
        isActive: true,
        notes: `Updated by ${ctx.user.fullName}`,
      })
      .returning();
    if (next) {
      await tx.insert(schema.ruleVersions).values({
        ruleId: next.id,
        version: next.ruleVersion,
        numericValue: next.numericValue,
        textValue: next.textValue,
        changedBy: ctx.user.id,
        changeReason: "Manual update via League rules page",
      });
    }
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "rule.update",
    entityType: "league_rule",
    entityId: rule.id,
    previousValues: { numericValue: rule.numericValue, version: rule.ruleVersion },
    newValues: { numericValue: Math.round(parsed.data.numericValue), version: rule.ruleVersion + 1 },
  });
  revalidatePath("/rules");
  revalidatePath("/dashboard");
}
