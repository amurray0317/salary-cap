import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { listReferencePlayers } from "@/server/services/referenceDataService";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Real data · players" };

const SOURCE_LABELS: Record<string, string> = {
  nhl: "NHL bio",
  nhl_career: "NHL career",
  nhl_stats: "NHL stats",
  moneypuck: "MoneyPuck",
  eliteprospects: "EliteProspects",
};

export default async function RealDataPlayersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await resolveAppContext();
  const { q } = await searchParams;
  const players = await listReferencePlayers(ctx.org.id, { q, limit: 500 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Players & stats</h1>
          <p className="text-sm text-ink-muted">Imported real players, merged across sources on the NHL player id.</p>
        </div>
        <form className="flex gap-2" role="search">
          <label htmlFor="rd-q" className="sr-only">Search players</label>
          <input
            id="rd-q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name…"
            className="w-56 rounded-md border border-line bg-navy-950 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Search</button>
        </form>
      </div>

      {players.length === 0 ? (
        <EmptyState
          title={q ? "No imported players match" : "No real players imported yet"}
          body="Run an NHL or MoneyPuck connector on the Connectors tab and approve the import."
          cta={{ href: "/real-data", label: "Open connectors" }}
        />
      ) : (
        <Card title={`${players.length} player${players.length === 1 ? "" : "s"}${players.length === 500 ? " (first 500)" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Player</Th>
                  <Th>Pos</Th>
                  <Th>Team</Th>
                  <Th>Born</Th>
                  <Th right>Season lines</Th>
                  <Th>Latest</Th>
                  <Th>Sources</Th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={`${p.bioSource ?? "nhl"}-${p.externalId}`} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td>
                      {p.bioSource === "eliteprospects" ? (
                        <span className="font-medium">{p.name}</span>
                      ) : (
                        <Link href={`/real-data/players/${p.externalId}`} className="font-medium hover:text-accent-text">
                          {p.name}
                        </Link>
                      )}
                      <span className="ml-2 font-mono text-xs text-ink-muted">{p.externalId}</span>
                    </Td>
                    <Td>{p.position ?? "—"}</Td>
                    <Td>{p.team ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{p.dateOfBirth ?? "—"}</Td>
                    <Td right>{p.seasonLines}</Td>
                    <Td>{p.latestSeason ?? "—"}</Td>
                    <Td className="text-xs text-ink-secondary">{p.sources.map((s) => SOURCE_LABELS[s] ?? s).join(" · ")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
