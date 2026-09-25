import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, Td, Th } from "@/components/ui";
import { InviteForm } from "@/components/InviteForm";
import { ORG_ROLES, roleHasCapability, roleTier } from "@/lib/auth/roles";
import { listOpenInvites, registrationMode } from "@/server/services/inviteService";
import { changeMemberRoleAction, removeMemberAction, revokeInviteAction } from "@/server/actions/inviteActions";

export const metadata: Metadata = { title: "Settings" };

const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await resolveAppContext();
  const { error } = await searchParams;
  const db = getDb();
  const isAdmin = roleHasCapability(ctx.role, "admin");
  // Roles this admin may grant: at or below their own tier; league admin only by a league admin.
  const grantable = ORG_ROLES.filter((r) => roleTier(r) <= roleTier(ctx.role) && (r !== "league_admin" || ctx.role === "league_admin"))
    .sort((a, b) => roleTier(a) - roleTier(b))
    .map((r) => ({ value: r, label: label(r) }));
  const invites = isAdmin ? await listOpenInvites(ctx.org.id) : [];

  const members = await db
    .select({
      id: schema.organizationMembers.id,
      role: schema.organizationMembers.role,
      userId: schema.organizationMembers.userId,
      fullName: schema.users.fullName,
      email: schema.users.email,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.organizationMembers.userId, schema.users.id))
    .where(eq(schema.organizationMembers.organizationId, ctx.org.id));

  const audit = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.organizationId, ctx.org.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Organization settings — {ctx.org.name}</h1>

      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}

      {isAdmin && (
        <Card title="Invite people">
          <InviteForm organizationId={ctx.org.id} roles={grantable} />
          <p className="mt-3 text-xs text-ink-muted">
            People who open the link create a login (or sign in) and join {ctx.org.name} with the role you picked. You can only grant roles up to your
            own. {registrationMode() === "invite_only" ? "Sign-up is invite-only." : "Sign-up is open: set REGISTRATION_MODE=invite_only on the server to allow only invited people."}
          </p>
          {invites.length > 0 && (
            <table className="mt-4 w-full">
              <thead>
                <tr>
                  <Th>Open invite</Th>
                  <Th>For</Th>
                  <Th>Uses</Th>
                  <Th>Expires</Th>
                  <Th right> </Th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b border-line/50 last:border-0">
                    <Td>{label(i.role)}</Td>
                    <Td className="text-ink-secondary">{i.email ?? "anyone with the link"}</Td>
                    <Td className="tabular-nums">
                      {i.uses} / {i.maxUses}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-secondary">{i.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC</Td>
                    <Td right>
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="organizationId" value={ctx.org.id} />
                        <input type="hidden" name="inviteId" value={i.id} />
                        <button className="text-xs font-medium text-critical hover:underline">Revoke</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card title="Members & roles">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                {isAdmin && <Th right> </Th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === ctx.user.id;
                const editable = isAdmin && roleTier(m.role) <= roleTier(ctx.role);
                return (
                  <tr key={m.id} className="border-b border-line/50 last:border-0">
                    <Td>
                      {m.fullName}
                      {self && <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10px] font-semibold uppercase text-accent-text">you</span>}
                    </Td>
                    <Td className="text-ink-secondary">{m.email}</Td>
                    <Td>
                      {editable ? (
                        <form action={changeMemberRoleAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="organizationId" value={ctx.org.id} />
                          <input type="hidden" name="memberId" value={m.id} />
                          <select name="role" defaultValue={m.role} className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                            {grantable.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <button className="text-xs font-medium text-accent-text hover:underline">Save</button>
                        </form>
                      ) : (
                        <span className="text-ink-secondary">{label(m.role)}</span>
                      )}
                    </Td>
                    {isAdmin && (
                      <Td right>
                        {editable && !self && (
                          <form action={removeMemberAction}>
                            <input type="hidden" name="organizationId" value={ctx.org.id} />
                            <input type="hidden" name="memberId" value={m.id} />
                            <button className="text-xs font-medium text-critical hover:underline">Remove</button>
                          </form>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Roles gate what each person can do, checked on the server: viewers read; scouts and coaches add reports and notes; analysts edit data; GMs,
          AGMs and scouting directors manage teams and boards; admins manage members and settings. The organization always keeps at least one admin.
        </p>
      </Card>

      <Card title="Audit history (latest 50)">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line">
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b border-line/50 last:border-0">
                  <Td className="whitespace-nowrap text-ink-muted">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Td>
                  <Td>{a.action}</Td>
                  <Td className="text-ink-secondary">{a.entityType}</Td>
                  <Td className="max-w-md truncate text-xs text-ink-muted">
                    {a.newValues ? JSON.stringify(a.newValues) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
