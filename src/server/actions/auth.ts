"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, setSessionCookie } from "@/lib/auth/session";
import { writeAudit } from "@/server/context";

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
  redirect("/onboarding");
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
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
