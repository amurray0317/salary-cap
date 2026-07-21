import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getRankedFits } from "@/server/services/fitService";
import { archiveNeedAction, runFitAction, updateNeedAction } from "@/server/actions/fitActions";
import { NeedForm } from "@/components/NeedForm";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate, pct } from "@/lib/format";
import { FIT_COMPONENT_LABELS, type FitComponentKey } from "@/lib/scouting/fit";

export const metadata: Metadata = { title: "Need detail" };

interface Search {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
  cols?: string | string[];
}

const PAGE_SIZE = 25;

/** Component columns the user can toggle in the ranked table. */
const COMPONENT_COLS: FitComponentKey[] = [
  "position", "handedness", "stat_role", "timeline", "roster_depth", "contract_expiry", "risk",
];

interface StoredComponent {
  key: string;
  finalScore: number | null;
}

export default async function NeedDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();

  // Org isolation before anything else.
  const [need] = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(and(eq(schema.organizationalNeeds.id, id), eq(schema.organizationalNeeds.organizationId, ctx.org.id)))
    .limit(1);
  if (!need) notFound();

  const requirements = await db
    .select()
    .from(schema.organizationalNeedRequirements)
    .where(eq(schema.organizationalNeedRequirements.needId, need.id));
  const rosterLinks = await db
    .select()
    .from(schema.organizationalNeedRosterLinks)
    .where(eq(schema.organizationalNeedRosterLinks.needId, need.id))
    .orderBy(asc(schema.organizationalNeedRosterLinks.createdAt));
  const runs = await db
    .select()
    .from(schema.fitCalculationRuns)
    .where(and(eq(schema.fitCalculationRuns.organizationId, ctx.org.id), eq(schema.fitCalculationRuns.needId, need.id)))
    .orderBy(desc(schema.fitCalculationRuns.startedAt))
    .limit(5);
  const latestRun = runs[0] ?? null;
  const snapshots = latestRun
    ? {
        org: (
          await db
            .select()
            .from(schema.organizationalDepthSnapshots)
            .where(eq(schema.organizationalDepthSnapshots.runId, latestRun.id))
            .limit(1)
        )[0],
        pool: (
          await db
            .select()
            .from(schema.prospectPoolDepthSnapshots)
            .where(eq(schema.prospectPoolDepthSnapshots.runId, latestRun.id))
            .limit(1)
        )[0],
      }
    : null;

  const archetypes = await db.select().from(schema.roleArchetypes).orderBy(asc(schema.roleArchetypes.label));
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? (key ?? "—");

  const allFits = await getRankedFits(need.id, ctx.org.id);

  // Top persisted statistical role per listed prospect (batched).
  const prospectIds = allFits.map((r) => r.p.id);
  const topRole = new Map<string, string>();
  if (prospectIds.length > 0) {
    const roleRows = await db
      .select({
        prospectId: schema.prospectRoleScores.prospectId,
        score: schema.prospectRoleScores.score,
        key: schema.roleArchetypes.key,
      })
      .from(schema.prospectRoleScores)
      .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
      .where(inArray(schema.prospectRoleScores.prospectId, prospectIds));
    const best = new Map<string, number>();
    for (const r of roleRows) {
      if ((best.get(r.prospectId) ?? -1) < r.score) {
        best.set(r.prospectId, r.score);
        topRole.set(r.prospectId, r.key);
      }
    }
  }

  const componentScore = (row: (typeof allFits)[number], key: string): number | null => {
    const list = (row.f.components as { list?: StoredComponent[] }).list ?? [];
    return list.find((c) => c.key === key)?.finalScore ?? null;
  };

  // Search / sort / paginate.
  const q = (sp.q ?? "").toLowerCase();
  let rows = q ? allFits.filter((r) => r.p.fullName.toLowerCase().includes(q)) : allFits;
  const sortKey = sp.sort ?? "overall";
  const dir = sp.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const va =
      sortKey === "overall" ? a.f.overallScore
      : sortKey === "confidence" ? (a.f.confidence ?? -1)
      : (componentScore(a, sortKey) ?? -1);
    const vb =
      sortKey === "overall" ? b.f.overallScore
      : sortKey === "confidence" ? (b.f.confidence ?? -1)
      : (componentScore(b, sortKey) ?? -1);
    return dir * (va - vb);
  });
  const page = Math.max(1, Number(sp.page) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rankOf = new Map(allFits.map((r, i) => [r.f.id, i + 1]));

  const colsParam = Array.isArray(sp.cols) ? sp.cols : sp.cols ? sp.cols.split(",") : null;
  const visibleComponents = new Set(colsParam ?? COMPONENT_COLS);

  const filterEntries = Object.entries(sp)
    .filter(([k, v]) => v && k !== "page")
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v] as [string, string]);
  const filterQuery = new URLSearchParams(filterEntries).toString();
  const pageHref = (n: number) => `/scouting/needs/${need.id}?${filterQuery}${filterQuery ? "&" : ""}page=${n}`;

  const canManage = roleHasCapability(ctx.role, "manage_org_needs");
  const canRun = roleHasCapability(ctx.role, "run_fit_models");
  const canExport = roleHasCapability(ctx.role, "export_scouting");

  const minGrades: Record<string, number> = {};
  for (const r of requirements) {
    if (r.requirementType === "min_grade" && r.minValue !== null) minGrades[r.key] = r.minValue;
  }

  const selectCls =
    "rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/scouting/needs" className="text-sm text-accent-text hover:underline">← Organizational needs</Link>
          <h1 className="mt-1 text-xl font-semibold">{need.name}{!need.isActive && " (archived)"}</h1>
          <p className="text-sm text-ink-muted">
            {need.position}{need.secondaryPosition ? ` / ${need.secondaryPosition}` : ""}
            {need.handedness ? ` · ${need.handedness}-hand` : " · any hand"} · target{" "}
            {roleLabel(need.targetRoleKey)}
            {need.targetScoutRoleKey ? ` · scout-role target ${roleLabel(need.targetScoutRoleKey)}` : ""} · arrival{" "}
            {need.earliestArrivalYears}–{need.latestArrivalYears}y (target {need.timelineYears}y
            {need.targetArrivalSeason ? `, ${need.targetArrivalSeason}` : ""}) · priority {need.priority} ·{" "}
            {need.preferredAcquisition.replace(/_/g, " ")} · max risk {need.maxRiskTolerance}
          </p>
          {Object.keys(minGrades).length > 0 && (
            <p className="text-sm text-ink-muted">
              Grade minimums: {Object.entries(minGrades).map(([k, v]) => `${k.replace(/_/g, " ")} ≥ ${v}`).join(" · ")}
            </p>
          )}
          {need.description && <p className="text-sm text-ink-muted">{need.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRun && need.isActive && (
            <form action={runFitAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="needId" value={need.id} />
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
                {latestRun ? "Re-run fit model" : "Run fit model"}
              </button>
            </form>
          )}
          {canExport && allFits.length > 0 && (
            <a
              href={`/api/export/fit?needId=${need.id}`}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
            >
              Export ranked CSV
            </a>
          )}
          {canManage && (
            <form action={archiveNeedAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="needId" value={need.id} />
              <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
                {need.isActive ? "Archive" : "Unarchive"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Latest run"
          value={latestRun ? formatDate(latestRun.startedAt) : "never"}
          detail={latestRun ? `${latestRun.scoredCount} of ${latestRun.prospectsEvaluated} scored · ${latestRun.modelVersion}` : "Run the model to rank prospects"}
        />
        <StatTile
          label="Roster depth (snapshot)"
          value={snapshots?.org ? `${(snapshots.org.snapshot as { activeContracts?: number }).activeContracts ?? "—"}` : "—"}
          detail={snapshots?.org ? `active ${need.position} contracts · ${(snapshots.org.snapshot as { expiringWithinWindow?: number }).expiringWithinWindow ?? 0} expiring ≤ ${need.latestArrivalYears}y` : "no snapshot yet"}
        />
        <StatTile
          label="Pool depth (snapshot)"
          value={snapshots?.pool ? `${(snapshots.pool.snapshot as { prospects?: number }).prospects ?? "—"}` : "—"}
          detail={snapshots?.pool ? `${need.position} prospects in pool · ${(snapshots.pool.snapshot as { atTargetRole?: number }).atTargetRole ?? 0} at target role` : "no snapshot yet"}
        />
        <StatTile label="Ranked prospects" value={`${allFits.length}`} detail={`model ${latestRun?.modelVersion ?? "riq-fit-v0.2"}`} />
      </div>

      {rosterLinks.length > 0 && (
        <Card title="Connected roster context (auto-linked expiring contracts)">
          <ul className="space-y-1 text-sm text-ink-secondary">
            {rosterLinks.map((l) => (
              <li key={l.id}>· {l.note ?? l.linkType}</li>
            ))}
          </ul>
        </Card>
      )}

      {allFits.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No fit scores yet. {canRun ? "Press “Run fit model” to evaluate every eligible NCAA prospect." : "Ask an analyst or director to run the fit model."}
          </p>
        </Card>
      ) : (
        <Card title={`Ranked prospect fits (${rows.length}${q ? ` matching "${sp.q}"` : ""})`}>
          <form method="get" className="mb-3 flex flex-wrap gap-2">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name…" className={`${selectCls} w-44`} />
            <select name="sort" defaultValue={sortKey} className={selectCls}>
              <option value="overall">Sort: Overall fit</option>
              <option value="confidence">Sort: Confidence</option>
              {COMPONENT_COLS.map((k) => (
                <option key={k} value={k}>Sort: {FIT_COMPONENT_LABELS[k]}</option>
              ))}
            </select>
            <select name="dir" defaultValue={sp.dir ?? "desc"} className={selectCls}>
              <option value="desc">High → low</option>
              <option value="asc">Low → high</option>
            </select>
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Apply</button>
            <details className="text-sm">
              <summary className="cursor-pointer px-2 py-1.5 text-ink-muted hover:text-ink">Columns…</summary>
              <div className="mt-1 flex flex-wrap gap-3">
                {COMPONENT_COLS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-ink-secondary">
                    <input type="checkbox" name="cols" value={k} defaultChecked={visibleComponents.has(k)} />
                    {FIT_COMPONENT_LABELS[k]}
                  </label>
                ))}
              </div>
            </details>
          </form>

          <form method="get" action={`/scouting/needs/${need.id}/compare`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th> </Th>
                    <Th right>#</Th>
                    <Th>Prospect</Th>
                    <Th>Pos</Th>
                    <Th>Hand</Th>
                    <Th>School</Th>
                    <Th>Class</Th>
                    <Th>Draft</Th>
                    <Th>Stat role</Th>
                    <Th>Scout role</Th>
                    <Th right>Overall</Th>
                    {COMPONENT_COLS.filter((k) => visibleComponents.has(k)).map((k) => (
                      <Th key={k} right>{FIT_COMPONENT_LABELS[k].replace(" fit", "")}</Th>
                    ))}
                    <Th right>Conf</Th>
                    <Th>Watch</Th>
                    <Th>Computed</Th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.f.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                      <Td><input type="checkbox" name="ids" value={r.p.id} aria-label={`Compare ${r.p.fullName}`} /></Td>
                      <Td right className="text-ink-muted">{rankOf.get(r.f.id)}</Td>
                      <Td>
                        <Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">
                          {r.p.fullName}
                        </Link>
                      </Td>
                      <Td>{r.p.position}</Td>
                      <Td className="text-ink-secondary">{r.p.shootsCatches ?? "—"}</Td>
                      <Td className="max-w-40 truncate text-ink-secondary">{r.schoolName ?? "—"}</Td>
                      <Td className="text-ink-secondary">{r.p.classYear}</Td>
                      <Td className="text-ink-secondary">{r.p.nhlDraftStatus === "drafted" ? "drafted" : "undrafted"}</Td>
                      <Td className="max-w-36 truncate text-ink-secondary">{roleLabel(topRole.get(r.p.id) ?? null)}</Td>
                      <Td className="max-w-36 truncate text-ink-secondary">{r.p.scoutAssignedRoleKey ? roleLabel(r.p.scoutAssignedRoleKey) : "—"}</Td>
                      <Td right className="font-medium">{r.f.overallScore.toFixed(1)}</Td>
                      {COMPONENT_COLS.filter((k) => visibleComponents.has(k)).map((k) => (
                        <Td key={k} right className="text-ink-secondary">{componentScore(r, k)?.toFixed(0) ?? "n/a"}</Td>
                      ))}
                      <Td right className="text-ink-secondary">{r.f.confidence !== null ? pct(r.f.confidence) : "—"}</Td>
                      <Td>{r.onWatchlist ? "✓" : "—"}</Td>
                      <Td className="text-xs text-ink-muted">{formatDate(r.f.computedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span className="flex items-center gap-3">
                <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
                  Compare selected (2–5)
                </button>
                <span>page {page} of {pageCount}</span>
              </span>
              <span className="flex gap-2">
                {page > 1 && <Link href={pageHref(page - 1)} className="text-accent-text hover:underline">← Prev</Link>}
                {page < pageCount && <Link href={pageHref(page + 1)} className="text-accent-text hover:underline">Next →</Link>}
              </span>
            </div>
          </form>
        </Card>
      )}

      {runs.length > 0 && (
        <Card title="Run history">
          <ul className="space-y-1 text-sm text-ink-secondary">
            {runs.map((r) => (
              <li key={r.id}>
                {formatDate(r.startedAt)} — {r.status} · {r.scoredCount}/{r.prospectsEvaluated} scored · {r.modelVersion}
                {(r.warnings as string[]).length > 0 && (
                  <span className="text-warn"> · ⚠ {(r.warnings as string[]).join("; ")}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage && (
        <details className="rounded-lg border border-line bg-navy-900 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Edit need</summary>
          <div className="mt-3">
            <NeedForm
              action={updateNeedAction}
              organizationId={ctx.org.id}
              roles={archetypes.map((a) => ({ key: a.key, label: `[${a.positionGroup}] ${a.label}` }))}
              submitLabel="Save changes"
              initial={{
                needId: need.id,
                name: need.name,
                description: need.description,
                position: need.position,
                secondaryPosition: need.secondaryPosition,
                handedness: need.handedness,
                targetRoleKey: need.targetRoleKey,
                targetScoutRoleKey: need.targetScoutRoleKey,
                priority: need.priority,
                timelineYears: need.timelineYears,
                earliestArrivalYears: need.earliestArrivalYears,
                latestArrivalYears: need.latestArrivalYears,
                targetArrivalSeason: need.targetArrivalSeason,
                preferredAcquisition: need.preferredAcquisition,
                maxRiskTolerance: need.maxRiskTolerance,
                sizePreference: need.sizePreference,
                specialTeamsRequirement: need.specialTeamsRequirement,
                nhlRosterNeed: need.nhlRosterNeed,
                ahlOpportunity: need.ahlOpportunity,
                notes: need.notes,
                minGrades,
              }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
