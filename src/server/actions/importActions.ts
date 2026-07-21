"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAccess } from "@/server/context";
import { IMPORT_DEFINITIONS, isImportType } from "@/lib/import/definitions";
import {
  commitImport,
  createImport,
  ImportError,
  rejectImport,
  validateImport,
} from "@/server/services/importService";

export interface FormState {
  error?: string;
}

export async function uploadImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const importType = String(formData.get("importType") ?? "");
  const file = formData.get("file");
  if (!z.string().uuid().safeParse(organizationId).success) return { error: "Invalid organization" };
  if (!isImportType(importType)) return { error: "Unknown import type" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to upload" };
  if (file.size > 1_000_000) return { error: "File is larger than 1 MB" };

  const ctx = await requireOrgAccess(organizationId, "edit_data");
  const csvText = await file.text();
  let importId: string;
  try {
    const result = await createImport({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      importType,
      fileName: file.name,
      csvText,
    });
    importId = result.importId;
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    throw err;
  }
  redirect(`/imports/${importId}`);
}

export async function applyMappingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ organizationId: z.string().uuid(), importId: z.string().uuid(), importType: z.string() })
    .safeParse({
      organizationId: formData.get("organizationId"),
      importId: formData.get("importId"),
      importType: formData.get("importType"),
    });
  if (!parsed.success || !isImportType(parsed.data.importType)) return { error: "Invalid input" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");

  const mapping: Record<string, string> = {};
  for (const field of IMPORT_DEFINITIONS[parsed.data.importType].fields) {
    const value = formData.get(`map_${field.key}`);
    if (typeof value === "string" && value !== "") mapping[field.key] = value;
  }
  try {
    await validateImport({
      importId: parsed.data.importId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      mapping,
    });
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/imports/${parsed.data.importId}`);
  return {};
}

const refSchema = z.object({ organizationId: z.string().uuid(), importId: z.string().uuid() });

export async function approveImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = refSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };
  if (formData.get("confirm") !== "yes") return { error: "Confirmation missing" };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  try {
    await commitImport({
      importId: parsed.data.importId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
    });
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/imports/${parsed.data.importId}`);
  revalidatePath("/imports");
  revalidatePath("/players");
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  return {};
}

export async function rejectImportAction(formData: FormData): Promise<void> {
  const parsed = refSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  try {
    await rejectImport({
      importId: parsed.data.importId,
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
    });
  } catch (err) {
    if (!(err instanceof ImportError)) throw err;
  }
  revalidatePath(`/imports/${parsed.data.importId}`);
  revalidatePath("/imports");
}
