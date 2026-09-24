import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { listStandings } from "@/server/services/referenceDataService";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Standings" };

type Row = Awaited<ReturnType<typeof listStandings>>["rows"][number];
const VIEWS = ["division", "conference", "league", "wildcard"] as const;
type View = (typeof VIEWS)[number];
const dash = "—";
const CLINCH: Record<string, string> = {
  x: "clinched a playoff spot",
  y: "clinched the division",
  z: "clinched the conference",
  p: "clinched the Presidents' Trophy",
  e: "eliminated",
};

function StandingsTable({ rows, rankOf }: { rows: Row[]; rankOf: (r: Row) => number | null }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line">
          <Th right>#</Th>
          <Th>Team</Th>
          <Th right>GP</Th>
          <Th right>W</Th>
          <Th right>L</Th>
          <Th right>OTL</Th>
          <Th right>PTS</Th>
          <Th right>P%</Th>
          <Th right>RW</Th>
          <Th right>ROW</Th>
          <Th right>GF</Th>
          <Th right>GA</Th>
          <Th right>DIFF</Th>
          <Th>Home</Th>
          <Th>Road</Th>
          <Th>L10</Th>
          <Th>Streak</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const diff = r.goalsFor !== null && r.goalsAgainst !== null ? r.goalsFor - r.goalsAgainst : null;
          return (
            <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-subtle">
              <Td right className="text-ink-muted">{rankOf(r) ?? dash}</Td>
              <Td>
                <span className="font-medium">{r.teamName}</span>
                {r.clinch && (
                  <span className="ml-1.5 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent-text" title={CLINCH[r.clinch] ?? r.clinch}>
                    {r.clinch}
                  </span>
                )}
              </Td>
              <Td right>{r.gamesPlayed}</Td>
              <Td right>{r.wins}</Td>
              <Td right>{r.losses}</Td>
              <Td right>{r.otLosses}</Td>
              <Td right className="font-semibold">{r.points}</Td>
              <Td right>{r.pointPct === null ? dash : r.pointPct.toFixed(3).replace(/^0/, "")}</Td>
              <Td right>{r.regulationWins ?? dash}</Td>
              <Td right>{r.regulationPlusOtWins ?? dash}</Td>
              <Td right>{r.goalsFor ?? dash}</Td>
              <Td right>{r.goalsAgainst ?? dash}</Td>
              <Td right className={diff === null ? "" : diff > 0 ? "text-good" : diff < 0 ? "text-critical" : ""}>
                {diff === null ? dash : diff > 0 ? `+${diff}` : diff}
              </Td>
              <Td className="tabular-nums">{r.homeRecord ?? dash}</Td>
              <Td className="tabular-nums">{r.roadRecord ?? dash}</Td>
              <Td className="tabular-nums">{r.lastTen ?? dash}</Td>
              <Td className="tabular-nums">{r.streak ?? dash}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const groupBy = (rows: Row[], key: (r: Row) => string) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
};
const byRank = (rank: (r: Row) => number | null) => (a: Row, b: Row) => (rank(a) ?? 99) - (rank(b) ?? 99);

export default async function StandingsPage({ searchParams }: { searchParams: Promise<{ season?: string; view?: string; type?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const season = sp.season && /^\d{4}-\d{2}$/.test(sp.season) ? sp.season : undefined;
  const gameType = sp.type === "playoffs" ? "playoffs" : "regular";
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "division";
  const data = await listStandings(ctx.org.id, { season, gameType });
  const link = (p: Partial<{ season: string; view: string }>) =>
    `/standings?season=${p.season ?? data.season ?? ""}&view=${p.view ?? view}&type=${gameType}`;
  const pill = (active: boolean) => `rounded px-2 py-1 ${active ? "bg-accent-soft text-accent-text" : "bg-subtle text-ink-secondary hover:text-ink"}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Standings</h1>
        <p className="text-sm text-ink-muted">
          NHL standings from the public NHL API{data.asOf ? `, as of ${data.asOf}` : ""}. Refresh from Real data → Connectors (each import
          replaces the previous standings). Other leagues will appear here as their data sources are connected.
        </p>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          title="No standings imported"
          body="Import NHL standings from the Connectors page (League season stats → Fetch standings) and approve the import."
          cta={{ href: "/real-data", label: "Open connectors" }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {VIEWS.map((v) => (
              <Link key={v} href={link({ view: v })} className={pill(v === view)}>
                {v === "wildcard" ? "Wild card" : v[0]!.toUpperCase() + v.slice(1)}
              </Link>
            ))}
            <span className="mx-2 h-4 w-px bg-line" aria-hidden />
            {data.seasons.map((s) => (
              <Link key={s} href={link({ season: s })} className={pill(s === data.season)}>
                {s}
              </Link>
            ))}
          </div>
          {view === "league" && (
            <Card title={`League · ${data.season}`}>
              <div className="overflow-x-auto">
                <StandingsTable rows={[...data.rows].sort(byRank((r) => r.leagueRank))} rankOf={(r) => r.leagueRank} />
              </div>
            </Card>
          )}
          {view === "conference" &&
            groupBy(data.rows, (r) => r.conference ?? "—").map(([conf, rows]) => (
              <Card key={conf} title={`${conf} Conference`}>
                <div className="overflow-x-auto">
                  <StandingsTable rows={rows.sort(byRank((r) => r.conferenceRank))} rankOf={(r) => r.conferenceRank} />
                </div>
              </Card>
            ))}
          {view === "division" && (
            <div className="grid gap-4 2xl:grid-cols-2">
              {groupBy(data.rows, (r) => r.division ?? "—").map(([div, rows]) => (
                <Card key={div} title={`${div} Division`}>
                  <div className="overflow-x-auto">
                    <StandingsTable rows={rows.sort(byRank((r) => r.divisionRank))} rankOf={(r) => r.divisionRank} />
                  </div>
                </Card>
              ))}
            </div>
          )}
          {view === "wildcard" &&
            groupBy(data.rows, (r) => r.conference ?? "—").map(([conf, rows]) => {
              const top3 = rows.filter((r) => (r.divisionRank ?? 99) <= 3);
              const wc = rows.filter((r) => (r.divisionRank ?? 99) > 3).sort(byRank((r) => r.wildcardRank));
              return (
                <Card key={conf} title={`${conf} Conference · wild card`}>
                  <div className="space-y-3 overflow-x-auto">
                    {groupBy(top3, (r) => r.division ?? "—").map(([div, rs]) => (
                      <div key={div}>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">{div} top 3</div>
                        <StandingsTable rows={rs.sort(byRank((r) => r.divisionRank))} rankOf={(r) => r.divisionRank} />
                      </div>
                    ))}
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-muted">Wild card (top 2 qualify)</div>
                      <StandingsTable rows={wc} rankOf={(r) => r.wildcardRank} />
                    </div>
                  </div>
                </Card>
              );
            })}
          <p className="text-xs text-ink-muted">
            P% = points percentage · RW = regulation wins · ROW = regulation + overtime wins (tiebreakers) · letters after a team:{" "}
            {Object.entries(CLINCH)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")}
            . {gameType === "playoffs" ? "Playoffs." : ""}
          </p>
        </>
      )}
    </div>
  );
}
