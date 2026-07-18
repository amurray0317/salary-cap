import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const scenarios = await db
    .select({ id: schema.scenarios.id, name: schema.scenarios.name })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.organizationId, ctx.org.id))
    .orderBy(desc(schema.scenarios.updatedAt))
    .limit(10);

  if (!ctx.team || !ctx.season) {
    return <EmptyState title="No team context" body="Create a team to generate reports." />;
  }

  const reports = [
    {
      title: "Current roster (CSV)",
      body: "Roster with statuses, cap hits, and contract terms for the selected season.",
      href: `/api/export/roster`,
    },
    {
      title: "Future cap commitments (CSV)",
      body: "Season-by-season cap charge, space, retained, dead cap, and violations.",
      href: `/api/export/commitments`,
    },
    {
      title: "Player valuations (CSV)",
      body: "Stored market-value estimates with confidence and model version.",
      href: `/api/export/valuations`,
    },
    {
      title: "Printable roster report (PDF via browser)",
      body: "Print-optimized report with commitments, top contracts, and compliance summary — use your browser's Save as PDF.",
      href: `/reports/roster`,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Reports & exports</h1>
        <p className="text-sm text-ink-muted">
          Exports are stamped with generation time, data timestamps, and model versions where
          applicable.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.title} title={r.title}>
            <p className="text-sm text-ink-muted">{r.body}</p>
            <a href={r.href} className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              Generate
            </a>
          </Card>
        ))}
        <Card title="Scenario comparison (CSV)">
          <p className="text-sm text-ink-muted">Export any scenario against the official roster.</p>
          {scenarios.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No scenarios yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {scenarios.map((s) => (
                <li key={s.id}>
                  <a href={`/api/export/comparison?ids=${s.id}`} className="text-sm text-accent-text hover:underline">
                    {s.name} →
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Link href="/scenarios/compare" className="mt-3 inline-block text-sm text-ink-secondary hover:text-ink">
            Multi-scenario comparison →
          </Link>
        </Card>
      </div>
    </div>
  );
}
