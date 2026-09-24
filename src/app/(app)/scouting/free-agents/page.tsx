import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getFollowUps } from "@/server/services/boardService";
import { createCfaBoardAction } from "@/server/actions/boardActions";
import { CreateCfaBoardForm } from "@/components/BoardForms";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "College free-agent boards" };

export default async function CfaBoardsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const ctx = await resolveAppContext();
  const { mine } = await searchParams;
  const db = getDb();
  const boards = await db
    .select({
      b: schema.collegeFreeAgentBoards,
      entryCount: sql<number>`(select count(*)::int from ${schema.collegeFreeAgentEntries} where ${schema.collegeFreeAgentEntries.boardId} = ${schema.collegeFreeAgentBoards.id})`,
    })
    .from(schema.collegeFreeAgentBoards)
    .where(eq(schema.collegeFreeAgentBoards.organizationId, ctx.org.id))
    .orderBy(desc(schema.collegeFreeAgentBoards.createdAt));

  const allFollowUps = await getFollowUps(ctx.org.id);
  const followUps = mine === "1" ? allFollowUps.filter((f) => f.e.assignedStaffId === ctx.user.id) : allFollowUps;
  const today = new Date().toISOString().slice(0, 10);
  const canManage = roleHasCapability(ctx.role, "manage_cfa_boards");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">College free-agent boards</h1>
        <p className="text-sm text-ink-muted">
          Signing priorities, rights and eligibility tracking, the relationship pipeline, and follow-up actions for
          undrafted NCAA targets. Agent, relationship, and contact records are private to your organization.
        </p>
      </div>

      <Card title={`Follow-up actions (${followUps.length}${mine === "1" ? " assigned to me" : ""})`}>
        <div className="mb-2 text-sm">
          {mine === "1" ? (
            <Link href="/scouting/free-agents" className="text-accent-text hover:underline">Show everyone&rsquo;s</Link>
          ) : (
            <Link href="/scouting/free-agents?mine=1" className="text-accent-text hover:underline">Show only mine</Link>
          )}
        </div>
        {followUps.length === 0 ? (
          <p className="text-sm text-ink-muted">No follow-up actions scheduled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Due</Th>
                  <Th>Prospect</Th>
                  <Th>Action</Th>
                  <Th>Assigned to</Th>
                  <Th>Board</Th>
                  <Th>Relationship</Th>
                </tr>
              </thead>
              <tbody>
                {followUps.slice(0, 20).map((f) => {
                  const overdue = f.e.nextActionDate! < today;
                  return (
                    <tr key={f.e.id} className="border-b border-line/50 last:border-0 hover:bg-subtle">
                      <Td className={overdue ? "font-medium text-critical" : "text-ink-secondary"}>
                        {formatDate(f.e.nextActionDate)}{overdue && " (overdue)"}
                      </Td>
                      <Td><Link href={`/scouting/players/${f.p.id}`} className="font-medium hover:text-accent-text">{f.p.fullName}</Link></Td>
                      <Td className="max-w-56 truncate text-ink-secondary">{f.e.nextAction ?? "—"}</Td>
                      <Td className="text-ink-secondary">{f.staffName ?? "unassigned"}</Td>
                      <Td><Link href={`/scouting/free-agents/${f.boardId}`} className="text-accent-text hover:underline">{f.boardName}</Link></Td>
                      <Td className="text-ink-secondary">{f.e.relationshipStatus.replace(/_/g, " ")}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {boards.length === 0 ? (
        <EmptyState title="No CFA boards" body="Create one below to start tracking undrafted signing targets." />
      ) : (
        <Card title="Boards">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Board</Th>
                  <Th right>Candidates</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {boards.map(({ b, entryCount }) => (
                  <tr key={b.id} className={`border-b border-line/50 last:border-0 hover:bg-subtle ${b.status === "archived" ? "opacity-60" : ""}`}>
                    <Td>
                      <Link href={`/scouting/free-agents/${b.id}`} className="font-medium hover:text-accent-text">{b.name}</Link>
                      {b.description && <p className="text-xs text-ink-muted">{b.description}</p>}
                    </Td>
                    <Td right>{entryCount}</Td>
                    <Td className="text-ink-secondary">{b.status}</Td>
                    <Td className="text-xs text-ink-muted">{formatDate(b.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage && (
        <Card title="Create a college free-agent board">
          <CreateCfaBoardForm action={createCfaBoardAction} organizationId={ctx.org.id} />
        </Card>
      )}
    </div>
  );
}
