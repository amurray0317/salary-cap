/**
 * Invitations and membership rules (PGlite, real migrations).
 */
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import {
  InviteError,
  acceptInvite,
  changeMemberRole,
  createInvite,
  listOpenInvites,
  lookupInvite,
  registrationMode,
  removeMember,
  revokeInvite,
} from "@/server/services/inviteService";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { org: string; admin: string; scout: string; newbie: string; other: string };

async function user(email: string) {
  const [u] = await db.insert(schema.users).values({ email, fullName: email }).returning();
  return u!.id;
}
const membership = async (userId: string) =>
  (
    await db
      .select()
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.organizationId, fx.org), eq(schema.organizationMembers.userId, userId)))
  )[0];

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  fx.admin = await user("admin@t.test");
  fx.scout = await user("scout@t.test");
  fx.newbie = await user("new@t.test");
  fx.other = await user("other@t.test");
  const [org] = await db.insert(schema.organizations).values({ name: "Org", slug: "org-inv" }).returning();
  fx.org = org!.id;
  await db.insert(schema.organizationMembers).values([
    { organizationId: fx.org, userId: fx.admin, role: "org_admin" },
    { organizationId: fx.org, userId: fx.scout, role: "scout" },
  ]);
});

afterAll(async () => {
  await pg.close();
});

describe("invites", () => {
  it("an admin invites with a role; the link joins exactly once, with that role", async () => {
    const { token } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "analyst" });
    expect(await lookupInvite(token)).toMatchObject({ status: "valid", orgName: "Org", role: "analyst" });
    const orgId = await acceptInvite({ token, userId: fx.newbie, userEmail: "new@t.test" });
    expect(orgId).toBe(fx.org);
    expect((await membership(fx.newbie))!.role).toBe("analyst");
    expect((await lookupInvite(token)).status).toBe("used");
    await expect(acceptInvite({ token, userId: fx.other, userEmail: "other@t.test" })).rejects.toThrow(/already been used/);
    // Only the hash is stored.
    const rows = await db.select().from(schema.organizationInvites);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("nobody grants a role above their own", async () => {
    await expect(createInvite({ organizationId: fx.org, actorId: fx.scout, actorRole: "scout", role: "general_manager" })).rejects.toThrow(
      InviteError,
    );
    await expect(createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "league_admin" })).rejects.toThrow(
      /league admin/,
    );
  });

  it("expired, revoked and wrong-email invites are refused", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const expired = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "viewer", days: 1, now });
    await expect(
      acceptInvite({ token: expired.token, userId: fx.other, userEmail: "other@t.test", now: new Date("2026-10-03T00:00:00Z") }),
    ).rejects.toThrow(/expired/);

    const revoked = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "viewer" });
    await revokeInvite({ organizationId: fx.org, actorId: fx.admin, inviteId: revoked.inviteId });
    await expect(acceptInvite({ token: revoked.token, userId: fx.other, userEmail: "other@t.test" })).rejects.toThrow(/revoked/);
    expect((await listOpenInvites(fx.org)).some((i) => i.id === revoked.inviteId)).toBe(false);

    const locked = await createInvite({
      organizationId: fx.org,
      actorId: fx.admin,
      actorRole: "org_admin",
      role: "viewer",
      email: "Someone@Else.test",
    });
    await expect(acceptInvite({ token: locked.token, userId: fx.other, userEmail: "other@t.test" })).rejects.toThrow(/different email/);
    expect(await lookupInvite("not-a-real-token")).toEqual({ status: "not_found" });
  });

  it("existing members cannot join twice", async () => {
    const { token } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "viewer" });
    await expect(acceptInvite({ token, userId: fx.scout, userEmail: "scout@t.test" })).rejects.toThrow(/already a member/);
  });
});

describe("members", () => {
  it("roles change within the actor's authority, and the last admin is protected", async () => {
    const newbie = (await membership(fx.newbie))!;
    await changeMemberRole({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", memberId: newbie.id, role: "assistant_gm" });
    expect((await membership(fx.newbie))!.role).toBe("assistant_gm");
    // A scout cannot promote or remove someone senior.
    await expect(
      changeMemberRole({ organizationId: fx.org, actorId: fx.scout, actorRole: "scout", memberId: newbie.id, role: "viewer" }),
    ).rejects.toThrow(/senior/);
    const admin = (await membership(fx.admin))!;
    await expect(
      changeMemberRole({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", memberId: admin.id, role: "viewer" }),
    ).rejects.toThrow(/at least one admin/);
    await expect(removeMember({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", memberId: admin.id })).rejects.toThrow(
      /at least one admin/,
    );
    await removeMember({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", memberId: newbie.id });
    expect(await membership(fx.newbie)).toBeUndefined();
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, fx.org));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["invite.create", "invite.accept", "invite.revoke", "member.role_change", "member.remove"]),
    );
  });

  it("registration is open unless REGISTRATION_MODE=invite_only", () => {
    expect(registrationMode({})).toBe("open");
    expect(registrationMode({ REGISTRATION_MODE: "invite_only" })).toBe("invite_only");
  });
});
