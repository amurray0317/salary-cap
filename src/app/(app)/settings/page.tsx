import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();

  const members = await db
    .select({
      id: schema.organizationMembers.id,
      role: schema.organizationMembers.role,
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

      <Card title="Members & roles">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line/50 last:border-0">
                <Td>{m.fullName}</Td>
                <Td className="text-ink-secondary">{m.email}</Td>
                <Td className="text-ink-secondary">{m.role.replace(/_/g, " ")}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-muted">
          Roles gate capabilities server-side: viewers read, analysts edit data, GMs manage teams,
          admins manage rules and members. Invitation flow is on the roadmap.
        </p>
      </Card>

      <Card title="Audit history (latest 50)">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-navy-900">
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
