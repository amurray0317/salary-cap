import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getScenarioProjection } from "@/server/services/scenarioService";
import {
  addScenarioTransactionAction,
  duplicateScenarioAction,
  removeScenarioTransactionAction,
  setScenarioStatusAction,
  toggleScenarioTransactionAction,
} from "@/server/actions/scenarioActions";
import { AddTransactionForm } from "@/components/ScenarioForms";
import { Card, StatTile, Td, Th, ViolationList } from "@/components/ui";
import { money, moneyCompact } from "@/lib/format";

export const metadata: Metadata = { title: "Scenario builder" };

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const db = getDb();

  // Org isolation before any projection work.
  const [owned] = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.id, id), eq(schema.scenarios.organizationId, ctx.org.id)))
    .limit(1);
  if (!owned) notFound();

  const projection = await getScenarioProjection(id);
  const { scenario } = projection;

  // Contract options for transaction targets (this scenario's team only).
  const teamContracts = await db
    .select({
      id: schema.contracts.id,
      playerName: schema.players.fullName,
      position: schema.players.position,
      aav: schema.contracts.averageAnnualValue,
    })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.teamId, scenario.teamId), eq(schema.contracts.contractStatus, "active")))
    .orderBy(asc(schema.players.fullName));

  const baseIdx = Math.max(0, projection.seasons.findIndex((s) => s.id === scenario.baseSeasonId));
  const official = projection.officialResults[baseIdx];
  const projected = projection.projectedResults[baseIdx];
  const readOnly = scenario.status === "archived" || scenario.status === "applied";

  const delta = (o?: number, p?: number) => (p ?? 0) - (o ?? 0);
  const capDelta = delta(official?.totals.capSpace, projected?.totals.capSpace);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{scenario.name}</h1>
          <p className="text-sm text-ink-muted">
            {scenario.description || "Scenario"} · base season{" "}
            {projection.seasons[baseIdx]?.name} · status {scenario.status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/scenarios/compare?ids=${scenario.id}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
          >
            Compare with official
          </Link>
          <form action={duplicateScenarioAction}>
            <input type="hidden" name="organizationId" value={ctx.org.id} />
            <input type="hidden" name="scenarioId" value={scenario.id} />
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              Duplicate
            </button>
          </form>
          <form action={setScenarioStatusAction}>
            <input type="hidden" name="organizationId" value={ctx.org.id} />
            <input type="hidden" name="scenarioId" value={scenario.id} />
            <input type="hidden" name="status" value={scenario.status === "archived" ? "draft" : "archived"} />
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              {scenario.status === "archived" ? "Unarchive" : "Archive"}
            </button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Official cap space" value={moneyCompact(official?.totals.capSpace ?? 0)} detail={projection.seasons[baseIdx]?.name} />
        <StatTile
          label="Projected cap space"
          value={moneyCompact(projected?.totals.capSpace ?? 0)}
          tone={(projected?.totals.capSpace ?? 0) < 0 ? "critical" : "good"}
          detail={`${capDelta >= 0 ? "+" : ""}${moneyCompact(capDelta)} vs official`}
        />
        <StatTile
          label="Projected cap charge"
          value={moneyCompact(projected?.totals.totalCapCharge ?? 0)}
          detail={`Official ${moneyCompact(official?.totals.totalCapCharge ?? 0)}`}
        />
        <StatTile
          label="Projected roster"
          value={`${projected?.counts.activeRoster ?? 0}`}
          detail={`${projected?.counts.contractSlots ?? 0} contracts`}
        />
      </div>

      {(projected?.violations.length || projected?.warnings.length) ? (
        <Card title="Projected compliance">
          <ViolationList items={[...(projected?.violations ?? []), ...(projected?.warnings ?? [])]} />
        </Card>
      ) : (
        <Card title="Projected compliance">
          <p className="text-sm text-good">✓ No violations in the projected season.</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Proposed transactions (applied in order)">
          {projection.transactions.length === 0 ? (
            <p className="text-sm text-ink-muted">No transactions yet — add one on the right.</p>
          ) : (
            <ul className="space-y-2">
              {projection.transactions.map((tx) => (
                <li key={tx.id} className={`rounded-md border border-line px-3 py-2 text-sm ${tx.isEnabled ? "" : "opacity-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{tx.label}</span>{" "}
                      <span className="text-xs text-ink-muted">({tx.transactionType.replace(/_/g, " ")})</span>
                      {!tx.isEnabled && <span className="ml-2 text-xs text-warn">disabled</span>}
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 gap-2">
                        <form action={toggleScenarioTransactionAction}>
                          <input type="hidden" name="organizationId" value={ctx.org.id} />
                          <input type="hidden" name="scenarioId" value={scenario.id} />
                          <input type="hidden" name="transactionId" value={tx.id} />
                          <button className="text-xs text-ink-muted hover:text-ink">
                            {tx.isEnabled ? "Disable" : "Enable"}
                          </button>
                        </form>
                        <form action={removeScenarioTransactionAction}>
                          <input type="hidden" name="organizationId" value={ctx.org.id} />
                          <input type="hidden" name="scenarioId" value={scenario.id} />
                          <input type="hidden" name="transactionId" value={tx.id} />
                          <button className="text-xs text-critical hover:underline">Remove</button>
                        </form>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {projection.notes.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-line pt-3">
              {projection.notes.map((n, i) => (
                <p key={i} className={`text-xs ${n.level === "warning" ? "text-warn" : "text-ink-muted"}`}>
                  {n.level === "warning" ? "⚠ " : "ℹ "}
                  {n.transactionLabel}: {n.message}
                </p>
              ))}
            </div>
          )}
          {projection.invalidTransactions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              {projection.invalidTransactions.map((t) => (
                <p key={t.id} className="text-xs text-critical">Invalid payload skipped: {t.label}</p>
              ))}
            </div>
          )}
        </Card>

        <Card title={readOnly ? "Scenario is read-only" : "Add transaction"}>
          {readOnly ? (
            <p className="text-sm text-ink-muted">Unarchive the scenario to make changes.</p>
          ) : (
            <AddTransactionForm
              action={addScenarioTransactionAction}
              organizationId={ctx.org.id}
              scenarioId={scenario.id}
              contracts={teamContracts.map((c) => ({
                id: c.id,
                label: `${c.playerName} (${c.position}, ${moneyCompact(c.aav)} AAV)`,
              }))}
              seasons={projection.seasons.map((s) => ({ id: s.id, name: s.name }))}
            />
          )}
        </Card>
      </div>

      <Card title="Multi-season impact: official → projected">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Season</Th>
                <Th right>Cap limit</Th>
                <Th right>Official charge</Th>
                <Th right>Projected charge</Th>
                <Th right>Official space</Th>
                <Th right>Projected space</Th>
                <Th right>Δ space</Th>
                <Th right>Violations</Th>
              </tr>
            </thead>
            <tbody>
              {projection.seasons.map((s, i) => {
                const o = projection.officialResults[i];
                const p = projection.projectedResults[i];
                if (!o || !p) return null;
                const d = p.totals.capSpace - o.totals.capSpace;
                return (
                  <tr key={s.id} className="border-b border-line/50 last:border-0">
                    <Td>{s.name}</Td>
                    <Td right>{money(o.totals.capUpperLimit)}</Td>
                    <Td right>{money(o.totals.totalCapCharge)}</Td>
                    <Td right>{money(p.totals.totalCapCharge)}</Td>
                    <Td right>{money(o.totals.capSpace)}</Td>
                    <Td right className={p.totals.capSpace < 0 ? "text-critical" : ""}>{money(p.totals.capSpace)}</Td>
                    <Td right className={d < 0 ? "text-critical" : "text-good"}>
                      {d >= 0 ? "+" : ""}
                      {money(d)}
                    </Td>
                    <Td right>{p.violations.length}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
