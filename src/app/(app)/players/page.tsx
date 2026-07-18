import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq, ilike } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { statusLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pos?: string; status?: string }>;
}) {
  const ctx = await resolveAppContext();
  const { q, pos, status } = await searchParams;
  const db = getDb();

  const conditions = [eq(schema.players.organizationId, ctx.org.id)];
  if (q) conditions.push(ilike(schema.players.fullName, `%${q}%`));
  if (pos) conditions.push(eq(schema.players.position, pos));
  if (status) conditions.push(eq(schema.players.rosterStatus, status as (typeof schema.rosterStatus.enumValues)[number]));

  const players = await db
    .select({
      player: schema.players,
      teamName: schema.teams.name,
    })
    .from(schema.players)
    .leftJoin(schema.teams, eq(schema.players.currentTeamId, schema.teams.id))
    .where(and(...conditions))
    .orderBy(asc(schema.players.fullName))
    .limit(300);

  const selectCls =
    "rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Players</h1>
        <Link href="/players/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Add player
        </Link>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name…"
          className="w-56 rounded-md border border-line bg-navy-900 px-3 py-1.5 text-sm placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        <select name="pos" defaultValue={pos ?? ""} className={selectCls}>
          <option value="">All positions</option>
          {["C", "LW", "RW", "D", "G"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} className={selectCls}>
          <option value="">All statuses</option>
          {schema.rosterStatus.enumValues.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
          Filter
        </button>
      </form>

      {players.length === 0 ? (
        <EmptyState
          title="No players found"
          body={q || pos || status ? "Try clearing the filters." : "Add your first player to begin building the roster."}
          cta={{ href: "/players/new", label: "Add player" }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Name</Th>
                  <Th>Pos</Th>
                  <Th>Team</Th>
                  <Th>Status</Th>
                  <Th>Free agency</Th>
                  <Th>Nationality</Th>
                  <Th right>Pro GP</Th>
                </tr>
              </thead>
              <tbody>
                {players.map(({ player, teamName }) => (
                  <tr key={player.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td>
                      <Link href={`/players/${player.id}`} className="font-medium hover:text-accent-text">
                        {player.fullName}
                      </Link>
                    </Td>
                    <Td>{player.position}</Td>
                    <Td className="text-ink-secondary">{teamName ?? "—"}</Td>
                    <Td className="text-ink-secondary">{statusLabel(player.rosterStatus)}</Td>
                    <Td className="text-ink-secondary">{statusLabel(player.freeAgentStatus)}</Td>
                    <Td className="text-ink-secondary">{player.nationality ?? "—"}</Td>
                    <Td right>{player.proGamesPlayed}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{players.length} players (showing up to 300)</p>
        </Card>
      )}
    </div>
  );
}
