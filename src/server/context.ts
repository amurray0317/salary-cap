/**
 * Server-side authorization context.
 *
 * EVERY service call that reads or writes organization data goes through
 * requireOrgAccess, which verifies membership and role server-side. This is
 * the primary tenancy boundary in local mode; in a Supabase deployment the
 * RLS policies in supabase/policies.sql add a second, database-level layer.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this organization or action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export { roleHasCapability } from "@/lib/auth/roles";
export type { OrgRole, Capability } from "@/lib/auth/roles";
import { roleHasCapability as hasCapability, type Capability, type OrgRole } from "@/lib/auth/roles";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  return user;
}

export interface OrgContext {
  user: SessionUser;
  organizationId: string;
  role: OrgRole;
}

export async function requireOrgAccess(
  organizationId: string,
  capability: Capability = "read",
): Promise<OrgContext> {
  const user = await requireUser();
  const db = getDb();
  const rows = await db
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.userId, user.id),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership) throw new ForbiddenError();
  if (!hasCapability(membership.role, capability)) {
    throw new ForbiddenError(`Your role (${membership.role}) cannot perform this action`);
  }
  return { user, organizationId, role: membership.role };
}

export async function writeAudit(entry: {
  organizationId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValues?: unknown;
  newValues?: unknown;
  reason?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.auditLogs).values({
    organizationId: entry.organizationId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    previousValues: entry.previousValues ?? null,
    newValues: entry.newValues ?? null,
    reason: entry.reason ?? null,
  });
}
