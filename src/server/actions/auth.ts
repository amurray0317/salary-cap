"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, setSessionCookie } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { readPreferences } from "@/lib/preferences";
import { writeAudit } from "@/server/context";
import { ORG_COOKIE } from "@/server/appContext";
import { InviteError, acceptInvite, canRegisterWithoutInvite, lookupInvite } from "@/server/services/inviteService";

const registerSchema = z.object({
  fullName: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Enter a valid email").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export interface AuthFormState {
  error?: string;
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const invite = String(formData.get("invite") ?? "").trim();
  if (invite) {
    const info = await lookupInvite(invite);
    if (info.status !== "valid") return { error: "This invite link is no longer valid. Ask for a new one." };
    if (info.email && info.email !== parsed.data.email) return { error: "This invite is for a different email address." };
  } else if (!(await canRegisterWithoutInvite())) {
    return { error: "New accounts need an invite link from an organization admin." };
  }
  const db = getDb();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);
  if (existing.length > 0) {
    return { error: "An account with that email already exists" };
  }
  const [user] = await db
    .insert(schema.users)
    .values({
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      passwordHash: hashPassword(parsed.data.password),
    })
    .returning();
  if (!user) return { error: "Registration failed" };
  await writeAudit({
    organizationId: null,
    userId: user.id,
    action: "user.register",
    entityType: "user",
    entityId: user.id,
  });
  const token = await createSession(user.id);
  await setSessionCookie(token);
  if (invite) {
    try {
      const orgId = await acceptInvite({ token: invite, userId: user.id, userEmail: user.email });
      (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
      redirect("/dashboard");
    } catch (err) {
      // Account exists either way; the join page explains what went wrong.
      if (err instanceof InviteError) redirect(`/invite/${encodeURIComponent(invite)}`);
      throw err;
    }
  }
  redirect("/onboarding");
}

/** Only same-site paths under /invite/ are accepted as a post-login destination. */
function safeNext(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "");
  return /^\/invite\/[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password" };
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);
  const user = rows[0];
  if (!user?.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash) || !user.isActive) {
    return { error: "Invalid email or password" };
  }
  const token = await createSession(user.id);
  await setSessionCookie(token);
  redirect(safeNext(formData.get("next")) ?? readPreferences(user.preferences).startPage);
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
