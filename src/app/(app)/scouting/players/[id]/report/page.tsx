/** Print-optimized prospect scouting report (browser Save-as-PDF export). */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { computeRoleScores, computeTrends, ageAtSeason } from "@/server/services/scoutingService";
import { TREND_LABELS, type TrendClassification } from "@/lib/scouting/trends";
import { formatDate, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Prospect report export" };

export default async function ProspectReportExport({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .select({ p: schema.amateurProspects, schoolName: schema.schools.name })
    .from(schema.amateurProspects)
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(and(eq(schema.amateurProspects.id, id), eq(schema.amateurProspects.organizationId, ctx.org.id)))
    .limit(1);
  if (!row) notFound();
  const p = row.p;

  const seasons = await db
    .select()
    .from(schema.prospectSeasons)
    .where(eq(schema.prospectSeasons.prospectId, p.id))
    .orderBy(asc(schema.prospectSeasons.seasonName));
  const { seasonName, scores } = await computeRoleScores(p.id, ctx.org.id);
  const trends = await computeTrends(p.id, ctx.org.id);
  const reports = await db
    .select()
    .from(schema.scoutingReports)
    .where(eq(schema.scoutingReports.prospectId, p.id))
    .orderBy(desc(schema.scoutingReports.createdAt))
    .limit(3);
  const archetypes = await db.select().from(schema.roleArchetypes);
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? "—";
  const age = seasonName ? ageAtSeason(p.dateOfBirth, seasonName) : null;
  const top = scores.filter((s) => s.score !== null).slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-neutral-900 print:p-0" style={{ colorScheme: "light" }}>
      <div className="no-print mb-4 flex justify-between rounded-md border border-line bg-navy-900 p-3 text-ink">
        <span className="text-sm">Print-optimized scouting report — use Print → Save as PDF.</span>
        <span className="text-sm text-ink-muted">Ctrl/Cmd + P</span>
      </div>

      <header className="border-b-2 border-neutral-900 pb-3">
        <h1 className="text-2xl font-bold">{p.fullName}</h1>
        <p className="text-lg">
          {p.position} · {p.classYear} · {row.schoolName ?? "—"}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {ctx.org.name} amateur scouting · generated {new Date().toISOString()} · models riq-trend-v0.1 / riq-role-v0.1 —
          statistical outputs are estimates, not scouting conclusions
        </p>
      </header>

      <section className="mt-4 text-sm">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Profile</h2>
        <p>
          Age {age ?? "—"} · {p.shootsCatches ? `${p.shootsCatches}-hand` : "hand unknown"} · {p.heightCm ?? "—"} cm / {p.weightKg ?? "—"} kg · {p.nationality ?? "—"} ·{" "}
          {p.nhlDraftStatus === "drafted" ? `drafted ${p.draftYear ?? ""} (rights: ${p.nhlRightsHolder ?? "held"})` : `undrafted (${p.collegeFreeAgentStatus})`}
        </p>
        <p className="mt-1">
          Scout-assigned role: <strong>{roleLabel(p.scoutAssignedRoleKey)}</strong> · Projected pro role: <strong>{roleLabel(p.projectedProRoleKey)}</strong>
        </p>
      </section>

      <section className="mt-4">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Season statistics</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left">
              <th className="py-1">Season</th><th className="py-1">Class</th>
              <th className="py-1 text-right">GP</th><th className="py-1 text-right">G</th>
              <th className="py-1 text-right">A</th><th className="py-1 text-right">P</th>
              <th className="py-1 text-right">S</th><th className="py-1 text-right">PPP</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.id} className="border-b border-neutral-200">
                <td className="py-1">{s.seasonName}</td>
                <td className="py-1">{s.classYear}</td>
                <td className="py-1 text-right">{s.gamesPlayed}</td>
                <td className="py-1 text-right">{s.goals}</td>
                <td className="py-1 text-right">{s.assists}</td>
                <td className="py-1 text-right">{s.goals + s.assists}</td>
                <td className="py-1 text-right">{s.shots}</td>
                <td className="py-1 text-right">{s.powerPlayGoals + s.powerPlayAssists}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-neutral-500">Time-on-ice unavailable for NCAA data; per-60 rates intentionally not computed.</p>
      </section>

      <section className="mt-4 text-sm">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Statistical role inference ({seasonName ?? "—"})</h2>
        {top.length === 0 ? (
          <p>Insufficient data for role inference.</p>
        ) : (
          <ul className="list-inside list-disc">
            {top.map((s) => (
              <li key={s.archetypeKey}>
                {s.archetypeLabel}: <strong>{s.score}</strong>/100 (confidence {pct(s.confidence)}, peer pool {s.poolSize})
                {s.contradictions.length > 0 && ` — contradicting evidence: ${s.contradictions.join("; ")}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 text-sm">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Trends</h2>
        <ul className="list-inside list-disc">
          {trends.map((t, i) => (
            <li key={i}>
              {t.label}: {t.classification ? TREND_LABELS[t.classification as TrendClassification] : "—"} — {t.summary}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 text-sm">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">Latest scout reports</h2>
        {reports.length === 0 ? (
          <p>No scouting reports filed.</p>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="mb-2 border-b border-neutral-200 pb-2">
              <p className="text-xs text-neutral-500">
                {r.viewingType} viewing · {formatDate(r.gameDate ?? r.createdAt)} {r.opponent ? `vs ${r.opponent}` : ""} · risk {r.risk ?? "—"} · confidence {r.confidence !== null ? pct(r.confidence) : "—"}
              </p>
              <p>Projection: {r.nhlProjection ?? "—"} (floor {r.professionalFloor ?? "—"}, ceiling {r.professionalCeiling ?? "—"}, timeline {r.developmentTimeline ?? "—"})</p>
              {r.strengths && <p>Strengths: {r.strengths}</p>}
              {r.concerns && <p>Concerns: {r.concerns}</p>}
              {r.recommendation && <p>Recommendation: {r.recommendation}</p>}
            </div>
          ))
        )}
      </section>

      <footer className="mt-6 border-t border-neutral-300 pt-3 text-xs text-neutral-500">
        Fictional demonstration data. Model outputs are versioned estimates intended to support —
        never replace — scout judgment. Missing inputs are reported, not imputed.
      </footer>
    </div>
  );
}
