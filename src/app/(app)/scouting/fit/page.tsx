import Link from "next/link";
import type { Metadata } from "next";
import { asc, desc, eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, Td, Th } from "@/components/ui";
import { formatDate, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Prospect fit" };

export default async function FitPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const needs = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(and(eq(schema.organizationalNeeds.organizationId, ctx.org.id), eq(schema.organizationalNeeds.isActive, true)))
    .orderBy(asc(schema.organizationalNeeds.priority));
  const archetypes = await db.select().from(schema.roleArchetypes).orderBy(asc(schema.roleArchetypes.label));
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? "any role";

  const fits = await db
    .select({
      f: schema.prospectFitScores,
      name: schema.amateurProspects.fullName,
      prospectId: schema.amateurProspects.id,
      position: schema.amateurProspects.position,
      hand: schema.amateurProspects.shootsCatches,
    })
    .from(schema.prospectFitScores)
    .innerJoin(schema.amateurProspects, eq(schema.prospectFitScores.prospectId, schema.amateurProspects.id))
    .where(eq(schema.prospectFitScores.organizationId, ctx.org.id))
    .orderBy(desc(schema.prospectFitScores.overallScore));

  const runs = await db
    .select()
    .from(schema.fitCalculationRuns)
    .where(eq(schema.fitCalculationRuns.organizationId, ctx.org.id))
    .orderBy(desc(schema.fitCalculationRuns.startedAt));
  const latestRunByNeed = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latestRunByNeed.has(r.needId)) latestRunByNeed.set(r.needId, r);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Prospect fit</h1>
        <p className="text-sm text-ink-muted">
          Fit scores (model riq-fit-v0.2, weights stored in the database) combine 14 explained components —
          position, handedness, roles, timeline, readiness, opportunity, depth, expirations, scarcity, special
          teams, grades, risk, and acquisition path. Define and manage needs under{" "}
          <Link href="/scouting/needs" className="text-accent-text hover:underline">Org needs</Link>.
        </p>
      </div>

      {needs.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No active needs. <Link href="/scouting/needs" className="text-accent-text hover:underline">Create one</Link> to rank prospects against it.
          </p>
        </Card>
      ) : (
        needs.map((n) => {
          const needFits = fits.filter((f) => f.f.needId === n.id).slice(0, 10);
          const run = latestRunByNeed.get(n.id);
          return (
            <Card
              key={n.id}
              title={`${n.name} — ${n.position}${n.handedness ? ` (${n.handedness})` : ""} · ${roleLabel(n.targetRoleKey)} · priority ${n.priority}`}
            >
              <p className="mb-2 text-xs text-ink-muted">
                {run
                  ? `Last run ${formatDate(run.startedAt)} · ${run.scoredCount}/${run.prospectsEvaluated} scored · ${run.modelVersion}`
                  : "Model has not been run for this need yet"}
                {" · "}
                <Link href={`/scouting/needs/${n.id}`} className="text-accent-text hover:underline">
                  full ranking & explanation →
                </Link>
              </p>
              {needFits.length === 0 ? (
                <p className="text-sm text-ink-muted">No fit scores yet — run the model from the need page.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <Th right>#</Th>
                      <Th>Prospect</Th>
                      <Th>Pos</Th>
                      <Th>Hand</Th>
                      <Th right>Fit</Th>
                      <Th right>Conf</Th>
                      <Th>Model</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {needFits.map((f, i) => (
                      <tr key={f.f.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                        <Td right className="text-ink-muted">{i + 1}</Td>
                        <Td><Link href={`/scouting/players/${f.prospectId}`} className="font-medium hover:text-accent-text">{f.name}</Link></Td>
                        <Td>{f.position}</Td>
                        <Td className="text-ink-secondary">{f.hand ?? "—"}</Td>
                        <Td right>{f.f.overallScore.toFixed(1)}</Td>
                        <Td right className="text-ink-secondary">{f.f.confidence !== null ? pct(f.f.confidence) : "—"}</Td>
                        <Td className="text-xs text-ink-muted">{f.f.modelVersion}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
