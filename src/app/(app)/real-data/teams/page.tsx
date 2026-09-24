import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { listTeamSeasons } from "@/server/services/referenceDataService";
import { MONEYPUCK_SITUATIONS } from "@/lib/connectors/moneypuck";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Real data · teams" };

const dash = "—";
const n = (v: number | null) => (v === null ? dash : String(v));
const pct = (v: number | null, d = 1) => (v === null ? dash : `${(v * 100).toFixed(d)}%`);
const f = (v: number | null, d: number) => (v === null ? dash : v.toFixed(d));

export default async function RealDataTeamsPage({ searchParams }: { searchParams: Promise<{ season?: string; sit?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const season = sp.season && /^\d{4}-\d{2}$/.test(sp.season) ? sp.season : undefined;
  const situation = sp.sit && (MONEYPUCK_SITUATIONS as readonly string[]).includes(sp.sit) ? sp.sit : undefined;
  const data = await listTeamSeasons(ctx.org.id, { season, situation });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Teams</h1>
        <p className="text-sm text-ink-muted">
          Team season summaries from the NHL API (results, special teams) and MoneyPuck (shot-share and
          expected-goals metrics, by situation). Rows are shown per source; they are not blended.
        </p>
      </div>
      {data.seasons.length === 0 ? (
        <EmptyState title="No team data imported" body="Import NHL team stats or MoneyPuck teams from the Connectors tab." cta={{ href: "/real-data", label: "Open connectors" }} />
      ) : (
        <Card title={`${data.season} · situation: ${data.situation} (${data.rows.length} rows)`}>
          <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
            {data.seasons.map((s) => (
              <Link key={s} href={`/real-data/teams?season=${s}&sit=${data.situation}`} className={`rounded px-2 py-1 ${s === data.season ? "bg-accent-soft text-accent-text" : "bg-subtle text-ink-secondary hover:text-ink"}`}>
                {s}
              </Link>
            ))}
            <span className="mx-2 text-ink-muted">|</span>
            {MONEYPUCK_SITUATIONS.map((s) => (
              <Link key={s} href={`/real-data/teams?season=${data.season}&sit=${s}`} className={`rounded px-2 py-1 ${s === data.situation ? "bg-accent-soft text-accent-text" : "bg-subtle text-ink-secondary hover:text-ink"}`}>
                {s}
              </Link>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Team</Th>
                  <Th>Source</Th>
                  <Th>Type</Th>
                  <Th right>GP</Th>
                  <Th right>W-L-OTL</Th>
                  <Th right>PTS</Th>
                  <Th right>GF</Th>
                  <Th right>GA</Th>
                  <Th right>PP%</Th>
                  <Th right>PK%</Th>
                  <Th right>xGF</Th>
                  <Th right>xGA</Th>
                  <Th right>xGF%</Th>
                  <Th right>CF%</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/50 last:border-0">
                    <Td className="font-medium">{r.teamAbbrev ?? r.teamName ?? dash}</Td>
                    <Td className="text-xs text-ink-secondary">{r.source === "moneypuck" ? "MoneyPuck" : "NHL API"}</Td>
                    <Td>{r.gameType === "regular" ? "Reg" : "PO"}</Td>
                    <Td right>{n(r.gamesPlayed)}</Td>
                    <Td right>{r.wins === null ? dash : `${r.wins}-${r.losses ?? dash}-${r.otLosses ?? dash}`}</Td>
                    <Td right>{n(r.points)}</Td>
                    <Td right>{n(r.goalsFor)}</Td>
                    <Td right>{n(r.goalsAgainst)}</Td>
                    <Td right>{pct(r.powerPlayPct)}</Td>
                    <Td right>{pct(r.penaltyKillPct)}</Td>
                    <Td right>{f(r.xGoalsFor, 1)}</Td>
                    <Td right>{f(r.xGoalsAgainst, 1)}</Td>
                    <Td right>{pct(r.xGoalsPct, 0)}</Td>
                    <Td right>{pct(r.corsiPct, 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">NHL API rows exist only for situation &ldquo;all&rdquo;. MoneyPuck reports xGF%/CF% rounded to two decimals. Data: NHL.com · MoneyPuck.com.</p>
        </Card>
      )}
    </div>
  );
}
