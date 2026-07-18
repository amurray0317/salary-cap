import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getTeamCapReport } from "@/server/services/capService";
import { Card, CapMeter, EmptyState, StatTile, Td, Th, ViolationList } from "@/components/ui";
import { money, moneyCompact, positionLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Cap dashboard" };

export default async function DashboardPage() {
  const ctx = await resolveAppContext();
  if (!ctx.team) {
    return (
      <EmptyState
        title="No team yet"
        body="Create a team to start tracking cap commitments."
        cta={{ href: "/onboarding", label: "Create a team" }}
      />
    );
  }

  const report = await getTeamCapReport(ctx.team.id);
  const seasonIdx = Math.max(0, report.seasons.findIndex((s) => s.id === ctx.season?.id));
  const current = report.results[seasonIdx];
  if (!current) {
    return (
      <EmptyState
        title="No seasons configured"
        body="This team's league has no seasons. Configure seasons and cap rules first."
        cta={{ href: "/rules", label: "League rules" }}
      />
    );
  }

  const db = getDb();

  // Top cap hits for the selected season
  const topHits = [...current.lineItems]
    .filter((l) => l.category === "active_roster" || l.category === "injured_reserve")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  // Surplus leaders / trailers from persisted records
  const playerIds = current.lineItems
    .flatMap((l) => l.records)
    .filter((r) => r.type === "contract")
    .map((r) => r.id);
  const surplusRows =
    ctx.season && playerIds.length > 0
      ? await db
          .select({
            playerName: schema.players.fullName,
            surplusValue: schema.surplusValueRecords.surplusValue,
            performanceValue: schema.surplusValueRecords.performanceValue,
            capHit: schema.surplusValueRecords.capHit,
            playerId: schema.surplusValueRecords.playerId,
          })
          .from(schema.surplusValueRecords)
          .innerJoin(schema.players, eq(schema.surplusValueRecords.playerId, schema.players.id))
          .where(
            and(
              eq(schema.surplusValueRecords.seasonId, ctx.season.id),
              eq(schema.players.organizationId, ctx.org.id),
            ),
          )
          .orderBy(desc(schema.surplusValueRecords.surplusValue))
      : [];
  const orgSurplus = surplusRows;
  const bestSurplus = orgSurplus.slice(0, 5);
  const worstSurplus = orgSurplus.slice(-5).reverse();

  // Position spending for selected season
  const positionSpend = new Map<string, number>();
  for (const li of current.lineItems) {
    if (li.category !== "active_roster" && li.category !== "injured_reserve") continue;
    const m = li.records[0]?.label.match(/\((C|LW|RW|D|G)\)$/);
    const pos = m?.[1] ?? "Other";
    positionSpend.set(pos, (positionSpend.get(pos) ?? 0) + li.amount);
  }
  const positionOrder = ["C", "LW", "RW", "D", "G", "Other"];
  const maxPosSpend = Math.max(1, ...positionSpend.values());

  // Expiring contracts: last contract season == selected season
  const teamContracts = await db
    .select({ id: schema.contracts.id, playerId: schema.contracts.playerId })
    .from(schema.contracts)
    .where(eq(schema.contracts.teamId, ctx.team.id));
  const contractIds = teamContracts.map((c) => c.id);
  let expiringCount = 0;
  if (contractIds.length > 0 && ctx.season) {
    const seasonRows = await db
      .select({ contractId: schema.contractSeasons.contractId, seasonId: schema.contractSeasons.seasonId })
      .from(schema.contractSeasons)
      .where(inArray(schema.contractSeasons.contractId, contractIds));
    const seasonOrder = new Map(report.seasons.map((s, i) => [s.id, i]));
    const lastSeasonByContract = new Map<string, number>();
    for (const row of seasonRows) {
      const idx = seasonOrder.get(row.seasonId) ?? 0;
      lastSeasonByContract.set(row.contractId, Math.max(lastSeasonByContract.get(row.contractId) ?? -1, idx));
    }
    expiringCount = [...lastSeasonByContract.values()].filter((v) => v === seasonIdx).length;
  }

  const t = current.totals;
  const capSpaceTone = t.capSpace < 0 ? "critical" : t.capSpace < 2_000_000 ? "warn" : "good";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {ctx.team.name} — {current.season.name} cap dashboard
        </h1>
        <p className="text-xs text-ink-muted">
          Calculated {new Date(current.calculatedAt).toLocaleString()} · rules v
          {current.appliedRules[0]?.version ?? 1} · all figures explainable below
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Cap upper limit" value={moneyCompact(t.capUpperLimit)} detail={`Floor ${moneyCompact(t.capLowerLimit)}`} />
        <StatTile label="Total cap charge" value={moneyCompact(t.totalCapCharge)} detail={`Cash payroll ${moneyCompact(t.totalCashPayroll)}`} />
        <StatTile label="Cap space" value={moneyCompact(t.capSpace)} tone={capSpaceTone} detail={t.capSpace < 0 ? "Over the limit" : "Remaining this season"} />
        <StatTile
          label="Active roster"
          value={`${current.counts.activeRoster}`}
          detail={`${current.counts.contractSlots} contracts · ${current.counts.goaliesActive} G · IR ${current.counts.injuredReserve + current.counts.ltir}`}
        />
        <StatTile label="Retained salary" value={moneyCompact(t.retainedTotal)} />
        <StatTile label="Dead cap" value={moneyCompact(t.deadCapTotal)} />
        <StatTile label="LTIR relief" value={moneyCompact(t.ltirRelief)} />
        <StatTile label="Expiring contracts" value={`${expiringCount}`} detail="Final year this season" />
      </div>

      {(current.violations.length > 0 || current.warnings.length > 0) && (
        <Card title="Compliance">
          <ViolationList items={[...current.violations, ...current.warnings]} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Commitments by season">
          <div className="space-y-4">
            {report.results.map((r) => (
              <CapMeter
                key={r.season.id}
                label={r.season.name}
                value={r.totals.totalCapCharge}
                limit={r.totals.capUpperLimit}
                sublabel={`Space ${money(r.totals.capSpace)} · ${r.counts.contractSlots} contracts`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Future seasons assume current roster statuses; open Scenarios to model changes.
          </p>
        </Card>

        <Card title="Position spending (selected season)">
          <div className="space-y-3">
            {positionOrder
              .filter((p) => positionSpend.has(p))
              .map((pos) => {
                const amount = positionSpend.get(pos) ?? 0;
                return (
                  <div key={pos}>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-secondary">{positionLabel(pos)}</span>
                      <span className="tabular-nums">{moneyCompact(amount)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded bg-navy-800">
                      <div className="h-full rounded bg-accent" style={{ width: `${(amount / maxPosSpend) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        <Card
          title="Top cap hits"
          action={<Link href="/contracts" className="text-xs text-accent-text hover:underline">All contracts →</Link>}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Player</Th>
                <Th right>Cap hit</Th>
              </tr>
            </thead>
            <tbody>
              {topHits.map((l) => (
                <tr key={l.id} className="border-b border-line/50 last:border-0">
                  <Td>{l.records[0]?.label ?? l.label}</Td>
                  <Td right>{money(l.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title="Surplus value (model riq-perf-v0.1 — estimates)"
          action={<Link href="/valuation" className="text-xs text-accent-text hover:underline">Valuation →</Link>}
        >
          {bestSurplus.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No surplus records for this season yet. Open Valuation to generate estimates.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Best contracts</h3>
                <ul className="space-y-1 text-sm">
                  {bestSurplus.map((r) => (
                    <li key={r.playerId} className="flex justify-between gap-2">
                      <Link href={`/players/${r.playerId}`} className="truncate hover:text-accent-text">{r.playerName}</Link>
                      <span className="tabular-nums text-good">+{moneyCompact(r.surplusValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Most negative</h3>
                <ul className="space-y-1 text-sm">
                  {worstSurplus.map((r) => (
                    <li key={r.playerId} className="flex justify-between gap-2">
                      <Link href={`/players/${r.playerId}`} className="truncate hover:text-accent-text">{r.playerName}</Link>
                      <span className="tabular-nums text-critical">{moneyCompact(r.surplusValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            Estimates from seeded projections; not official figures.
          </p>
        </Card>
      </div>

      <Card title="Calculation detail (every line, with formula and rule)">
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-navy-900">
              <tr className="border-b border-line">
                <Th>Line</Th>
                <Th>Category</Th>
                <Th right>Amount</Th>
                <Th>Formula</Th>
              </tr>
            </thead>
            <tbody>
              {current.lineItems.map((l) => (
                <tr key={l.id} className="border-b border-line/50 last:border-0">
                  <Td>{l.label}</Td>
                  <Td className="text-ink-muted">{l.category.replace(/_/g, " ")}</Td>
                  <Td right>{money(l.amount)}</Td>
                  <Td className="text-xs text-ink-muted">{l.formula}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Applied rules:{" "}
          {current.appliedRules.map((r) => `${r.key} v${r.version} (${r.effectiveDate})`).join(" · ")}
        </p>
      </Card>
    </div>
  );
}
