import Link from "next/link";
import type { Metadata } from "next";
import { asc, desc, eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Role finder" };

export default async function RoleFinderPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await resolveAppContext();
  const { role } = await searchParams;
  const db = getDb();
  const archetypes = await db
    .select()
    .from(schema.roleArchetypes)
    .where(eq(schema.roleArchetypes.isActive, true))
    .orderBy(asc(schema.roleArchetypes.positionGroup), asc(schema.roleArchetypes.label));
  const selected = archetypes.find((a) => a.key === role) ?? archetypes[0];

  const ranked = selected
    ? await db
        .select({ score: schema.prospectRoleScores, p: schema.amateurProspects })
        .from(schema.prospectRoleScores)
        .innerJoin(schema.amateurProspects, eq(schema.prospectRoleScores.prospectId, schema.amateurProspects.id))
        .where(
          and(
            eq(schema.prospectRoleScores.archetypeId, selected.id),
            eq(schema.amateurProspects.organizationId, ctx.org.id),
          ),
        )
        .orderBy(desc(schema.prospectRoleScores.score))
        .limit(30)
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Role finder</h1>
        <p className="text-sm text-ink-muted">
          Ranked by stored role scores (model riq-role-v0.1) — statistical inference, always shown
          with confidence and never a substitute for scouting.
        </p>
      </div>
      <form method="get" className="flex flex-wrap gap-2">
        <select
          name="role"
          defaultValue={selected?.key}
          className="rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none"
        >
          {archetypes.map((a) => (
            <option key={a.key} value={a.key}>[{a.positionGroup}] {a.label}</option>
          ))}
        </select>
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Find</button>
      </form>
      {selected && <p className="text-sm text-ink-muted">{selected.description}</p>}
      {ranked.length === 0 ? (
        <EmptyState title="No scored prospects for this role" body="Role scores are computed from prospect profiles; open profiles to generate them." />
      ) : (
        <Card>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th right>#</Th>
                <Th>Prospect</Th>
                <Th>Pos</Th>
                <Th>Class</Th>
                <Th right>Score</Th>
                <Th right>Confidence</Th>
                <Th>Scout-assigned role?</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.score.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td right className="text-ink-muted">{i + 1}</Td>
                  <Td>
                    <Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">{r.p.fullName}</Link>
                  </Td>
                  <Td>{r.p.position}</Td>
                  <Td className="text-ink-secondary">{r.p.classYear}</Td>
                  <Td right>{r.score.score.toFixed(0)}</Td>
                  <Td right>{pct(r.score.confidence)}</Td>
                  <Td className="text-ink-secondary">{r.p.scoutAssignedRoleKey === selected?.key ? "✓ matches" : r.p.scoutAssignedRoleKey ? "different" : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
