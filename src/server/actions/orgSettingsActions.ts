"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, writeAudit } from "@/server/context";
import { PROGRAMS, PROGRAM_IDS } from "@/lib/programs";

/** Admins only: which kind of program this organization runs (changes what the app shows). */
export async function setProgramAction(fd: FormData): Promise<void> {
  const parsed = z
    .object({ organizationId: z.string().uuid(), program: z.enum(PROGRAM_IDS as [string, ...string[]]) })
    .safeParse({ organizationId: fd.get("organizationId"), program: fd.get("program") });
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent("Choose a program type")}`);
  const { organizationId, program } = parsed.data!;
  const ctx = await requireOrgAccess(organizationId, "admin");
  const db = getDb();
  const [before] = await db
    .select({ program: schema.organizations.program })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId));
  await db.update(schema.organizations).set({ program }).where(eq(schema.organizations.id, organizationId));
  await writeAudit({
    organizationId,
    userId: ctx.user.id,
    action: "organization.program",
    entityType: "organization",
    entityId: organizationId,
    previousValues: { program: before?.program },
    newValues: { program },
  });
  revalidatePath("/", "layout");
  redirect(`/settings?saved=${encodeURIComponent(`Program set to ${PROGRAMS[program as keyof typeof PROGRAMS].label}`)}`);
}
