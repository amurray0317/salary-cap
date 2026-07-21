import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getScenarioProjection } from "@/server/services/scenarioService";
import { applyScenarioAction } from "@/server/actions/scenarioActions";
import { ApplyScenarioForm } from "@/components/ApplyScenarioForm";
import { roleHasCapability } from "@/lib/auth/roles";
import { Card, Td, Th, ViolationList } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "Apply scenario" };

export default async function ApplyScenarioPage({ params }: { params: Promise<{ id: string }> }) {
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
  const baseIdx = Math.max(0, projection.seasons.findIndex((s) => s.id === scenario.baseSeasonId));
  const projected = projection.projectedResults[baseIdx];
  const official = projection.officialResults[baseIdx];

  const enabledTx = projection.transactions.filter((t) => t.isEnabled);
  const canManage = roleHasCapability(ctx.role, "manage_team");
  const blockingCount = projected?.violations.length ?? 0;

  let disabledReason: string | undefined;
  if (scenario.status === "applied") disabledReason = "This scenario has already been applied.";
  else if (scenario.status === "archived") disabledReason = "Archived scenarios cannot be applied — unarchive it first.";
  else if (!canManage) disabledReason = `Your role (${ctx.role.replace(/_/g, " ")}) cannot apply scenarios; ask a general manager or admin.`;
  else if (enabledTx.length === 0) disabledReason = "The scenario has no enabled transactions.";
  else if (blockingCount > 0)
    disabledReason = `The projected roster has ${blockingCount} blocking violation(s). Resolve them before applying.`;
  else if (projection.invalidTransactions.length > 0)
    disabledReason = "The scenario contains transactions with invalid payloads.";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/scenarios/${scenario.id}`} className="text-sm text-accent-text hover:underline">
          ← Back to scenario
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Apply “{scenario.name}” to the official roster</h1>
        <p className="text-sm text-ink-muted">
          Review exactly what will change, then confirm. Until you confirm, official data is
          untouched.
        </p>
      </div>

      <Card title={`Moves to apply (${enabledTx.length}, in order)`}>
        {enabledTx.length === 0 ? (
          <p className="text-sm text-ink-muted">No enabled transactions.</p>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {enabledTx.map((t) => (
              <li key={t.id}>
                <span className="font-medium">{t.label}</span>{" "}
                <span className="text-xs text-ink-muted">({t.transactionType.replace(/_/g, " ")})</span>
              </li>
            ))}
          </ol>
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
      </Card>

      <Card title="Cap impact after applying">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Season</Th>
                <Th right>Charge now</Th>
                <Th right>Charge after</Th>
                <Th right>Space now</Th>
                <Th right>Space after</Th>
              </tr>
            </thead>
            <tbody>
              {projection.seasons.map((s, i) => {
                const o = projection.officialResults[i];
                const p = projection.projectedResults[i];
                if (!o || !p) return null;
                return (
                  <tr key={s.id} className="border-b border-line/50 last:border-0">
                    <Td>{s.name}</Td>
                    <Td right>{money(o.totals.totalCapCharge)}</Td>
                    <Td right>{money(p.totals.totalCapCharge)}</Td>
                    <Td right>{money(o.totals.capSpace)}</Td>
                    <Td right className={p.totals.capSpace < 0 ? "text-critical" : ""}>
                      {money(p.totals.capSpace)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Base season {projection.seasons[baseIdx]?.name}: official space{" "}
          {money(official?.totals.capSpace ?? 0)} → {money(projected?.totals.capSpace ?? 0)} after
          applying.
        </p>
      </Card>

      {(projected?.violations.length || projected?.warnings.length) ? (
        <Card title="Projected compliance">
          <ViolationList items={[...(projected?.violations ?? []), ...(projected?.warnings ?? [])]} />
        </Card>
      ) : null}

      <Card title="Confirm">
        <ApplyScenarioForm
          action={applyScenarioAction}
          organizationId={ctx.org.id}
          scenarioId={scenario.id}
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
        />
      </Card>
    </div>
  );
}
