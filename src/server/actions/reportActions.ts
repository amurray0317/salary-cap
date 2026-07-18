"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAccess } from "@/server/context";
import {
  generateRosterShareReport,
  revokeShareReport,
  ReportError,
} from "@/server/services/reportService";

export interface FormState {
  error?: string;
}

const createSchema = z.object({
  organizationId: z.string().uuid(),
  teamId: z.string().uuid(),
  seasonId: z.string().uuid(),
});

export async function createShareLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  try {
    await generateRosterShareReport({
      organizationId: ctx.organizationId,
      teamId: parsed.data.teamId,
      seasonId: parsed.data.seasonId,
      userId: ctx.user.id,
    });
  } catch (err) {
    if (err instanceof ReportError) return { error: err.message };
    throw err;
  }
  revalidatePath("/reports");
  return {};
}

const revokeSchema = z.object({
  organizationId: z.string().uuid(),
  reportId: z.string().uuid(),
});

export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  try {
    await revokeShareReport({
      reportId: parsed.data.reportId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
    });
  } catch (err) {
    if (err instanceof ReportError) return;
    throw err;
  }
  revalidatePath("/reports");
}
