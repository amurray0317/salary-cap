import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "College free agents" };

export default async function CollegeFreeAgentsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();

  const boards = await db
    .select()
    .from(schema.draftBoards)
    .where(and(eq(schema.draftBoards.organizationId, ctx.org.id), eq(schema.draftBoards.boardType, "college_free_agent")));
  const board = boards[0];
  const entries = board
    ? await db
        .select({ e: schema.draftBoardEntries, p: schema.amateurProspects, schoolName: schema.schools.name })
        .from(schema.draftBoardEntries)
        .innerJoin(schema.amateurProspects, eq(schema.draftBoardEntries.prospectId, schema.amateurProspects.id))
        .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
        .where(eq(schema.draftBoardEntries.boardId, board.id))
        .orderBy(asc(schema.draftBoardEntries.overallRank))
    : [];

  const eligible = await db
    .select({ p: schema.amateurProspects, schoolName: schema.schools.name })
    .from(schema.amateurProspects)
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(
      and(
        eq(schema.amateurProspects.organizationId, ctx.org.id),
        eq(schema.amateurProspects.collegeFreeAgentStatus, "eligible"),
      ),
    )
    .orderBy(asc(schema.amateurProspects.fullName));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">College free agents</h1>
        <p className="text-sm text-ink-muted">
          Undrafted NCAA players whose rights are unheld. Signing priority lives on the CFA board;
          eligibility below is tracked per prospect.
        </p>
      </div>

      {board && entries.length > 0 && (
        <Card title={`${board.name} (${entries.length})`}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th right>Priority</Th>
                <Th>Prospect</Th>
                <Th>Pos</Th>
                <Th>School</Th>
                <Th>Class</Th>
                <Th>Agent</Th>
                <Th>Recommendation</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ e, p, schoolName }) => (
                <tr key={e.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td right className="font-medium">{e.overallRank}</Td>
                  <Td><Link href={`/scouting/players/${p.id}`} className="font-medium hover:text-accent-text">{p.fullName}</Link></Td>
                  <Td>{p.position}</Td>
                  <Td className="max-w-44 truncate text-ink-secondary">{schoolName ?? "—"}</Td>
                  <Td className="text-ink-secondary">{p.classYear}</Td>
                  <Td className="text-ink-secondary">{p.agentName ?? "—"}</Td>
                  <Td className="text-ink-secondary">{e.recommendation ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {eligible.length === 0 ? (
        <EmptyState title="No eligible college free agents" body="Undrafted seniors/graduates appear here automatically." />
      ) : (
        <Card title={`All CFA-eligible prospects (${eligible.length})`}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Prospect</Th>
                <Th>Pos</Th>
                <Th>School</Th>
                <Th>Class</Th>
                <Th>Hand</Th>
                <Th>Agent</Th>
              </tr>
            </thead>
            <tbody>
              {eligible.map(({ p, schoolName }) => (
                <tr key={p.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td><Link href={`/scouting/players/${p.id}`} className="font-medium hover:text-accent-text">{p.fullName}</Link></Td>
                  <Td>{p.position}</Td>
                  <Td className="max-w-44 truncate text-ink-secondary">{schoolName ?? "—"}</Td>
                  <Td className="text-ink-secondary">{p.classYear}</Td>
                  <Td className="text-ink-secondary">{p.shootsCatches ?? "—"}</Td>
                  <Td className="text-ink-secondary">{p.agentName ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
