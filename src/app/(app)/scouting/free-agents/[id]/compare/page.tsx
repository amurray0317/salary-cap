import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getCfaBoardDetail } from "@/server/services/boardService";
import { computePercentilePanel, computeTrends, ScoutingError } from "@/server/services/scoutingService";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";

export const metadata: Metadata = { title: "CFA comparison" };

const GRADE_KEYS = ["hockey_sense", "skating", "puck_skills", "compete", "defensive_play"];

export default async function CfaComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const sp = await searchParams;
  const ids = [...new Set((Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).filter(Boolean))];
  if (ids.length < 2 || ids.length > 5) {
    return (
      <EmptyState
        title="Select 2–5 candidates to compare"
        body={`You selected ${ids.length}. Tick checkboxes on the board, then press Compare selected.`}
        cta={{ href: `/scouting/free-agents/${id}`, label: "Back to the board" }}
      />
    );
  }

  let detail;
  try {
    detail = await getCfaBoardDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const chosen = ids.map((eid) => detail.entries.find((r) => r.e.id === eid)).filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (chosen.length !== ids.length) notFound();

  const db = getDb();
  const prospectIds = chosen.map((r) => r.p.id);
  const reports = await db
    .select()
    .from(schema.scoutingReports)
    .where(and(eq(schema.scoutingReports.organizationId, ctx.org.id), inArray(schema.scoutingReports.prospectId, prospectIds)))
    .orderBy(desc(schema.scoutingReports.createdAt));
  const latestReport = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latestReport.has(r.prospectId)) latestReport.set(r.prospectId, r);
  const archetypes = await db.select().from(schema.roleArchetypes);
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? key ?? "—";
  const roleRows = await db
    .select({ prospectId: schema.prospectRoleScores.prospectId, score: schema.prospectRoleScores.score, key: schema.roleArchetypes.key })
    .from(schema.prospectRoleScores)
    .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
    .where(inArray(schema.prospectRoleScores.prospectId, prospectIds));
  const topRole = new Map<string, (typeof roleRows)[number]>();
  for (const r of roleRows) if ((topRole.get(r.prospectId)?.score ?? -1) < r.score) topRole.set(r.prospectId, r);

  const extras = new Map<string, { trend: string | null; ppgPct: number | null | undefined; agePct: number | null | undefined }>();
  for (const r of chosen) {
    const trends = await computeTrends(r.p.id, ctx.org.id);
    const yoy = [...trends].reverse().find((t) => t.kind === "year_over_year");
    const panel = await computePercentilePanel(r.p.id, ctx.org.id);
    extras.set(r.p.id, {
      trend: yoy?.classification ?? null,
      ppgPct: panel.position?.percentiles.ppg,
      agePct: panel.position?.percentiles.ageAdjustedPpg,
    });
  }

  type Row = (typeof chosen)[number];
  const rows: Array<[string, (r: Row) => string]> = [
    ["Signing priority", (r) => `#${r.e.priorityRank}`],
    ["Position / hand", (r) => `${r.p.position} / ${r.p.shootsCatches ?? "?"}`],
    ["NHL rights", (r) => r.e.nhlRightsStatus.replace(/_/g, " ")],
    ["Remaining eligibility", (r) => r.e.remainingEligibility ?? "—"],
    ["Expected availability", (r) => (r.e.expectedAvailability ? formatDate(r.e.expectedAvailability) : "—")],
    ["Readiness", (r) => r.e.readiness?.replace(/_/g, " ") ?? "—"],
    ["Projected AHL / NHL role", (r) => `${r.e.projectedAhlRole ?? "—"} / ${r.e.projectedNhlRole ?? "—"}`],
    ["Organizational fit", (r) => r.e.fitScore?.toFixed(1) ?? "no fit score"],
    ["Statistical role", (r) => (topRole.has(r.p.id) ? `${roleLabel(topRole.get(r.p.id)!.key)} (${topRole.get(r.p.id)!.score})` : "—")],
    ["Scout-defined role", (r) => (r.p.scoutAssignedRoleKey ? roleLabel(r.p.scoutAssignedRoleKey) : "—")],
    ["Trend (year over year)", (r) => {
      const t = extras.get(r.p.id)?.trend;
      return t ? (TREND_LABELS[t as TrendClassification] ?? t) : "—";
    }],
    ["PPG percentile (position)", (r) => (extras.get(r.p.id)?.ppgPct != null ? `${extras.get(r.p.id)!.ppgPct}th` : "pool < 8")],
    ["Age-adjusted PPG percentile", (r) => (extras.get(r.p.id)?.agePct != null ? `${extras.get(r.p.id)!.agePct}th` : "pool < 8")],
    ["Risk (latest report)", (r) => latestReport.get(r.p.id)?.risk ?? "no report"],
    ["Floor / ceiling (latest report)", (r) => {
      const rep = latestReport.get(r.p.id);
      return rep ? `${rep.professionalFloor ?? "—"} / ${rep.professionalCeiling ?? "—"}` : "no report";
    }],
    ["Signing competition", (r) => r.e.marketCompetition ?? "—"],
    ["Relationship", (r) => r.e.relationshipStatus.replace(/_/g, " ")],
  ];

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/scouting/free-agents/${detail.board.id}`} className="text-sm text-accent-text hover:underline">← {detail.board.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">Candidate comparison — {detail.board.name}</h1>
        <p className="text-sm text-ink-muted">Evidence side by side. No automatic signing recommendation is produced.</p>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Attribute</Th>
                {chosen.map((r) => (
                  <Th key={r.e.id}><Link href={`/scouting/players/${r.p.id}`} className="hover:text-accent-text">{r.p.fullName}</Link></Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">{label}</Td>
                  {chosen.map((r) => <Td key={r.e.id}>{fn(r)}</Td>)}
                </tr>
              ))}
              {GRADE_KEYS.map((g) => (
                <tr key={g} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">Grade: {g.replace(/_/g, " ")}</Td>
                  {chosen.map((r) => {
                    const grades = (latestReport.get(r.p.id)?.grades ?? {}) as Record<string, number>;
                    return <Td key={r.e.id}>{grades[g] ?? (latestReport.has(r.p.id) ? "not graded" : "no report")}</Td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Missing inputs are shown as &ldquo;—&rdquo;, &ldquo;no report&rdquo;, or &ldquo;pool &lt; 8&rdquo; — never estimated.</p>
      </Card>
    </div>
  );
}
