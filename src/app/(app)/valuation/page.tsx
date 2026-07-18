import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { moneyCompact, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Player valuation" };

export default async function ValuationPage() {
  const ctx = await resolveAppContext();
  const db = getDb();

  const rows = ctx.season
    ? await db
        .select({
          valuation: schema.playerValuations,
          player: schema.players,
        })
        .from(schema.playerValuations)
        .innerJoin(schema.players, eq(schema.playerValuations.playerId, schema.players.id))
        .where(
          and(
            eq(schema.players.organizationId, ctx.org.id),
            eq(schema.playerValuations.seasonId, ctx.season.id),
          ),
        )
        .orderBy(desc(schema.playerValuations.estimatedAav))
    : [];

  const surplus = ctx.season
    ? await db
        .select({
          playerId: schema.surplusValueRecords.playerId,
          surplusValue: schema.surplusValueRecords.surplusValue,
          capHit: schema.surplusValueRecords.capHit,
        })
        .from(schema.surplusValueRecords)
        .innerJoin(schema.players, eq(schema.surplusValueRecords.playerId, schema.players.id))
        .where(
          and(
            eq(schema.players.organizationId, ctx.org.id),
            eq(schema.surplusValueRecords.seasonId, ctx.season.id),
          ),
        )
    : [];
  const surplusByPlayer = new Map(surplus.map((s) => [s.playerId, s]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Player valuation — {ctx.season?.name}</h1>
        <p className="text-sm text-ink-muted">
          Model-generated estimates (riq-market-v0.1 / riq-perf-v0.1). Not official figures; open a
          player for inputs, comparables, and assumptions.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No stored valuations for this season"
          body="Valuations are computed live on each player profile; stored snapshots appear here. The seeded demo stores valuations for the Aurora organization in 2025-26."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Player</Th>
                  <Th>Pos</Th>
                  <Th right>Cap hit</Th>
                  <Th right>Perf. value</Th>
                  <Th right>Surplus</Th>
                  <Th right>Est. AAV</Th>
                  <Th right>Range</Th>
                  <Th right>Term</Th>
                  <Th right>Confidence</Th>
                  <Th>Model</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ valuation, player }) => {
                  const s = surplusByPlayer.get(player.id);
                  return (
                    <tr key={valuation.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                      <Td>
                        <Link href={`/players/${player.id}`} className="font-medium hover:text-accent-text">
                          {player.fullName}
                        </Link>
                      </Td>
                      <Td>{player.position}</Td>
                      <Td right>{s ? moneyCompact(s.capHit) : "—"}</Td>
                      <Td right>{moneyCompact(valuation.performanceValue)}</Td>
                      <Td right className={s ? (s.surplusValue >= 0 ? "text-good" : "text-critical") : ""}>
                        {s ? `${s.surplusValue >= 0 ? "+" : ""}${moneyCompact(s.surplusValue)}` : "—"}
                      </Td>
                      <Td right>{moneyCompact(valuation.estimatedAav)}</Td>
                      <Td right className="text-ink-muted">
                        {moneyCompact(valuation.estimatedAavLow)}–{moneyCompact(valuation.estimatedAavHigh)}
                      </Td>
                      <Td right>{valuation.estimatedTermYears}y</Td>
                      <Td right>{pct(valuation.confidence)}</Td>
                      <Td className="text-xs text-ink-muted">{valuation.modelVersion}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            All values are estimates for planning only. Surplus = performance value − cap hit.
          </p>
        </Card>
      )}
    </div>
  );
}
