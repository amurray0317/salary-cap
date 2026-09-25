"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ORG_ROLES } from "@/lib/auth/roles";
import { requireOrgAccess, requireUser } from "@/server/context";
import { ORG_COOKIE } from "@/server/appContext";
import { InviteError, acceptInvite, changeMemberRole, createInvite, removeMember, revokeInvite } from "@/server/services/inviteService";

export interface InviteFormState {
  error?: string;
  /** Path of the new invite link (shown once). */
  link?: string;
  expiresAt?: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const role = z.enum(ORG_ROLES);

export async function createInviteAction(_prev: InviteFormState, fd: FormData): Promise<InviteFormState> {
  const parsed = z
    .object({
      organizationId: z.string().uuid(),
      role,
      email: z.string().email().optional().or(z.literal("")),
      days: z.coerce.number().int().min(1).max(30),
      maxUses: z.coerce.number().int().min(1).max(25),
    })
    .safeParse({
      organizationId: str(fd, "organizationId"),
      role: str(fd, "role"),
      email: str(fd, "email"),
      days: str(fd, "days") || 7,
      maxUses: str(fd, "maxUses") || 1,
    });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "admin");
  try {
    const { token, expiresAt } = await createInvite({
      organizationId: ctx.organizationId,
      actorId: ctx.user.id,
      actorRole: ctx.role,
      role: parsed.data.role,
      email: parsed.data.email || null,
      days: parsed.data.days,
      maxUses: parsed.data.maxUses,
    });
    revalidatePath("/settings");
    return { link: `/invite/${token}`, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    if (err instanceof InviteError) return { error: err.message };
    throw err;
  }
}

async function adminCall(fd: FormData, fn: (ctx: Awaited<ReturnType<typeof requireOrgAccess>>) => Promise<void>) {
  const ctx = await requireOrgAccess(str(fd, "organizationId"), "admin");
  try {
    await fn(ctx);
  } catch (err) {
    if (!(err instanceof InviteError)) throw err;
    redirect(`/settings?error=${encodeURIComponent(err.message)}`);
  }
  revalidatePath("/settings");
}

export async function revokeInviteAction(fd: FormData): Promise<void> {
  await adminCall(fd, (ctx) => revokeInvite({ organizationId: ctx.organizationId, actorId: ctx.user.id, inviteId: str(fd, "inviteId") }));
}

export async function changeMemberRoleAction(fd: FormData): Promise<void> {
  const r = role.safeParse(str(fd, "role"));
  if (!r.success) redirect("/settings?error=Unknown%20role");
  await adminCall(fd, (ctx) =>
    changeMemberRole({ organizationId: ctx.organizationId, actorId: ctx.user.id, actorRole: ctx.role, memberId: str(fd, "memberId"), role: r.data }),
  );
}

export async function removeMemberAction(fd: FormData): Promise<void> {
  await adminCall(fd, (ctx) =>
    removeMember({ organizationId: ctx.organizationId, actorId: ctx.user.id, actorRole: ctx.role, memberId: str(fd, "memberId") }),
  );
}

export async function acceptInviteAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const token = str(fd, "token");
  let orgId: string;
  try {
    orgId = await acceptInvite({ token, userId: user.id, userEmail: user.email });
  } catch (err) {
    if (err instanceof InviteError) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}
