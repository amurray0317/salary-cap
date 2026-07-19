import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { formatDate, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Scouting reports" };

export default async function ScoutingReportsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const reports = await db
    .select({
      r: schema.scoutingReports,
      prospectName: schema.amateurProspects.fullName,
      prospectId: schema.amateurProspects.id,
      position: schema.amateurProspects.position,
      scoutName: schema.users.fullName,
    })
    .from(schema.scoutingReports)
    .innerJoin(schema.amateurProspects, eq(schema.scoutingReports.prospectId, schema.amateurProspects.id))
    .leftJoin(schema.users, eq(schema.scoutingReports.scoutId, schema.users.id))
    .where(eq(schema.scoutingReports.organizationId, ctx.org.id))
    .orderBy(desc(schema.scoutingReports.createdAt))
    .limit(100);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Scouting reports</h1>
      {reports.length === 0 ? (
        <EmptyState title="No reports" body="File reports from prospect profiles." cta={{ href: "/scouting/players", label: "NCAA players" }} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Prospect</Th>
                  <Th>Pos</Th>
                  <Th>Scout</Th>
                  <Th>Viewing</Th>
                  <Th>Game</Th>
                  <Th>Risk</Th>
                  <Th right>Confidence</Th>
                  <Th>Projection</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {reports.map((row) => (
                  <tr key={row.r.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td><Link href={`/scouting/players/${row.prospectId}`} className="font-medium hover:text-accent-text">{row.prospectName}</Link></Td>
                    <Td>{row.position}</Td>
                    <Td className="text-ink-secondary">{row.scoutName ?? "—"}</Td>
                    <Td className="text-ink-secondary">{row.r.viewingType}</Td>
                    <Td className="text-ink-secondary">{row.r.gameDate ? `${formatDate(row.r.gameDate)}${row.r.opponent ? ` vs ${row.r.opponent}` : ""}` : "—"}</Td>
                    <Td className={row.r.risk === "high" ? "text-critical" : row.r.risk === "low" ? "text-good" : "text-warn"}>{row.r.risk ?? "—"}</Td>
                    <Td right>{row.r.confidence !== null ? pct(row.r.confidence) : "—"}</Td>
                    <Td className="max-w-56 truncate text-ink-secondary">{row.r.nhlProjection ?? "—"}</Td>
                    <Td className="text-ink-secondary">{row.r.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
