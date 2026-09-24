import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { listProspectProjections } from "@/server/services/referenceDataService";
import { Card, EmptyState, StatTile, Td, Th } from "@/components/ui";
import { PROSPECT_GROUP_LABELS, signed, topReasons } from "@/lib/models/labels";

export const metadata: Metadata = { title: "Real data · prospects" };

const dash = "—";

export default async function RealDataProspectsPage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const year = sp.y && /^\d{4}$/.test(sp.y) ? Number(sp.y) : undefined;
  const { years, year: shown, rows } = await listProspectProjections(ctx.org.id, { year });

  const mature = rows.filter((r) => r.labelMature);
  const expected = mature.reduce((a, r) => a + r.pNhlRegular, 0);
  const actual = mature.filter((r) => r.nhlRegular).length;
  // How many of the model's top-N (by probability) became regulars, vs the first N picks.
  const topN = Math.min(30, mature.length);
  const byModel = [...mature].sort((a, b) => b.pNhlRegular - a.pNhlRegular).slice(0, topN).filter((r) => r.nhlRegular).length;
  const byPick = [...mature].sort((a, b) => a.overallPick - b.overallPick).slice(0, topN).filter((r) => r.nhlRegular).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Prospects</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          RosterIQ prospect model: the chance each drafted skater plays 200+ NHL regular-season games in the
          seven seasons after his draft, from draft-time information only (production translated with RosterIQ
          NHLe, age, size, position, league). It does not use where the player was picked; &ldquo;From draft slot&rdquo;
          is the same probability from draft position alone. Past drafts are scored by models trained without that draft.
        </p>
        <p className="mt-2 max-w-3xl rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          On the 2016–2019 drafts, draft position alone predicted better than this model, and adding the stats to draft
          position did not measurably improve it. Before the draft, though, the stats did add information on top of NHL
          Central Scouting&rsquo;s final rank (most after round 1). Use the model to see why a production profile looks strong or
          weak, and ▲/▼ (a 10-point gap from the draft slot) as a prompt to look closer — not as a ranking.{" "}
          <Link href="/real-data/models" className="underline">Model card →</Link>
        </p>
      </div>

      {years.length === 0 ? (
        <EmptyState
          title="No prospect projections imported"
          body="Stage the RosterIQ prospect projections from the Connectors tab and approve the import."
          cta={{ href: "/real-data", label: "Open connectors" }}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {years.map((y) => (
              <Link
                key={y}
                href={`/real-data/prospects?y=${y}`}
                className={`rounded px-2 py-1 ${y === shown ? "bg-accent-soft text-accent-text" : "bg-navy-850 text-ink-secondary hover:text-ink"}`}
              >
                {y}
              </Link>
            ))}
          </div>

          {mature.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Expected 200-game players" value={expected.toFixed(1)} detail={`model, ${shown} draft`} />
              <StatTile label="Actual 200-game players" value={String(actual)} detail="within seven seasons" />
              <StatTile label={`Hits in model's top ${topN}`} value={String(byModel)} detail="ranked by probability" />
              <StatTile label={`Hits in first ${topN} picks`} value={String(byPick)} detail="ranked by draft order" />
            </div>
          )}

          <Card title={`${shown} NHL Draft · skaters (${rows.length})`}>
            <div className="max-h-[40rem] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-navy-900">
                  <tr className="border-b border-line">
                    <Th right>Pick</Th>
                    <Th>Player</Th>
                    <Th>Pos</Th>
                    <Th>Draft-year league</Th>
                    <Th right>P/GP</Th>
                    <Th right>NHLe P/GP</Th>
                    <Th right>Age</Th>
                    <Th right>P(200 GP)</Th>
                    <Th right>From draft slot</Th>
                    <Th>Biggest reasons (pts)</Th>
                    <Th right>NHL GP (7 yrs)</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const reasons = topReasons(r.contributions as Record<keyof typeof PROSPECT_GROUP_LABELS, number>, PROSPECT_GROUP_LABELS, 2);
                    return (
                      <tr key={r.id} className="border-b border-line/50 last:border-0">
                        <Td right>{r.overallPick}</Td>
                        <Td>
                          <Link href={`/real-data/players/${r.externalPlayerId}`} className="text-accent-text hover:underline">
                            {r.playerName}
                          </Link>
                          <div className="text-xs text-ink-muted">{r.draftedBy ?? dash}</div>
                        </Td>
                        <Td>{r.position ?? dash}</Td>
                        <Td>{r.d0League ?? dash}</Td>
                        <Td right>{r.d0Ppg === null ? dash : r.d0Ppg.toFixed(2)}</Td>
                        <Td right>{r.d0NhlePpg === null ? dash : r.d0NhlePpg.toFixed(2)}</Td>
                        <Td right>{r.ageAtDraft === null ? dash : r.ageAtDraft.toFixed(1)}</Td>
                        <Td right className="font-medium">{(r.pNhlRegular * 100).toFixed(0)}%</Td>
                        <Td right className="text-ink-secondary">
                          {r.pByPick === null ? dash : `${(r.pByPick * 100).toFixed(0)}%`}
                          {r.pByPick !== null && Math.abs(r.pNhlRegular - r.pByPick) >= 0.1 && (
                            <span className={`ml-1 text-xs ${r.pNhlRegular > r.pByPick ? "text-good" : "text-critical"}`}>
                              {r.pNhlRegular > r.pByPick ? "▲" : "▼"}
                            </span>
                          )}
                        </Td>
                        <Td className="text-xs text-ink-secondary">{reasons.map((x) => `${x.label} ${signed(x.value * 100, 0)}`).join(" · ")}</Td>
                        <Td right>
                          {r.labelMature ? (
                            <span className={r.nhlRegular ? "text-good" : ""}>{r.nhlGp7 ?? 0}</span>
                          ) : (
                            <span className="text-ink-muted" title="Seven seasons have not been played yet">{r.nhlGpToDate ?? 0} so far</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Reasons are percentage points versus a typical drafted skater and add up exactly to the gap. NHLe blank =
              no league in the player&rsquo;s draft year has a factor (too little connected data). Goalies are not modelled.
              Draft-year and prior-season numbers come from the NHL player pages; blank means the source had none.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
