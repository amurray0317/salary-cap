import Link from "next/link";
import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getDepthSummary } from "@/server/services/fitService";
import { archiveNeedAction, createNeedAction } from "@/server/actions/fitActions";
import { NeedForm } from "@/components/NeedForm";
import { Card, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Organizational needs" };

export default async function NeedsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await resolveAppContext();
  const { show } = await searchParams;
  const db = getDb();
  const showArchived = show === "archived";

  const needs = await db
    .select()
    .from(schema.organizationalNeeds)
    .where(eq(schema.organizationalNeeds.organizationId, ctx.org.id))
    .orderBy(asc(schema.organizationalNeeds.priority), asc(schema.organizationalNeeds.name));
  const visible = needs.filter((n) => n.isActive !== showArchived);

  const archetypes = await db.select().from(schema.roleArchetypes).orderBy(asc(schema.roleArchetypes.label));
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? (key ?? "—");

  const runs = await db
    .select()
    .from(schema.fitCalculationRuns)
    .where(eq(schema.fitCalculationRuns.organizationId, ctx.org.id))
    .orderBy(desc(schema.fitCalculationRuns.startedAt));
  const latestRunByNeed = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latestRunByNeed.has(r.needId)) latestRunByNeed.set(r.needId, r);

  const depth = await getDepthSummary(ctx.org.id);
  const canManage = roleHasCapability(ctx.role, "manage_org_needs");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Organizational needs</h1>
          <p className="text-sm text-ink-muted">
            Define the prospect the organization needs; the fit model (riq-fit-v0.2, weights stored in the
            database) ranks NCAA prospects against it with a full per-component explanation.
          </p>
        </div>
        <Link
          href={showArchived ? "/scouting/needs" : "/scouting/needs?show=archived"}
          className="text-sm text-accent-text hover:underline"
        >
          {showArchived ? "← Active needs" : "Archived needs →"}
        </Link>
      </div>

      <Card title="Organizational depth by position (live contract + pool data)">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Position</Th>
                <Th right>Active contracts</Th>
                <Th right>Expiring ≤ 3y</Th>
                <Th right>Minor-league</Th>
                <Th right>NCAA prospects</Th>
                <Th right>Arriving ≤ 1y</Th>
                <Th>Assessment</Th>
              </tr>
            </thead>
            <tbody>
              {depth.map((d) => (
                <tr key={d.position} className="border-b border-line/50 last:border-0">
                  <Td>{d.position}</Td>
                  <Td right>{d.activeContracts}</Td>
                  <Td right>{d.expiringWithin3y}</Td>
                  <Td right>{d.minorLeague}</Td>
                  <Td right>{d.prospects}</Td>
                  <Td right>{d.prospectsArrivingSoon}</Td>
                  <Td className={d.scarce ? "text-warn" : "text-ink-secondary"}>
                    {d.scarce ? "⚠ Scarcity — thin contracts and pool" : "Covered"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            {showArchived ? "No archived needs." : "No active needs — define one below."}
          </p>
        </Card>
      ) : (
        <Card title={showArchived ? "Archived needs" : "Active needs (by priority)"}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Need</Th>
                  <Th>Position</Th>
                  <Th>Hand</Th>
                  <Th>Target role</Th>
                  <Th right>Priority</Th>
                  <Th>Arrival window</Th>
                  <Th>Acquisition</Th>
                  <Th>Last run</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((n) => {
                  const run = latestRunByNeed.get(n.id);
                  return (
                    <tr key={n.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                      <Td>
                        <Link href={`/scouting/needs/${n.id}`} className="font-medium hover:text-accent-text">
                          {n.name}
                        </Link>
                        {n.description && <p className="text-xs text-ink-muted">{n.description}</p>}
                      </Td>
                      <Td>{n.position}{n.secondaryPosition ? ` / ${n.secondaryPosition}` : ""}</Td>
                      <Td className="text-ink-secondary">{n.handedness ?? "any"}</Td>
                      <Td className="max-w-44 truncate text-ink-secondary">{roleLabel(n.targetRoleKey)}</Td>
                      <Td right>{n.priority}</Td>
                      <Td className="text-ink-secondary">
                        {n.earliestArrivalYears}–{n.latestArrivalYears}y{n.targetArrivalSeason ? ` (${n.targetArrivalSeason})` : ""}
                      </Td>
                      <Td className="text-ink-secondary">{n.preferredAcquisition.replace(/_/g, " ")}</Td>
                      <Td className="text-xs text-ink-muted">
                        {run ? `${formatDate(run.startedAt)} · ${run.scoredCount} scored` : "never"}
                      </Td>
                      <Td>
                        {canManage && (
                          <form action={archiveNeedAction}>
                            <input type="hidden" name="organizationId" value={ctx.org.id} />
                            <input type="hidden" name="needId" value={n.id} />
                            <button className="text-xs text-ink-muted hover:text-ink">
                              {n.isActive ? "Archive" : "Unarchive"}
                            </button>
                          </form>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage ? (
        <Card title="Create a need">
          <NeedForm
            action={createNeedAction}
            organizationId={ctx.org.id}
            roles={archetypes.map((a) => ({ key: a.key, label: `[${a.positionGroup}] ${a.label}` }))}
            submitLabel="Create need"
          />
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">Your role can view needs but not define them (requires director/GM).</p>
      )}
    </div>
  );
}
