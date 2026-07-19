import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { moveBoardEntryAction } from "@/server/actions/scoutingActions";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Draft board" };

export default async function DraftBoardPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const boards = await db
    .select()
    .from(schema.draftBoards)
    .where(and(eq(schema.draftBoards.organizationId, ctx.org.id), eq(schema.draftBoards.boardType, "draft")));
  const canManage = roleHasCapability(ctx.role, "manage_draft_boards");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Draft board</h1>
        <p className="text-sm text-ink-muted">
          Model rank and scout rank are displayed side by side — disagreements are shown, never
          averaged away. Add prospects from their profiles.
        </p>
      </div>
      {boards.length === 0 ? (
        <EmptyState title="No draft board" body="The seed creates one; add prospects from their profiles." />
      ) : (
        await Promise.all(
          boards.map(async (board) => {
            const entries = await db
              .select({ e: schema.draftBoardEntries, p: schema.amateurProspects })
              .from(schema.draftBoardEntries)
              .innerJoin(schema.amateurProspects, eq(schema.draftBoardEntries.prospectId, schema.amateurProspects.id))
              .where(eq(schema.draftBoardEntries.boardId, board.id))
              .orderBy(asc(schema.draftBoardEntries.overallRank));
            return (
              <Card key={board.id} title={`${board.name}${board.draftYear ? ` · ${board.draftYear}` : ""} (${entries.length} prospects)`}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line">
                        <Th right>Rank</Th>
                        <Th>Prospect</Th>
                        <Th>Pos</Th>
                        <Th right>Model rank</Th>
                        <Th right>Scout rank</Th>
                        <Th right>Δ</Th>
                        <Th>Risk</Th>
                        <Th>Recommendation</Th>
                        {canManage && <Th>Move</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(({ e, p }) => {
                        const delta = e.modelRank !== null && e.scoutRank !== null ? e.scoutRank - e.modelRank : null;
                        return (
                          <tr key={e.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                            <Td right className="font-medium">{e.overallRank}</Td>
                            <Td><Link href={`/scouting/players/${p.id}`} className="font-medium hover:text-accent-text">{p.fullName}</Link></Td>
                            <Td>{p.position}</Td>
                            <Td right className="text-ink-secondary">{e.modelRank ?? "—"}</Td>
                            <Td right className="text-ink-secondary">{e.scoutRank ?? "—"}</Td>
                            <Td right className={delta !== null && Math.abs(delta) >= 3 ? "text-warn" : "text-ink-muted"}>
                              {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                            </Td>
                            <Td className={e.risk === "high" ? "text-critical" : e.risk === "low" ? "text-good" : "text-warn"}>{e.risk ?? "—"}</Td>
                            <Td className="text-ink-secondary">{e.recommendation ?? "—"}</Td>
                            {canManage && (
                              <Td>
                                <div className="flex gap-1">
                                  <form action={moveBoardEntryAction}>
                                    <input type="hidden" name="organizationId" value={ctx.org.id} />
                                    <input type="hidden" name="entryId" value={e.id} />
                                    <input type="hidden" name="direction" value="up" />
                                    <button className="rounded border border-line px-1.5 text-xs text-ink-secondary hover:text-ink" aria-label={`Move ${p.fullName} up`}>↑</button>
                                  </form>
                                  <form action={moveBoardEntryAction}>
                                    <input type="hidden" name="organizationId" value={ctx.org.id} />
                                    <input type="hidden" name="entryId" value={e.id} />
                                    <input type="hidden" name="direction" value="down" />
                                    <button className="rounded border border-line px-1.5 text-xs text-ink-secondary hover:text-ink" aria-label={`Move ${p.fullName} down`}>↓</button>
                                  </form>
                                </div>
                              </Td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Δ = scout rank − model rank; gaps of 3+ are flagged for review rather than hidden.
                </p>
              </Card>
            );
          }),
        )
      )}
    </div>
  );
}
