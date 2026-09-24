import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { createDraftBoardAction } from "@/server/actions/boardActions";
import { CreateDraftBoardForm } from "@/components/BoardForms";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Draft boards" };

export default async function DraftBoardsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await resolveAppContext();
  const { show } = await searchParams;
  const db = getDb();
  const boards = await db
    .select({
      b: schema.draftBoards,
      entryCount: sql<number>`(select count(*)::int from ${schema.draftBoardEntries} where ${schema.draftBoardEntries.boardId} = ${schema.draftBoards.id})`,
    })
    .from(schema.draftBoards)
    .where(and(eq(schema.draftBoards.organizationId, ctx.org.id), eq(schema.draftBoards.boardType, "draft")))
    .orderBy(desc(schema.draftBoards.draftYear), desc(schema.draftBoards.createdAt));
  const showArchived = show === "archived";
  const visible = boards.filter((r) => (r.b.status === "archived") === showArchived);
  const canManage = roleHasCapability(ctx.role, "manage_draft_boards");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Draft boards</h1>
          <p className="text-sm text-ink-muted">
            Five ranking sources stay separate — working order, statistical model, scout consensus, organizational
            fit, and the director&rsquo;s final call. Every change is versioned with an immutable snapshot.
          </p>
        </div>
        <Link href={showArchived ? "/scouting/board" : "/scouting/board?show=archived"} className="text-sm text-accent-text hover:underline">
          {showArchived ? "← Active boards" : "Archived boards →"}
        </Link>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={showArchived ? "No archived boards" : "No draft boards"}
          body={showArchived ? "Archived boards appear here." : "Create one below to start ranking draft-eligible prospects."}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Board</Th>
                  <Th right>Draft year</Th>
                  <Th right>Prospects</Th>
                  <Th>Status</Th>
                  <Th right>Version</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ b, entryCount }) => (
                  <tr key={b.id} className="border-b border-line/50 last:border-0 hover:bg-subtle">
                    <Td>
                      <Link href={`/scouting/board/${b.id}`} className="font-medium hover:text-accent-text">{b.name}</Link>
                      {b.description && <p className="text-xs text-ink-muted">{b.description}</p>}
                    </Td>
                    <Td right>{b.draftYear ?? "—"}</Td>
                    <Td right>{entryCount}</Td>
                    <Td>
                      <span className={b.status === "locked" ? "text-warn" : b.status === "archived" ? "text-ink-muted" : "text-good"}>
                        {b.status === "locked" ? "🔒 locked" : b.status}
                      </span>
                    </Td>
                    <Td right className="text-ink-secondary">v{b.version}</Td>
                    <Td className="text-xs text-ink-muted">{formatDate(b.updatedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage && (
        <Card title="Create a draft board">
          <CreateDraftBoardForm action={createDraftBoardAction} organizationId={ctx.org.id} />
        </Card>
      )}
    </div>
  );
}
