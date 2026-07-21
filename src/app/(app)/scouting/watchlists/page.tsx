import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { removeFromWatchlistAction } from "@/server/actions/scoutingActions";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";

const PRIORITY_LABELS: Record<number, string> = { 1: "1 — top", 2: "2 — high", 3: "3 — normal", 4: "4 — low", 5: "5 — monitor" };

export const metadata: Metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const watchlists = await db
    .select()
    .from(schema.prospectWatchlists)
    .where(eq(schema.prospectWatchlists.organizationId, ctx.org.id))
    .orderBy(asc(schema.prospectWatchlists.name));

  if (watchlists.length === 0) {
    return <EmptyState title="No watchlists" body="Create one from any prospect profile (Add to watchlist → new name)." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Watchlists</h1>
      {await Promise.all(
        watchlists.map(async (w) => {
          const members = await db
            .select({ m: schema.prospectWatchlistMembers, p: schema.amateurProspects })
            .from(schema.prospectWatchlistMembers)
            .innerJoin(schema.amateurProspects, eq(schema.prospectWatchlistMembers.prospectId, schema.amateurProspects.id))
            .where(eq(schema.prospectWatchlistMembers.watchlistId, w.id))
            .orderBy(asc(schema.prospectWatchlistMembers.priority), asc(schema.amateurProspects.fullName));
          return (
            <Card key={w.id} title={`${w.name} (${members.length})`}>
              {w.description && <p className="mb-2 text-sm text-ink-muted">{w.description}</p>}
              {members.length === 0 ? (
                <p className="text-sm text-ink-muted">Empty — add prospects from their profiles.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line">
                        <Th>Priority</Th>
                        <Th>Prospect</Th>
                        <Th>Pos</Th>
                        <Th>Class</Th>
                        <Th>Draft status</Th>
                        <Th>Reason</Th>
                        <Th>Follow-up</Th>
                        <Th>Added</Th>
                        <Th> </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(({ m, p }) => (
                        <tr key={m.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                          <Td>{PRIORITY_LABELS[m.priority] ?? m.priority}</Td>
                          <Td><Link href={`/scouting/players/${p.id}`} className="font-medium hover:text-accent-text">{p.fullName}</Link></Td>
                          <Td>{p.position}</Td>
                          <Td className="text-ink-secondary">{p.classYear}</Td>
                          <Td className="text-ink-secondary">{p.nhlDraftStatus}</Td>
                          <Td className="max-w-56 text-ink-secondary">{m.reason ?? "—"}</Td>
                          <Td className="text-ink-secondary">{m.followUpDate ? formatDate(m.followUpDate) : "—"}</Td>
                          <Td className="text-ink-secondary">{formatDate(m.createdAt)}</Td>
                          <Td>
                            <form action={removeFromWatchlistAction}>
                              <input type="hidden" name="organizationId" value={ctx.org.id} />
                              <input type="hidden" name="memberId" value={m.id} />
                              <button className="text-xs text-critical hover:underline">Remove</button>
                            </form>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        }),
      )}
    </div>
  );
}
