import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { compareScenarios } from "@/server/services/scenarioService";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "Scenario comparison" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; sel?: string | string[] }>;
}) {
  const ctx = await resolveAppContext();
  const { ids, sel } = await searchParams;
  const db = getDb();

  const allScenarios = await db
    .select({ id: schema.scenarios.id, name: schema.scenarios.name, teamId: schema.scenarios.teamId, status: schema.scenarios.status })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.organizationId, ctx.org.id))
    .orderBy(desc(schema.scenarios.updatedAt));

  // Only scenarios owned by this org can be compared (isolation).
  const fromSel = Array.isArray(sel) ? sel : sel ? [sel] : [];
  const requested = [...(ids ?? "").split(","), ...fromSel].map((s) => s.trim()).filter(Boolean);
  const ownedIds = new Set(allScenarios.map((s) => s.id));
  const selected = requested.filter((id) => ownedIds.has(id)).slice(0, 5);

  const comparison = selected.length > 0 ? await compareScenarios(selected) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Scenario comparison</h1>
          <p className="text-sm text-ink-muted">
            Compare up to five scenarios (same team) against the official roster.
          </p>
        </div>
        {comparison && (
          <a
            href={`/api/export/comparison?ids=${selected.join(",")}`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Export CSV
          </a>
        )}
      </div>

      <Card title="Select scenarios">
        <form method="get" className="space-y-2">
          {allScenarios.length === 0 ? (
            <p className="text-sm text-ink-muted">No scenarios yet.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {allScenarios.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    name="sel"
                    value={s.id}
                    defaultChecked={selected.includes(s.id)}
                    className="accent-[#0d9488]"
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs text-ink-muted">({s.status})</span>
                </label>
              ))}
            </div>
          )}
          <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
            Compare selected
          </button>
        </form>
      </Card>

      {!comparison ? (
        <EmptyState title="Nothing selected" body="Pick one or more scenarios above and press Compare selected." />
      ) : (
        <Card title={`Official vs scenarios — ${comparison.seasonName}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Metric</Th>
                  <Th right>Official</Th>
                  {comparison.scenarioNames.map((n) => (
                    <Th key={n} right>{n}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.metric} className="border-b border-line/50 last:border-0">
                    <Td>{row.metric}</Td>
                    <Td right>{row.format === "money" ? money(row.official) : row.official}</Td>
                    {row.values.map((v, i) => {
                      const diff = v - row.official;
                      return (
                        <Td key={i} right>
                          {row.format === "money" ? money(v) : v}
                          {diff !== 0 && (
                            <span className={`ml-1 text-xs ${diff > 0 ? "text-good" : "text-critical"}`}>
                              ({diff > 0 ? "+" : ""}
                              {row.format === "money" ? money(diff) : diff})
                            </span>
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <Td>Blocking violations</Td>
                  <Td right>{comparison.violationCounts.official}</Td>
                  {comparison.violationCounts.scenarios.map((v, i) => (
                    <Td key={i} right className={v > 0 ? "text-critical" : "text-good"}>{v}</Td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
