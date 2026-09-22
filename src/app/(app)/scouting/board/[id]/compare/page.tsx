import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getBoardDetail } from "@/server/services/boardService";
import { computePercentilePanel, computeTrends, ScoutingError } from "@/server/services/scoutingService";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";

export const metadata: Metadata = { title: "Board comparison" };

const GRADE_KEYS = ["hockey_sense", "skating", "puck_skills", "compete", "defensive_play"];

export default async function BoardComparePage({
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
        title="Select 2–5 prospects to compare"
        body={`You selected ${ids.length}. Tick checkboxes on the board, then press Compare selected.`}
        cta={{ href: `/scouting/board/${id}`, label: "Back to the board" }}
      />
    );
  }

  let detail;
  try {
    detail = await getBoardDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const { board, entries, consensus } = detail;
  const chosen = ids.map((pid) => entries.find((r) => r.p.id === pid)).filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (chosen.length !== ids.length) notFound(); // an id not on this org's board

  const db = getDb();
  const consensusBy = new Map(consensus.map((c) => [c.prospectId, c]));
  const reports = await db
    .select()
    .from(schema.scoutingReports)
    .where(and(eq(schema.scoutingReports.organizationId, ctx.org.id), inArray(schema.scoutingReports.prospectId, ids)))
    .orderBy(desc(schema.scoutingReports.createdAt));
  const latestReport = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latestReport.has(r.prospectId)) latestReport.set(r.prospectId, r);
  const archetypes = await db.select().from(schema.roleArchetypes);
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? key ?? "—";
  const roleRows = await db
    .select({ prospectId: schema.prospectRoleScores.prospectId, score: schema.prospectRoleScores.score, confidence: schema.prospectRoleScores.confidence, key: schema.roleArchetypes.key })
    .from(schema.prospectRoleScores)
    .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
    .where(inArray(schema.prospectRoleScores.prospectId, ids));
  const topRole = new Map<string, (typeof roleRows)[number]>();
  for (const r of roleRows) if ((topRole.get(r.prospectId)?.score ?? -1) < r.score) topRole.set(r.prospectId, r);

  const extras = new Map<string, { trend: string | null; percentiles: Awaited<ReturnType<typeof computePercentilePanel>> }>();
  for (const r of chosen) {
    const trends = await computeTrends(r.p.id, ctx.org.id);
    const yoy = [...trends].reverse().find((t) => t.kind === "year_over_year");
    extras.set(r.p.id, { trend: yoy?.classification ?? null, percentiles: await computePercentilePanel(r.p.id, ctx.org.id) });
  }

  const missing = (r: (typeof chosen)[number]): string[] => {
    const out: string[] = [];
    if (r.e.modelRank === null) out.push("no statistical-model rank");
    const c = consensusBy.get(r.p.id);
    if (!c) out.push("no scout rankings");
    else if (c.insufficient) out.push(`only ${c.submissions} scout ranking(s)`);
    if (r.e.fitRank === null) out.push("no organizational-fit score");
    if (!latestReport.has(r.p.id)) out.push("no scouting report");
    if (!r.p.scoutAssignedRoleKey) out.push("no scout-defined role");
    if (extras.get(r.p.id)?.percentiles.position?.percentiles.ppg == null) out.push("percentile pool < 8");
    return out;
  };

  const rows: Array<[string, (r: (typeof chosen)[number]) => string]> = [
    ["Board rank", (r) => `#${r.e.overallRank}`],
    ["Position rank", (r) => (r.e.positionRank ? `#${r.e.positionRank} (${r.p.positionGroup})` : "—")],
    ["Statistical-model rank", (r) => (r.e.modelRank ? `#${r.e.modelRank}` : "—")],
    ["Scout consensus", (r) => {
      const c = consensusBy.get(r.p.id);
      if (!c) return "no rankings";
      return `${c.meanRank.toFixed(1)} mean · ${c.medianRank} median · ${c.bestRank}–${c.worstRank} (n=${c.submissions}${c.insufficient ? ", ⚠ few" : ""})`;
    }],
    ["Organizational-fit rank", (r) => (r.e.fitRank ? `#${r.e.fitRank} · ${r.e.fitScore?.toFixed(1) ?? "?"}` : "—")],
    ["Director final rank", (r) => (r.e.directorFinalRank ? `#${r.e.directorFinalRank}` : "—")],
    ["Position / hand", (r) => `${r.p.position} / ${r.p.shootsCatches ?? "?"}`],
    ["Statistical role", (r) => {
      const t = topRole.get(r.p.id);
      return t ? `${roleLabel(t.key)} (${t.score}, conf ${(t.confidence * 100).toFixed(0)}%)` : "—";
    }],
    ["Scout-defined role", (r) => (r.p.scoutAssignedRoleKey ? roleLabel(r.p.scoutAssignedRoleKey) : "—")],
    ["Trend (year over year)", (r) => {
      const t = extras.get(r.p.id)?.trend;
      return t ? (TREND_LABELS[t as TrendClassification] ?? t) : "—";
    }],
    ["PPG percentile (position)", (r) => {
      const p = extras.get(r.p.id)?.percentiles.position?.percentiles.ppg;
      return p != null ? `${p}th` : "pool < 8";
    }],
    ["Age-adjusted PPG percentile", (r) => {
      const p = extras.get(r.p.id)?.percentiles.position?.percentiles.ageAdjustedPpg;
      return p != null ? `${p}th` : "pool < 8";
    }],
    ["Risk", (r) => r.e.risk ?? latestReport.get(r.p.id)?.risk ?? "—"],
    ["Floor", (r) => r.e.floor ?? latestReport.get(r.p.id)?.professionalFloor ?? "—"],
    ["Ceiling", (r) => r.e.ceiling ?? latestReport.get(r.p.id)?.professionalCeiling ?? "—"],
    ["Viewings / reports", (r) => `${r.e.viewingCount} / ${r.e.reportCount}`],
  ];

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/scouting/board/${board.id}`} className="text-sm text-accent-text hover:underline">← {board.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">Prospect comparison — {board.name}</h1>
        <p className="text-sm text-ink-muted">Evidence side by side. No automatic selection recommendation is produced.</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Attribute</Th>
                {chosen.map((r) => (
                  <Th key={r.p.id}>
                    <Link href={`/scouting/players/${r.p.id}`} className="hover:text-accent-text">{r.p.fullName}</Link>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">{label}</Td>
                  {chosen.map((r) => <Td key={r.p.id}>{fn(r)}</Td>)}
                </tr>
              ))}
              {GRADE_KEYS.map((g) => (
                <tr key={g} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">Grade: {g.replace(/_/g, " ")}</Td>
                  {chosen.map((r) => {
                    const grades = (latestReport.get(r.p.id)?.grades ?? {}) as Record<string, number>;
                    return <Td key={r.p.id}>{grades[g] ?? (latestReport.has(r.p.id) ? "not graded" : "no report")}</Td>;
                  })}
                </tr>
              ))}
              <tr>
                <Td className="text-ink-secondary">Missing-data warnings</Td>
                {chosen.map((r) => {
                  const m = missing(r);
                  return (
                    <Td key={r.p.id} className={m.length > 0 ? "text-warn" : "text-good"}>
                      {m.length > 0 ? `⚠ ${m.join("; ")}` : "complete"}
                    </Td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
