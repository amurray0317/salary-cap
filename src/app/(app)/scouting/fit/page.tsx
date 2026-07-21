import Link from "next/link";
import type { Metadata } from "next";
import { asc, desc, eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { createNeedAction } from "@/server/actions/scoutingActions";
import { NeedForm } from "@/components/ScoutingForms";
import { Card, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Organizational fit" };

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
    .select({ f: schema.prospectFitScores, name: schema.amateurProspects.fullName, prospectId: schema.amateurProspects.id, position: schema.amateurProspects.position, hand: schema.amateurProspects.shootsCatches })
    .from(schema.prospectFitScores)
    .innerJoin(schema.amateurProspects, eq(schema.prospectFitScores.prospectId, schema.amateurProspects.id))
    .where(eq(schema.prospectFitScores.organizationId, ctx.org.id))
    .orderBy(desc(schema.prospectFitScores.overallScore));

  const canManage = roleHasCapability(ctx.role, "manage_org_needs");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Organizational needs & prospect fit</h1>
        <p className="text-sm text-ink-muted">
          Fit scores (model riq-fit-v0.1) combine position, handedness, role, timeline, contract-depth
          opportunity, and risk — each component explained. Connected to live RosterIQ contract data.
        </p>
      </div>

      {canManage ? (
        <Card title="Define a need">
          <NeedForm action={createNeedAction} organizationId={ctx.org.id} roles={archetypes.map((a) => ({ key: a.key, label: `[${a.positionGroup}] ${a.label}` }))} />
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Your role can view needs but not define them (requires director/GM).</p>
      )}

      {needs.length === 0 ? (
        <Card><p className="text-sm text-ink-muted">No active needs defined.</p></Card>
      ) : (
        needs.map((n) => {
          const needFits = fits.filter((f) => f.f.needId === n.id).slice(0, 10);
          return (
            <Card
              key={n.id}
              title={`Need: ${n.position}${n.handedness ? ` (${n.handedness}-hand)` : ""} — ${roleLabel(n.targetRoleKey)} · ${n.timelineYears}y timeline · priority ${n.priority} · max risk ${n.maxRiskTolerance}`}
            >
              {n.notes && <p className="mb-2 text-sm text-ink-muted">{n.notes}</p>}
              {needFits.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No fit scores computed yet — open a prospect profile and press &ldquo;Compute fit&rdquo;.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <Th right>#</Th>
                      <Th>Prospect</Th>
                      <Th>Pos</Th>
                      <Th>Hand</Th>
                      <Th right>Fit score</Th>
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
