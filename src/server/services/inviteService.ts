/**
 * Invitations and membership management.
 *
 * Rules:
 *  - Nobody can grant a role above their own tier (league_admin only by a
 *    league_admin).
 *  - An organization always keeps at least one org_admin: the last one
 *    cannot be demoted or removed.
 *  - Invite links carry a random token; only its SHA-256 is stored. A link
 *    works while it is not revoked, not expired and under its use limit,
 *    and, when the invite names an email, only for that email.
 *  - Every change is written to the audit log.
 */
import { createHash, randomBytes } from "crypto";
import { and, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { ORG_ROLES, roleTier, type OrgRole } from "@/lib/auth/roles";

type AuditEntry = {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValues?: unknown;
  newValues?: unknown;
};

// Same audit table as every other service (written directly, like importService).
async function writeAudit(e: AuditEntry, db: Pick<ReturnType<typeof getDb>, "insert"> = getDb()) {
  await db.insert(schema.auditLogs).values({
    organizationId: e.organizationId,
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    previousValues: e.previousValues ?? null,
    newValues: e.newValues ?? null,
  });
}

export class InviteError extends Error {}

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_DEFAULT_DAYS = 7;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

function assertCanGrant(actorRole: OrgRole, role: OrgRole) {
  if (!ORG_ROLES.includes(role)) throw new InviteError("Unknown role");
  if (role === "league_admin" && actorRole !== "league_admin") throw new InviteError("Only a league admin can grant league admin");
  if (roleTier(role) > roleTier(actorRole)) throw new InviteError("You cannot grant a role above your own");
}

export async function createInvite(opts: {
  organizationId: string;
  actorId: string;
  actorRole: OrgRole;
  role: OrgRole;
  email?: string | null;
  days?: number;
  maxUses?: number;
  now?: Date;
}): Promise<{ token: string; inviteId: string; expiresAt: Date }> {
  assertCanGrant(opts.actorRole, opts.role);
  const days = opts.days ?? INVITE_DEFAULT_DAYS;
  const maxUses = opts.maxUses ?? 1;
  if (!(days >= 1 && days <= 30)) throw new InviteError("Invites last 1 to 30 days");
  if (!(maxUses >= 1 && maxUses <= 25)) throw new InviteError("An invite can be used 1 to 25 times");
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date((opts.now ?? new Date()).getTime() + days * DAY);
  const email = opts.email?.trim().toLowerCase() || null;
  const [row] = await getDb()
    .insert(schema.organizationInvites)
    .values({
      organizationId: opts.organizationId,
      role: opts.role,
      tokenHash: hashInviteToken(token),
      email,
      createdBy: opts.actorId,
      expiresAt,
      maxUses,
    })
    .returning();
  await writeAudit({
    organizationId: opts.organizationId,
    userId: opts.actorId,
    action: "invite.create",
    entityType: "organization_invite",
    entityId: row!.id,
    newValues: { role: opts.role, email, expiresAt: expiresAt.toISOString(), maxUses },
  });
  return { token, inviteId: row!.id, expiresAt };
}

export async function listOpenInvites(organizationId: string, now = new Date()) {
  const t = schema.organizationInvites;
  return getDb()
    .select({ id: t.id, role: t.role, email: t.email, createdAt: t.createdAt, expiresAt: t.expiresAt, uses: t.uses, maxUses: t.maxUses })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), isNull(t.revokedAt), gt(t.expiresAt, now), lt(t.uses, t.maxUses)))
    .orderBy(t.createdAt);
}

export async function revokeInvite(opts: { organizationId: string; actorId: string; inviteId: string; now?: Date }) {
  const t = schema.organizationInvites;
  const res = await getDb()
    .update(t)
    .set({ revokedAt: opts.now ?? new Date() })
    .where(and(eq(t.id, opts.inviteId), eq(t.organizationId, opts.organizationId), isNull(t.revokedAt)))
    .returning();
  if (res.length === 0) throw new InviteError("Invite not found or already revoked");
  await writeAudit({
    organizationId: opts.organizationId,
    userId: opts.actorId,
    action: "invite.revoke",
    entityType: "organization_invite",
    entityId: opts.inviteId,
  });
}

export type InviteStatus = "valid" | "expired" | "revoked" | "used" | "not_found";

/** Public view of an invite link (for the join page): never exposes other invites or members. */
export async function lookupInvite(token: string, now = new Date()) {
  const t = schema.organizationInvites;
  const rows = await getDb()
    .select({ invite: t, orgName: schema.organizations.name })
    .from(t)
    .innerJoin(schema.organizations, eq(schema.organizations.id, t.organizationId))
    .where(eq(t.tokenHash, hashInviteToken(token)))
    .limit(1);
  const r = rows[0];
  if (!r) return { status: "not_found" as InviteStatus };
  const status: InviteStatus = r.invite.revokedAt
    ? "revoked"
    : r.invite.expiresAt <= now
      ? "expired"
      : r.invite.uses >= r.invite.maxUses
        ? "used"
        : "valid";
  return { status, orgName: r.orgName, role: r.invite.role, email: r.invite.email, organizationId: r.invite.organizationId };
}

