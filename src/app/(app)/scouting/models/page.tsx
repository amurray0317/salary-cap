import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, Td, Th } from "@/components/ui";
import { ROLE_MODEL_VERSION, TREND_MODEL_VERSION, FIT_MODEL_VERSION } from "@/lib/scouting/archetypes";
import { roleHasCapability } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Model center" };

const MODEL_CARDS = [
  {
    version: TREND_MODEL_VERSION,
    name: "Trend classifier",
    method: "Threshold rules over year-over-year PPG, shot volume, PP share, sample size, and age.",
    limits: "Season-level thresholds; no schedule-strength adjustment; documented in docs/SCOUTING.md.",
  },
  {
    version: ROLE_MODEL_VERSION,
    name: "Role scorer",
    method: "Position-relative percentiles weighted by the per-archetype weights below; missing inputs reduce confidence and are never imputed.",
    limits: "No time-on-ice or tracking inputs (unavailable for NCAA); goalie inference intentionally low-confidence.",
  },
  {
    version: FIT_MODEL_VERSION,
    name: "Organizational fit",
    method: "Weighted components: position, handedness, role, timeline, contract-depth opportunity (live RosterIQ data), risk tolerance.",
    limits: "Depth uses active contracts only; no AHL affiliate depth until that module ships.",
  },
];

export default async function ModelCenterPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const weights = await db
    .select({ w: schema.roleMetricWeights, a: schema.roleArchetypes })
    .from(schema.roleMetricWeights)
    .innerJoin(schema.roleArchetypes, eq(schema.roleMetricWeights.archetypeId, schema.roleArchetypes.id))
    .where(eq(schema.roleMetricWeights.isActive, true))
    .orderBy(asc(schema.roleArchetypes.positionGroup), asc(schema.roleArchetypes.label), asc(schema.roleMetricWeights.metric));

  const canManage = roleHasCapability(ctx.role, "manage_scouting_models");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Model center</h1>
        <p className="text-sm text-ink-muted">
          Every scouting model is versioned and explained; outputs are estimates that support scout
          judgment. Weights live in the database (role_metric_weights) — never in components.
          {canManage ? " Weight editing UI is on the roadmap; changes currently ship as new seeded versions." : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {MODEL_CARDS.map((m) => (
          <Card key={m.version} title={`${m.name} · ${m.version}`}>
            <p className="text-sm text-ink-secondary">{m.method}</p>
            <p className="mt-2 text-xs text-ink-muted">Known limitations: {m.limits}</p>
          </Card>
        ))}
      </div>

      <Card title={`Role metric weights (${weights.length} active rows, model ${ROLE_MODEL_VERSION})`}>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-navy-900">
              <tr className="border-b border-line">
                <Th>Group</Th>
                <Th>Archetype</Th>
                <Th>Metric</Th>
                <Th right>Weight</Th>
                <Th>Effective</Th>
              </tr>
            </thead>
            <tbody>
              {weights.map(({ w, a }) => (
                <tr key={w.id} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-muted">{a.positionGroup}</Td>
                  <Td>{a.label}</Td>
                  <Td className="font-mono text-xs">{w.metric}</Td>
                  <Td right>{w.weight.toFixed(2)}</Td>
                  <Td className="text-ink-secondary">{w.effectiveDate}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
