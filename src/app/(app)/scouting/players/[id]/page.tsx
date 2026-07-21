import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { computeRoleScores, computeTrends, computePercentilePanel, ageAtSeason } from "@/server/services/scoutingService";
import {
  setScoutRolesAction,
  createScoutingReportAction,
  addToWatchlistAction,
  addToDraftBoardAction,
  computeFitAction,
} from "@/server/actions/scoutingActions";
import { BoardAddForm, ReportForm, WatchlistAddForm } from "@/components/ScoutingForms";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";
import { formatDate, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Prospect profile" };

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const db = getDb();

  // Org isolation before anything else.
  const [prospect] = await db
    .select({ p: schema.amateurProspects, schoolName: schema.schools.name })
    .from(schema.amateurProspects)
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(and(eq(schema.amateurProspects.id, id), eq(schema.amateurProspects.organizationId, ctx.org.id)))
    .limit(1);
  if (!prospect) notFound();
  const p = prospect.p;

  const seasons = await db
    .select()
    .from(schema.prospectSeasons)
    .where(eq(schema.prospectSeasons.prospectId, p.id))
    .orderBy(asc(schema.prospectSeasons.seasonName));
  const { seasonName, scores } = await computeRoleScores(p.id, ctx.org.id);
  const trends = await computeTrends(p.id, ctx.org.id);
  const percentilePanel = await computePercentilePanel(p.id, ctx.org.id);
  const archetypes = await db.select().from(schema.roleArchetypes).orderBy(asc(schema.roleArchetypes.label));
  const groupRoles = archetypes.filter((a) => a.positionGroup === p.positionGroup);
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? key ?? "—";

  const reports = await db
    .select()
    .from(schema.scoutingReports)
    .where(eq(schema.scoutingReports.prospectId, p.id))
    .orderBy(desc(schema.scoutingReports.createdAt));

  const watchlists = await db
    .select()
    .from(schema.prospectWatchlists)
    .where(eq(schema.prospectWatchlists.organizationId, ctx.org.id));
  const memberships = await db
    .select({ watchlistId: schema.prospectWatchlistMembers.watchlistId })
    .from(schema.prospectWatchlistMembers)
    .where(eq(schema.prospectWatchlistMembers.prospectId, p.id));
  const memberOf = new Set(memberships.map((m) => m.watchlistId));

  const boards = await db.select().from(schema.draftBoards).where(eq(schema.draftBoards.organizationId, ctx.org.id));
  const boardEntries = await db
    .select({ e: schema.draftBoardEntries, boardName: schema.draftBoards.name })
    .from(schema.draftBoardEntries)
    .innerJoin(schema.draftBoards, eq(schema.draftBoardEntries.boardId, schema.draftBoards.id))
    .where(and(eq(schema.draftBoardEntries.prospectId, p.id), eq(schema.draftBoards.organizationId, ctx.org.id)));

  const needs = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(and(eq(schema.organizationalNeeds.organizationId, ctx.org.id), eq(schema.organizationalNeeds.isActive, true)));
  const fits = await db
    .select()
    .from(schema.prospectFitScores)
    .where(eq(schema.prospectFitScores.prospectId, p.id));
  const fitByNeed = new Map(fits.map((f) => [f.needId, f]));

  const sourceIds = [p.sourceId, ...seasons.map((s) => s.sourceId)].filter((x): x is string => x !== null);
  const sourceRows = sourceIds.length
    ? await db.select().from(schema.dataSources).where(inArray(schema.dataSources.id, sourceIds))
    : [];
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));

  const comparables = await db
    .select()
    .from(schema.prospectComparables)
    .where(eq(schema.prospectComparables.prospectId, p.id))
    .orderBy(desc(schema.prospectComparables.similarity));

  const canEdit = roleHasCapability(ctx.role, "edit_prospects");
  const canReport = roleHasCapability(ctx.role, "create_scouting_reports");
  const age = seasonName ? ageAtSeason(p.dateOfBirth, seasonName) : null;
  const primary = scores.find((s) => s.score !== null) ?? null;
  const secondary = scores.filter((s) => s.score !== null)[1] ?? null;

  const input =
    "rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/scouting/players" className="text-sm text-accent-text hover:underline">← NCAA players</Link>
          <h1 className="mt-1 text-xl font-semibold">{p.fullName}</h1>
          <p className="text-sm text-ink-muted">
            {p.position} · {p.shootsCatches ? `${p.shootsCatches}-hand` : "hand unknown"} · {p.classYear} ·{" "}
            {prospect.schoolName ?? "no school"} · {p.heightCm ? `${p.heightCm} cm` : "—"} / {p.weightKg ? `${p.weightKg} kg` : "—"} · {p.nationality ?? "—"}
          </p>
          <p className="text-sm text-ink-muted">
            {p.nhlDraftStatus === "drafted"
              ? `Drafted ${p.draftYear ?? ""}${p.draftRound ? ` · round ${p.draftRound}` : ""}${p.draftOverall ? ` (#${p.draftOverall} overall)` : ""} — rights: ${p.nhlRightsHolder ?? "held"}`
              : `Undrafted${p.collegeFreeAgentStatus === "eligible" ? ` · college free agent (agent: ${p.agentName ?? "unknown"})` : ""}`}
          </p>
        </div>
        <a
          href={`/scouting/players/${p.id}/report`}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
        >
          Export scouting report ⎙
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Age (season start)" value={age !== null ? String(age) : "—"} detail={seasonName ?? undefined} />
        <StatTile
          label="Primary inferred role"
          value={primary ? `${primary.score}` : "—"}
          detail={primary ? `${primary.archetypeLabel} · conf ${pct(primary.confidence)} (estimate)` : "Insufficient data"}
        />
        <StatTile
          label="Secondary inferred role"
          value={secondary ? `${secondary.score}` : "—"}
          detail={secondary ? secondary.archetypeLabel : undefined}
        />
        <StatTile
          label="Scout-assigned role"
          value={p.scoutAssignedRoleKey ? "✓" : "—"}
          detail={p.scoutAssignedRoleKey ? roleLabel(p.scoutAssignedRoleKey) : "Not assigned yet"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Season statistics (user-entered; TOI unavailable → per-60 not computed)">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Season</Th>
                <Th>Class</Th>
                <Th right>GP</Th>
                <Th right>G</Th>
                <Th right>A</Th>
                <Th right>P</Th>
                <Th right>S</Th>
                <Th right>PIM</Th>
                <Th right>PPP</Th>
                <Th right>FO%</Th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.id} className="border-b border-line/50 last:border-0">
                  <Td>{s.seasonName}</Td>
                  <Td className="text-ink-secondary">{s.classYear}</Td>
                  <Td right>{s.gamesPlayed}</Td>
                  <Td right>{s.goals}</Td>
                  <Td right>{s.assists}</Td>
                  <Td right>{s.goals + s.assists}</Td>
                  <Td right>{s.shots}</Td>
                  <Td right>{s.penaltyMinutes}</Td>
                  <Td right>{s.powerPlayGoals + s.powerPlayAssists}</Td>
                  <Td right>{s.faceoffAttempts > 0 ? `${((s.faceoffWins / s.faceoffAttempts) * 100).toFixed(0)}%` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Trends (model riq-trend-v0.1)">
          {trends.length === 0 ? (
            <p className="text-sm text-ink-muted">Not enough data for trends.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {trends.map((t, i) => (
                <li key={i} className="rounded-md border border-line px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-secondary">{t.label}</span>
                    <span
                      className={
                        t.classification === null
                          ? "text-ink-muted"
                          : ["breakout_season", "rapidly_ascending", "steady_progression"].includes(t.classification)
                            ? "text-good"
                            : ["production_decline", "over_age_dominance_concern", "small_sample_spike"].includes(t.classification)
                              ? "text-warn"
                              : "text-ink"
                      }
                    >
                      {t.classification ? TREND_LABELS[t.classification as TrendClassification] : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{t.summary}</p>
                  {t.warnings.map((w) => (
                    <p key={w} className="text-xs text-warn">⚠ {w}</p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Percentiles — ${percentilePanel.seasonName ?? "no season"}, ${p.positionGroup === "F" ? "forwards" : p.positionGroup === "D" ? "defensemen" : "goaltenders"} only (never mixed across position groups)`}>
        {!percentilePanel.position ? (
          <p className="text-sm text-ink-muted">No season data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Metric</Th>
                  <Th right>Value</Th>
                  <Th right>{`Position pool (n=${percentilePanel.position.poolSize})`}</Th>
                  <Th right>
                    {percentilePanel.conference
                      ? `${percentilePanel.conferenceName ?? "Conference"} (n=${percentilePanel.conference.poolSize})`
                      : "Conference"}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["ppg", "Points/game", 2],
                    ["goalsPerGame", "Goals/game", 2],
                    ["assistsPerGame", "Assists/game", 2],
                    ["shotsPerGame", "Shots/game", 1],
                    ["shootingPct", "Shooting %", 3],
                    ["ppShare", "PP point share", 2],
                    ["ageAdjustedPpg", "Age-adjusted PPG (estimate)", 2],
                    ["teamRelativePpg", "Team-relative scoring", 2],
                  ] as const
                ).map(([key, label, digits]) => {
                  const value = percentilePanel.position!.values[key];
                  const posPct = percentilePanel.position!.percentiles[key];
                  const confPct = percentilePanel.conference?.percentiles[key];
                  if (value === null || value === undefined) return null;
                  return (
                    <tr key={key} className="border-b border-line/50 last:border-0">
                      <Td className="text-ink-secondary">{label}</Td>
                      <Td right>{value.toFixed(digits)}</Td>
                      <Td right>{posPct !== null && posPct !== undefined ? `${posPct}th` : "pool < 8"}</Td>
                      <Td right>{confPct !== null && confPct !== undefined ? `${confPct}th` : "pool < 8"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-muted">
              Percentiles compare {p.positionGroup === "F" ? "forwards to forwards" : p.positionGroup === "D" ? "defensemen to defensemen" : "goaltenders to goaltenders"} in the same season;
              pools under 8 peers are reported as insufficient rather than extrapolated.
              {percentilePanel.position.missing.length > 0 && ` Unavailable inputs (not imputed): ${percentilePanel.position.missing.join(", ")}.`}
            </p>
          </div>
        )}
      </Card>

      <Card title={`Role scores — statistically inferred, ${seasonName ?? "no season"} (model riq-role-v0.1; estimates, kept separate from scout judgment)`}>
        {scores.filter((s) => s.score !== null).length === 0 ? (
          <p className="text-sm text-ink-muted">No computable role scores (insufficient data or peer pool).</p>
        ) : (
          <div className="space-y-3">
            {scores.filter((s) => s.score !== null).slice(0, 5).map((s) => (
              <div key={s.archetypeKey} className="rounded-md border border-line p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{s.archetypeLabel}</span>
                  <span className="tabular-nums">
                    {s.score} <span className="text-xs text-ink-muted">/ 100 · confidence {pct(s.confidence)} · pool {s.poolSize}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded bg-navy-800" role="img" aria-label={`${s.archetypeLabel} score ${s.score} of 100`}>
                  <div className="h-full rounded bg-accent" style={{ width: `${s.score}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  {s.contributions.map((c) => (
                    <span key={c.metric}>
                      {c.metric}: {c.missing ? "missing" : `${c.percentile}th pct × ${(c.weight * 100).toFixed(0)}% = ${c.contribution}`}
                    </span>
                  ))}
                </div>
                {s.contradictions.length > 0 && (
                  <p className="mt-1 text-xs text-warn">⚠ Contradicting evidence: {s.contradictions.join("; ")}</p>
                )}
                {s.missingInputs.length > 0 && (
                  <p className="mt-1 text-xs text-ink-muted">Missing inputs (not imputed): {s.missingInputs.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scout-assigned roles (authoritative; separate from model inference)">
          {canEdit ? (
            <form action={setScoutRolesAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="prospectId" value={p.id} />
              <div>
                <label className="mb-1 block text-sm text-ink-secondary" htmlFor="sr-role">Scout-assigned role</label>
                <select id="sr-role" name="scoutAssignedRoleKey" defaultValue={p.scoutAssignedRoleKey ?? ""} className={input}>
                  <option value="">—</option>
                  {groupRoles.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink-secondary" htmlFor="sr-proj">Projected professional role</label>
                <select id="sr-proj" name="projectedProRoleKey" defaultValue={p.projectedProRoleKey ?? ""} className={input}>
                  <option value="">—</option>
                  {groupRoles.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">Save roles</button>
            </form>
          ) : (
            <p className="text-sm text-ink-muted">
              Scout role: {roleLabel(p.scoutAssignedRoleKey)} · Projected pro role: {roleLabel(p.projectedProRoleKey)}.
              Your role cannot edit prospect data.
            </p>
          )}
        </Card>

        <Card title="Lists & boards">
          <div className="space-y-3">
            {canEdit && (
              <WatchlistAddForm
                action={addToWatchlistAction}
                organizationId={ctx.org.id}
                prospectId={p.id}
                watchlists={watchlists.map((w) => ({ id: w.id, name: memberOf.has(w.id) ? `${w.name} ✓` : w.name }))}
              />
            )}
            {roleHasCapability(ctx.role, "manage_draft_boards") && (
              <BoardAddForm
                action={addToDraftBoardAction}
                organizationId={ctx.org.id}
                prospectId={p.id}
                boards={boards.map((b) => ({ id: b.id, name: b.name }))}
              />
            )}
            {boardEntries.length > 0 && (
              <p className="text-sm text-ink-secondary">
                Board positions: {boardEntries.map((e) => `${e.boardName} #${e.e.overallRank}`).join(" · ")}
              </p>
            )}
            {memberOf.size > 0 && (
              <p className="text-xs text-ink-muted">On {memberOf.size} watchlist(s) — marked ✓ above.</p>
            )}
          </div>
        </Card>
      </div>

      <Card title="Organizational fit (model riq-fit-v0.2 — explainable estimate)">
        {needs.length === 0 ? (
          <p className="text-sm text-ink-muted">No active organizational needs. Define one under Org needs.</p>
        ) : (
          <div className="space-y-3">
            {needs.map((n) => {
              const fit = fitByNeed.get(n.id);
              const components =
                (fit?.components as {
                  list?: Array<{
                    key: string;
                    label: string;
                    inputValue?: string;
                    desiredValue?: string;
                    finalScore: number | null;
                    weight: number;
                    weightedContribution?: number | null;
                    explanation: string;
                  }>;
                } | null)?.list ?? [];
              const warnings = (fit?.explanation as { warnings?: string[] } | null)?.warnings ?? [];
              return (
                <div key={n.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      <Link href={`/scouting/needs/${n.id}`} className="font-medium hover:text-accent-text">{n.name}</Link>{" "}
                      <span className="text-ink-muted">
                        · {n.position}{n.handedness ? ` (${n.handedness})` : ""} · target {roleLabel(n.targetRoleKey)} · {n.timelineYears}y · priority {n.priority}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {fit ? (
                        <span className="tabular-nums font-medium">
                          {fit.overallScore} / 100
                          {fit.confidence !== null && (
                            <span className="ml-1 text-xs font-normal text-ink-muted">conf {pct(fit.confidence)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">Not computed</span>
                      )}
                      {canEdit && (
                        <form action={computeFitAction}>
                          <input type="hidden" name="organizationId" value={ctx.org.id} />
                          <input type="hidden" name="prospectId" value={p.id} />
                          <input type="hidden" name="needId" value={n.id} />
                          <button className="rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:text-ink">
                            {fit ? "Recompute" : "Compute fit"}
                          </button>
                        </form>
                      )}
                    </span>
                  </div>
                  {components.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                      {components.map((c) => (
                        <li key={c.key}>
                          {c.label}: <span className="text-ink">{c.finalScore ?? "n/a"}</span> × {(c.weight * 100).toFixed(0)}%
                          {c.weightedContribution != null && ` = ${c.weightedContribution}`} — {c.explanation}
                        </li>
                      ))}
                    </ul>
                  )}
                  {warnings.map((w) => (
                    <p key={w} className="mt-1 text-xs text-warn">⚠ {w}</p>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Scouting reports (${reports.length})`}>
          {reports.length === 0 ? (
            <p className="text-sm text-ink-muted">No reports filed yet.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-auto text-sm">
              {reports.map((r) => (
                <li key={r.id} className="rounded-md border border-line px-3 py-2">
                  <div className="flex justify-between gap-2 text-xs text-ink-muted">
                    <span>{r.viewingType} · {formatDate(r.gameDate ?? r.createdAt)} {r.opponent ? `vs ${r.opponent}` : ""}</span>
                    <span className={r.risk === "high" ? "text-critical" : r.risk === "low" ? "text-good" : "text-warn"}>risk: {r.risk ?? "—"}</span>
                  </div>
                  <p className="mt-1"><span className="text-ink-muted">Projection:</span> {r.nhlProjection ?? "—"} · <span className="text-ink-muted">floor:</span> {r.professionalFloor ?? "—"} · <span className="text-ink-muted">ceiling:</span> {r.professionalCeiling ?? "—"}</p>
                  {r.strengths && <p className="mt-1 text-xs"><span className="text-good">Strengths:</span> {r.strengths}</p>}
                  {r.concerns && <p className="text-xs"><span className="text-warn">Concerns:</span> {r.concerns}</p>}
                  {r.recommendation && <p className="mt-1 text-xs text-ink-secondary">{r.recommendation}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Comparables (NCAA same-age, statistical — estimates)">
          {comparables.length === 0 ? (
            <p className="text-sm text-ink-muted">No comparables stored for this prospect.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {comparables.map((c) => (
                <li key={c.id} className="rounded-md border border-line px-3 py-2">
                  <div className="flex justify-between gap-2">
                    {c.comparableProspectId ? (
                      <Link href={`/scouting/players/${c.comparableProspectId}`} className="font-medium hover:text-accent-text">{c.comparableName}</Link>
                    ) : (
                      <span className="font-medium">{c.comparableName}</span>
                    )}
                    <span className="tabular-nums text-ink-secondary">{pct(c.similarity)} similar</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {(c.sharedTraits as string[]).join(" · ")}
                    {(c.differences as string[]).length > 0 && ` — differs: ${(c.differences as string[]).join(", ")}`}
                  </p>
                  <p className="text-xs text-ink-muted">Period {c.dataPeriod ?? "—"} · model {c.modelVersion}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {canReport && (
        <Card title="File a scouting report">
          <ReportForm action={createScoutingReportAction} organizationId={ctx.org.id} prospectId={p.id} />
        </Card>
      )}

      <Card title="Data sources & provenance">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>Record</Th>
              <Th>Provenance</Th>
              <Th>Source</Th>
              <Th>Verified</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/50">
              <Td>Player record</Td>
              <Td className="text-ink-secondary">{p.provenance.replace(/_/g, " ")}</Td>
              <Td className="text-ink-secondary">
                {sourceById.get(p.sourceId ?? "")?.name ?? (p.externalRef ? `ref: ${p.externalRef}` : "—")}
              </Td>
              <Td className="text-ink-secondary">
                {sourceById.get(p.sourceId ?? "")?.verifiedAt ? formatDate(sourceById.get(p.sourceId ?? "")!.verifiedAt) : "unverified"}
              </Td>
            </tr>
            {seasons.map((s) => (
              <tr key={s.id} className="border-b border-line/50 last:border-0">
                <Td>Season {s.seasonName}</Td>
                <Td className="text-ink-secondary">{s.provenance.replace(/_/g, " ")}</Td>
                <Td className="text-ink-secondary">{sourceById.get(s.sourceId ?? "")?.name ?? "—"}</Td>
                <Td className="text-ink-secondary">
                  {sourceById.get(s.sourceId ?? "")?.verifiedAt ? formatDate(sourceById.get(s.sourceId ?? "")!.verifiedAt) : "unverified"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-muted">
          TOI, strength-state, and tracking data are shown only when a source provides them — never estimated.
          Import history for this organization is under Data imports.
        </p>
      </Card>
    </div>
  );
}
