import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getComparison } from "@/server/services/fitService";
import { ScoutingError } from "@/server/services/scoutingService";
import { addToWatchlistAction } from "@/server/actions/scoutingActions";
import { WatchlistAddForm } from "@/components/ScoutingForms";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { pct } from "@/lib/format";
import { FIT_COMPONENT_KEYS, FIT_COMPONENT_LABELS } from "@/lib/scouting/fit";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";

export const metadata: Metadata = { title: "Prospect comparison" };

interface StoredComponent {
  key: string;
  finalScore: number | null;
  explanation: string;
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).filter(Boolean);

  if (ids.length < 2 || ids.length > 5) {
    return (
      <EmptyState
        title="Select 2–5 prospects to compare"
        body="Tick the checkboxes in the ranked fit table, then press Compare selected."
        cta={{ href: `/scouting/needs/${id}`, label: "Back to the need" }}
      />
    );
  }

  let data;
  try {
    data = await getComparison(id, ids, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const { need, entries } = data;

  const db = getDb();
  const archetypes = await db.select().from(schema.roleArchetypes);
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? (key ?? "—");
  const watchlists = await db
    .select({ id: schema.prospectWatchlists.id, name: schema.prospectWatchlists.name })
    .from(schema.prospectWatchlists)
    .where(eq(schema.prospectWatchlists.organizationId, ctx.org.id))
    .orderBy(asc(schema.prospectWatchlists.name));

  const reports = await db
    .select()
    .from(schema.scoutingReports)
    .where(eq(schema.scoutingReports.organizationId, ctx.org.id));
  const latestReport = new Map<string, (typeof reports)[number]>();
  for (const r of [...reports].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (!latestReport.has(r.prospectId)) latestReport.set(r.prospectId, r);
  }

  const comp = (e: (typeof entries)[number], key: string): StoredComponent | null => {
    const list = ((e.score?.components as { list?: StoredComponent[] } | null)?.list ?? []);
    return list.find((c) => c.key === key) ?? null;
  };

  // Decision support: which prospect leads on each component (no auto-pick).
  const leaders = FIT_COMPONENT_KEYS.map((key) => {
    let best: { name: string; score: number } | null = null;
    let tie = false;
    for (const e of entries) {
      const s = comp(e, key)?.finalScore ?? null;
      if (s === null) continue;
      if (!best || s > best.score) {
        best = { name: e.prospect.fullName, score: s };
        tie = false;
      } else if (s === best.score) tie = true;
    }
    return { key, best, tie };
  }).filter((l) => l.best !== null);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/scouting/needs/${need.id}`} className="text-sm text-accent-text hover:underline">
          ← {need.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Comparison against &ldquo;{need.name}&rdquo;</h1>
        <p className="text-sm text-ink-muted">
          Decision support only — the evidence below is presented side by side; no automatic recommendation is made.
        </p>
      </div>

      <Card title="Overview">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Attribute</Th>
                {entries.map((e) => (
                  <Th key={e.prospect.id}>
                    <Link href={`/scouting/players/${e.prospect.id}`} className="hover:text-accent-text">
                      {e.prospect.fullName}
                    </Link>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line/50">
                <Td className="text-ink-secondary">Overall fit</Td>
                {entries.map((e) => (
                  <Td key={e.prospect.id} className="font-medium">
                    {e.score ? `${e.score.overallScore.toFixed(1)} / 100` : "not computed"}
                    {e.score?.confidence != null && (
                      <span className="ml-1 text-xs font-normal text-ink-muted">conf {pct(e.score.confidence)}</span>
                    )}
                  </Td>
                ))}
              </tr>
              {(
                [
                  ["Position / hand", (e: (typeof entries)[number]) => `${e.prospect.position} / ${e.prospect.shootsCatches ?? "?"}`],
                  ["Class year", (e: (typeof entries)[number]) => e.prospect.classYear],
                  ["Age (latest season)", (e: (typeof entries)[number]) => e.input?.age?.toString() ?? "—"],
                  ["Statistical role (top)", (e: (typeof entries)[number]) => roleLabel(e.input?.roleScores[0]?.archetypeKey ?? null)],
                  ["Scout-defined role", (e: (typeof entries)[number]) => (e.prospect.scoutAssignedRoleKey ? roleLabel(e.prospect.scoutAssignedRoleKey) : "—")],
                  ["Trend (YoY)", (e: (typeof entries)[number]) =>
                    e.input?.latestTrendClassification
                      ? TREND_LABELS[e.input.latestTrendClassification as TrendClassification] ?? e.input.latestTrendClassification
                      : "—"],
                  ["Draft status", (e: (typeof entries)[number]) =>
                    e.prospect.nhlDraftStatus === "drafted"
                      ? `drafted (${e.prospect.nhlRightsHolder ?? "rights held"})`
                      : `undrafted · CFA ${e.prospect.collegeFreeAgentStatus}`],
                  ["Report risk", (e: (typeof entries)[number]) => e.input?.reportRisk ?? "no report"],
                ] as Array<[string, (e: (typeof entries)[number]) => string]>
              ).map(([labelText, fn]) => (
                <tr key={labelText} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">{labelText}</Td>
                  {entries.map((e) => (
                    <Td key={e.prospect.id}>{fn(e)}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Every fit component (final score; hover rows in the profile for full detail)">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Component</Th>
                {entries.map((e) => <Th key={e.prospect.id} right>{e.prospect.fullName.split(" ")[1] ?? e.prospect.fullName}</Th>)}
              </tr>
            </thead>
            <tbody>
              {FIT_COMPONENT_KEYS.map((key) => (
                <tr key={key} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">{FIT_COMPONENT_LABELS[key]}</Td>
                  {entries.map((e) => {
                    const c = comp(e, key);
                    return (
                      <Td key={e.prospect.id} right>
                        <span title={c?.explanation}>{c?.finalScore != null ? c.finalScore.toFixed(0) : "n/a"}</span>
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          &ldquo;n/a&rdquo; means the input is missing — the component is excluded from the overall and confidence drops; missing data is never scored as zero.
        </p>
      </Card>

      <Card title="Decision-support summary (evidence, not a verdict)">
        <ul className="space-y-1 text-sm text-ink-secondary">
          {leaders.map((l) => (
            <li key={l.key}>
              · <span className="text-ink">{FIT_COMPONENT_LABELS[l.key]}</span>: {l.tie ? "tied at the top" : `${l.best!.name} leads`} ({l.best!.score.toFixed(0)})
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {entries.map((e) => {
            const report = latestReport.get(e.prospect.id);
            const warnings = ((e.score?.explanation as { warnings?: string[] } | null)?.warnings ?? []);
            return (
              <div key={e.prospect.id} className="rounded-md border border-line p-3 text-sm">
                <p className="font-medium">{e.prospect.fullName}</p>
                {report?.strengths && <p className="text-xs text-good">Strengths: {report.strengths}</p>}
                {report?.concerns && <p className="text-xs text-warn">Concerns: {report.concerns}</p>}
                {!report && <p className="text-xs text-ink-muted">No scouting report on file.</p>}
                {warnings.length > 0 && <p className="text-xs text-warn">⚠ Missing data: {warnings.join("; ")}</p>}
                <div className="mt-2">
                  <WatchlistAddForm
                    action={addToWatchlistAction}
                    organizationId={ctx.org.id}
                    prospectId={e.prospect.id}
                    watchlists={watchlists}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
