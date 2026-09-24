import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { listDraftPicks, listDraftRankings } from "@/server/services/referenceDataService";
import { RANKING_CATEGORIES } from "@/lib/connectors/nhl";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Real data · draft" };

const dash = "—";
const heightFtIn = (inches: number | null) => (inches === null ? dash : `${Math.floor(inches / 12)}'${inches % 12}"`);

export default async function RealDataDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ ry?: string; rc?: string; py?: string }>;
}) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const toInt = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const [rankings, picks] = await Promise.all([
    listDraftRankings(ctx.org.id, { year: toInt(sp.ry), category: toInt(sp.rc) }),
    listDraftPicks(ctx.org.id, { year: toInt(sp.py) }),
  ]);
  const category = RANKING_CATEGORIES.find((c) => c.id === rankings.category);
  const rankingSets = rankings.available;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Draft</h1>
        <p className="text-sm text-ink-muted">
          NHL Central Scouting rankings and NHL Entry Draft history, as imported. Midterm and final ranks
          are shown separately; a blank rank means Central Scouting did not publish one for that player.
        </p>
      </div>

      <Card title={rankings.year ? `NHL Central Scouting · ${rankings.year} · ${category?.label ?? ""} (${rankings.rows.length})` : "NHL Central Scouting rankings"}>
        {rankingSets.length === 0 ? (
          <EmptyState title="No rankings imported" body="Import Central Scouting rankings from the Connectors tab." cta={{ href: "/real-data", label: "Open connectors" }} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {rankingSets.map((r) => {
                const active = r.year === rankings.year && r.category === rankings.category;
                const label = RANKING_CATEGORIES.find((c) => c.id === r.category)?.label ?? `Category ${r.category}`;
                return (
                  <Link
                    key={`${r.year}-${r.category}`}
                    href={`/real-data/draft?ry=${r.year}&rc=${r.category}${picks.year ? `&py=${picks.year}` : ""}`}
                    className={`rounded px-2 py-1 ${active ? "bg-accent-soft text-accent-text" : "bg-subtle text-ink-secondary hover:text-ink"}`}
                  >
                    {r.year} · {label}
                  </Link>
                );
              })}
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line">
                    <Th right>Final</Th>
                    <Th right>Midterm</Th>
                    <Th right>Δ</Th>
                    <Th>Player</Th>
                    <Th>Pos</Th>
                    <Th>Sh</Th>
                    <Th>Born</Th>
                    <Th>Ht / Wt</Th>
                    <Th>Amateur club</Th>
                    <Th>League</Th>
                    <Th>Country</Th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.rows.map((r) => {
                    const delta = r.finalRank !== null && r.midtermRank !== null ? r.midtermRank - r.finalRank : null;
                    return (
                      <tr key={r.id} className="border-b border-line/50 last:border-0">
                        <Td right className="font-medium">{r.finalRank ?? dash}</Td>
                        <Td right>{r.midtermRank ?? dash}</Td>
                        <Td right className={delta === null || delta === 0 ? "text-ink-muted" : delta > 0 ? "text-good" : "text-critical"}>
                          {delta === null ? dash : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : "0"}
                        </Td>
                        <Td className="font-medium">{r.playerName}</Td>
                        <Td>{r.position ?? dash}</Td>
                        <Td>{r.shootsCatches ?? dash}</Td>
                        <Td className="whitespace-nowrap">{r.birthDate ?? dash}</Td>
                        <Td className="whitespace-nowrap">{heightFtIn(r.heightInches)} / {r.weightPounds ?? dash} lb</Td>
                        <Td>{r.lastAmateurClub ?? dash}</Td>
                        <Td>{r.lastAmateurLeague ?? dash}</Td>
                        <Td>{r.birthCountry ?? dash}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">Δ = midterm rank − final rank (▲ rose). Rankings: NHL Central Scouting via the public NHL API.</p>
          </>
        )}
      </Card>

      <Card title={picks.year ? `NHL Entry Draft ${picks.year} (${picks.rows.length} picks)` : "NHL Entry Draft history"}>
        {picks.years.length === 0 ? (
          <EmptyState title="No draft history imported" body="Import draft picks from the Connectors tab." cta={{ href: "/real-data", label: "Open connectors" }} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {picks.years.map((y) => (
                <Link
                  key={y}
                  href={`/real-data/draft?py=${y}${rankings.year ? `&ry=${rankings.year}&rc=${rankings.category}` : ""}`}
                  className={`rounded px-2 py-1 ${y === picks.year ? "bg-accent-soft text-accent-text" : "bg-subtle text-ink-secondary hover:text-ink"}`}
                >
                  {y}
                </Link>
              ))}
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line">
                    <Th right>Ovr</Th>
                    <Th right>Rd</Th>
                    <Th right>Pick</Th>
                    <Th>Team</Th>
                    <Th>Player</Th>
                    <Th>Pos</Th>
                    <Th>Ht / Wt</Th>
                    <Th>Amateur club</Th>
                    <Th>League</Th>
                    <Th>Country</Th>
                  </tr>
                </thead>
                <tbody>
                  {picks.rows.map((p) => (
                    <tr key={p.id} className="border-b border-line/50 last:border-0">
                      <Td right className="font-medium">{p.overallPick}</Td>
                      <Td right>{p.round}</Td>
                      <Td right>{p.pickInRound ?? dash}</Td>
                      <Td>
                        {p.teamAbbrev ?? dash}
                        {p.teamPickHistory && p.teamPickHistory !== p.teamAbbrev && (
                          <span className="ml-1 text-xs text-ink-muted">({p.teamPickHistory})</span>
                        )}
                      </Td>
                      <Td className="font-medium">{p.playerName}</Td>
                      <Td>{p.position ?? dash}</Td>
                      <Td className="whitespace-nowrap">{heightFtIn(p.heightInches)} / {p.weightPounds ?? dash} lb</Td>
                      <Td>{p.amateurClub ?? dash}</Td>
                      <Td>{p.amateurLeague ?? dash}</Td>
                      <Td>{p.countryCode ?? dash}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
