import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Scouting dashboard" };

export default async function ScoutingDashboard() {
  const ctx = await resolveAppContext();
  const db = getDb();

  const [counts] = await db
    .select({
      prospects: sql<number>`count(*)::int`,
    })
    .from(schema.amateurProspects)
    .where(eq(schema.amateurProspects.organizationId, ctx.org.id));

  const reports = await db
    .select({ report: schema.scoutingReports, name: schema.amateurProspects.fullName, prospectId: schema.amateurProspects.id })
    .from(schema.scoutingReports)
    .innerJoin(schema.amateurProspects, eq(schema.scoutingReports.prospectId, schema.amateurProspects.id))
    .where(eq(schema.scoutingReports.organizationId, ctx.org.id))
    .orderBy(desc(schema.scoutingReports.createdAt))
    .limit(6);

  const movers = await db
    .select({ trend: schema.prospectTrends, name: schema.amateurProspects.fullName, prospectId: schema.amateurProspects.id, position: schema.amateurProspects.position })
    .from(schema.prospectTrends)
    .innerJoin(schema.amateurProspects, eq(schema.prospectTrends.prospectId, schema.amateurProspects.id))
    .where(eq(schema.amateurProspects.organizationId, ctx.org.id))
    .orderBy(desc(schema.prospectTrends.computedAt))
    .limit(200);
  const ascending = movers.filter((m) => ["breakout_season", "rapidly_ascending"].includes(m.trend.classification)).slice(0, 6);
  const concerns = movers.filter((m) => ["production_decline", "over_age_dominance_concern", "small_sample_spike"].includes(m.trend.classification)).slice(0, 6);

  const assignments = await db
    .select()
    .from(schema.scoutingAssignments)
    .where(eq(schema.scoutingAssignments.organizationId, ctx.org.id))
    .limit(50);
  const openAssignments = assignments.filter((a) => a.status === "open" || a.status === "in_progress").length;

  const boards = await db
    .select()
    .from(schema.draftBoards)
    .where(eq(schema.draftBoards.organizationId, ctx.org.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Amateur scouting — NCAA Division I men&rsquo;s hockey</h1>
        <p className="text-sm text-ink-muted">
          Statistical inference supports scouts; it never replaces them. All model outputs are
          versioned estimates with explanations.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="NCAA prospects tracked" value={String(counts?.prospects ?? 0)} />
        <StatTile label="Scouting reports" value={String(reports.length >= 6 ? "6+" : reports.length)} detail="Most recent shown below" />
        <StatTile label="Open assignments" value={String(openAssignments)} />
        <StatTile label="Boards" value={String(boards.length)} detail={boards.map((b) => b.name).join(" · ") || "None yet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Trending up (year-over-year, model riq-trend-v0.1)">
          {ascending.length === 0 ? (
            <p className="text-sm text-ink-muted">No ascending trends stored yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {ascending.map((m) => (
                <li key={m.trend.id} className="flex justify-between gap-2">
                  <Link href={`/scouting/players/${m.prospectId}`} className="truncate hover:text-accent-text">
                    {m.name} <span className="text-xs text-ink-muted">{m.position}</span>
                  </Link>
                  <span className="shrink-0 text-good">{TREND_LABELS[m.trend.classification as TrendClassification] ?? m.trend.classification}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Risk signals">
          {concerns.length === 0 ? (
            <p className="text-sm text-ink-muted">No risk-flagged trends stored yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {concerns.map((m) => (
                <li key={m.trend.id} className="flex justify-between gap-2">
                  <Link href={`/scouting/players/${m.prospectId}`} className="truncate hover:text-accent-text">
                    {m.name} <span className="text-xs text-ink-muted">{m.position}</span>
                  </Link>
                  <span className="shrink-0 text-warn">{TREND_LABELS[m.trend.classification as TrendClassification] ?? m.trend.classification}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent scouting reports">
        {reports.length === 0 ? (
          <p className="text-sm text-ink-muted">No reports yet — open a prospect profile to file one.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Prospect</Th>
                <Th>Viewing</Th>
                <Th>Risk</Th>
                <Th>Projection</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report.id} className="border-b border-line/50 last:border-0">
                  <Td>
                    <Link href={`/scouting/players/${r.prospectId}`} className="font-medium hover:text-accent-text">{r.name}</Link>
                  </Td>
                  <Td className="text-ink-secondary">{r.report.viewingType}</Td>
                  <Td className={r.report.risk === "high" ? "text-critical" : r.report.risk === "low" ? "text-good" : "text-warn"}>
                    {r.report.risk ?? "—"}
                  </Td>
                  <Td className="text-ink-secondary">{r.report.nhlProjection ?? "—"}</Td>
                  <Td className="text-ink-secondary">{formatDate(r.report.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
