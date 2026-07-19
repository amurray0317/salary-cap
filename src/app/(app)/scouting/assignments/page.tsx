import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { createAssignmentAction } from "@/server/actions/scoutingActions";
import { AssignmentForm } from "@/components/ScoutingForms";
import { Card, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Scouting assignments" };

export default async function AssignmentsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const assignments = await db
    .select({
      a: schema.scoutingAssignments,
      prospectName: schema.amateurProspects.fullName,
      scoutName: schema.users.fullName,
    })
    .from(schema.scoutingAssignments)
    .leftJoin(schema.amateurProspects, eq(schema.scoutingAssignments.prospectId, schema.amateurProspects.id))
    .leftJoin(schema.users, eq(schema.scoutingAssignments.scoutId, schema.users.id))
    .where(eq(schema.scoutingAssignments.organizationId, ctx.org.id))
    .orderBy(desc(schema.scoutingAssignments.createdAt));

  const prospects = await db
    .select({ id: schema.amateurProspects.id, name: schema.amateurProspects.fullName })
    .from(schema.amateurProspects)
    .where(eq(schema.amateurProspects.organizationId, ctx.org.id))
    .orderBy(asc(schema.amateurProspects.fullName))
    .limit(400);

  const canAssign = roleHasCapability(ctx.role, "assign_scouts");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Scouting assignments</h1>
      {canAssign ? (
        <Card title="New assignment">
          <AssignmentForm action={createAssignmentAction} organizationId={ctx.org.id} prospects={prospects} />
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Only directors and GMs can assign scouts; your assignments appear below.</p>
      )}
      <Card title={`Assignments (${assignments.length})`}>
        {assignments.length === 0 ? (
          <p className="text-sm text-ink-muted">No assignments yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Type</Th>
                <Th>Target</Th>
                <Th>Scout</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(({ a, prospectName, scoutName }) => (
                <tr key={a.id} className="border-b border-line/50 last:border-0">
                  <Td>{a.assignmentType.replace(/_/g, " ")}</Td>
                  <Td className="text-ink-secondary">{prospectName ?? a.region ?? "—"}</Td>
                  <Td className="text-ink-secondary">{scoutName ?? "Unassigned"}</Td>
                  <Td className="text-ink-secondary">{a.dueDate ? formatDate(a.dueDate) : "—"}</Td>
                  <Td>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${a.status === "complete" ? "bg-good/10 text-good" : a.status === "open" ? "bg-navy-800 text-ink-secondary" : "bg-accent-soft text-accent-text"}`}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </Td>
                  <Td className="max-w-64 truncate text-ink-muted">{a.notes ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