/** Joins the invited organization with the invite's role. Returns the organization id. */
export async function acceptInvite(opts: { token: string; userId: string; userEmail: string; now?: Date }): Promise<string> {
  const db = getDb();
  const t = schema.organizationInvites;
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(t)
      .where(eq(t.tokenHash, hashInviteToken(opts.token)))
      .limit(1);
    if (!inv) throw new InviteError("This invite link is not valid");
    if (inv.revokedAt) throw new InviteError("This invite was revoked");
    if (inv.expiresAt <= now) throw new InviteError("This invite has expired");
    if (inv.email && inv.email !== opts.userEmail.toLowerCase()) throw new InviteError("This invite is for a different email address");
    const m = schema.organizationMembers;
    const existing = await tx
      .select({ id: m.id })
      .from(m)
      .where(and(eq(m.organizationId, inv.organizationId), eq(m.userId, opts.userId)))
      .limit(1);
    if (existing.length) throw new InviteError("You are already a member of this organization");
    // Count the use atomically: fails if another acceptance took the last use.
    const claimed = await tx
      .update(t)
      .set({ uses: sql`${t.uses} + 1` })
      .where(and(eq(t.id, inv.id), lt(t.uses, t.maxUses), isNull(t.revokedAt)))
      .returning();
    if (claimed.length === 0) throw new InviteError("This invite has already been used");
    await tx.insert(m).values({ organizationId: inv.organizationId, userId: opts.userId, role: inv.role, invitedBy: inv.createdBy });
    await writeAudit(
      {
        organizationId: inv.organizationId,
        userId: opts.userId,
        action: "invite.accept",
        entityType: "organization_invite",
        entityId: inv.id,
        newValues: { role: inv.role },
      },
      tx,
    );
    return inv.organizationId;
  });
}

async function adminCount(organizationId: string) {
  const m = schema.organizationMembers;
  const [row] = await getDb()
    .select({ n: count() })
    .from(m)
    .where(and(eq(m.organizationId, organizationId), eq(m.role, "org_admin")));
  return row?.n ?? 0;
}

async function member(organizationId: string, memberId: string) {
  const m = schema.organizationMembers;
  const [row] = await getDb()
    .select()
    .from(m)
    .where(and(eq(m.id, memberId), eq(m.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new InviteError("Member not found");
  return row;
}

export async function changeMemberRole(opts: { organizationId: string; actorId: string; actorRole: OrgRole; memberId: string; role: OrgRole }) {
  const target = await member(opts.organizationId, opts.memberId);
  assertCanGrant(opts.actorRole, opts.role);
  if (roleTier(target.role) > roleTier(opts.actorRole)) throw new InviteError("You cannot change the role of someone senior to you");
  if (target.role === "org_admin" && opts.role !== "org_admin" && (await adminCount(opts.organizationId)) <= 1) {
    throw new InviteError("The organization needs at least one admin");
  }
  const m = schema.organizationMembers;
  await getDb().update(m).set({ role: opts.role }).where(eq(m.id, target.id));
  await writeAudit({
    organizationId: opts.organizationId,
    userId: opts.actorId,
    action: "member.role_change",
    entityType: "organization_member",
    entityId: target.id,
    previousValues: { role: target.role },
    newValues: { role: opts.role },
  });
}

export async function removeMember(opts: { organizationId: string; actorId: string; actorRole: OrgRole; memberId: string }) {
  const target = await member(opts.organizationId, opts.memberId);
  if (roleTier(target.role) > roleTier(opts.actorRole)) throw new InviteError("You cannot remove someone senior to you");
  if (target.role === "org_admin" && (await adminCount(opts.organizationId)) <= 1) throw new InviteError("The organization needs at least one admin");
  const m = schema.organizationMembers;
  await getDb().delete(m).where(eq(m.id, target.id));
  await writeAudit({
    organizationId: opts.organizationId,
    userId: opts.actorId,
    action: "member.remove",
    entityType: "organization_member",
    entityId: target.id,
    previousValues: { role: target.role, userId: target.userId },
  });
}

/** REGISTRATION_MODE=invite_only: new accounts need a valid invite link. Default: open. */
export function registrationMode(env: Record<string, string | undefined> = process.env): "open" | "invite_only" {
  return env.REGISTRATION_MODE === "invite_only" ? "invite_only" : "open";
}
