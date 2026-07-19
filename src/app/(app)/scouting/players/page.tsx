import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { deriveStats } from "@/lib/scouting/stats";
import { ageAtSeason } from "@/server/services/scoutingService";

export const metadata: Metadata = { title: "NCAA players" };

interface Search {
  pos?: string;
  school?: string;
  conf?: string;
  hand?: string;
  maxAge?: string;
  minPpg?: string;
  draft?: string;
}

export default async function NcaaPlayersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const db = getDb();

  const prospects = await db
    .select({ p: schema.amateurProspects, schoolName: schema.schools.name, conferenceId: schema.schools.conferenceId })
    .from(schema.amateurProspects)
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(eq(schema.amateurProspects.organizationId, ctx.org.id))
    .orderBy(asc(schema.amateurProspects.fullName));

  const conferences = await db.select().from(schema.conferences).orderBy(asc(schema.conferences.name));
  const schools = await db.select().from(schema.schools).orderBy(asc(schema.schools.name));

  const ids = prospects.map((x) => x.p.id);
  const seasonRows = ids.length
    ? await db.select().from(schema.prospectSeasons).where(inArray(schema.prospectSeasons.prospectId, ids))
    : [];
  const latestByProspect = new Map<string, (typeof seasonRows)[number]>();
  for (const s of seasonRows) {
    const cur = latestByProspect.get(s.prospectId);
    if (!cur || s.seasonName > cur.seasonName) latestByProspect.set(s.prospectId, s);
  }

  const rows = prospects
    .map((x) => {
      const season = latestByProspect.get(x.p.id) ?? null;
      const age = season ? ageAtSeason(x.p.dateOfBirth, season.seasonName) : null;
      const d = season
        ? deriveStats({
            prospectId: x.p.id,
            seasonName: season.seasonName,
            position: x.p.position,
            positionGroup: x.p.positionGroup,
            age,
            gamesPlayed: season.gamesPlayed,
            goals: season.goals,
            assists: season.assists,
            shots: season.shots,
            penaltyMinutes: season.penaltyMinutes,
            powerPlayGoals: season.powerPlayGoals,
            powerPlayAssists: season.powerPlayAssists,
            shortHandedGoals: season.shortHandedGoals,
            faceoffWins: season.faceoffWins,
            faceoffAttempts: season.faceoffAttempts,
            timeOnIceSeconds: season.timeOnIceSeconds,
            teamGoalsFor: season.teamGoalsFor,
          })
        : null;
      return { ...x, season, age, derived: d };
    })
    .filter((r) => {
      if (sp.pos && r.p.position !== sp.pos) return false;
      if (sp.school && r.p.schoolId !== sp.school) return false;
      if (sp.conf && r.conferenceId !== sp.conf) return false;
      if (sp.hand && r.p.shootsCatches !== sp.hand) return false;
      if (sp.maxAge && (r.age === null || r.age > Number(sp.maxAge))) return false;
      if (sp.minPpg && (r.derived?.ppg === null || r.derived === null || r.derived.ppg! < Number(sp.minPpg))) return false;
      if (sp.draft === "undrafted" && r.p.nhlDraftStatus !== "undrafted") return false;
      if (sp.draft === "drafted" && r.p.nhlDraftStatus !== "drafted") return false;
      return true;
    })
    .sort((a, b) => (b.derived?.ppg ?? -1) - (a.derived?.ppg ?? -1));

  const selectCls =
    "rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">NCAA players</h1>
        <p className="text-xs text-ink-muted">Latest-season stats; ✎ = TOI unavailable, per-60 not computed</p>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <select name="pos" defaultValue={sp.pos ?? ""} className={selectCls}>
          <option value="">All positions</option>
          {["C", "LW", "RW", "D", "G"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select name="conf" defaultValue={sp.conf ?? ""} className={selectCls}>
          <option value="">All conferences</option>
          {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="school" defaultValue={sp.school ?? ""} className={selectCls}>
          <option value="">All schools</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="hand" defaultValue={sp.hand ?? ""} className={selectCls}>
          <option value="">Any hand</option>
          <option value="L">L</option>
          <option value="R">R</option>
        </select>
        <select name="draft" defaultValue={sp.draft ?? ""} className={selectCls}>
          <option value="">Drafted + undrafted</option>
          <option value="drafted">Drafted only</option>
          <option value="undrafted">Undrafted only</option>
        </select>
        <input name="maxAge" defaultValue={sp.maxAge ?? ""} placeholder="Max age" inputMode="numeric" className={`${selectCls} w-24`} />
        <input name="minPpg" defaultValue={sp.minPpg ?? ""} placeholder="Min PPG" inputMode="decimal" className={`${selectCls} w-24`} />
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No prospects match" body="Adjust the filters, or import NCAA players under Data imports." cta={{ href: "/imports", label: "Data imports" }} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Player</Th>
                  <Th>Pos</Th>
                  <Th>Hand</Th>
                  <Th>School</Th>
                  <Th>Class</Th>
                  <Th right>Age</Th>
                  <Th right>GP</Th>
                  <Th right>G</Th>
                  <Th right>A</Th>
                  <Th right>P</Th>
                  <Th right>PPG</Th>
                  <Th right>S/G</Th>
                  <Th>Draft status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 150).map((r) => (
                  <tr key={r.p.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td>
                      <Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">{r.p.fullName}</Link>
                    </Td>
                    <Td>{r.p.position}</Td>
                    <Td className="text-ink-secondary">{r.p.shootsCatches ?? "—"}</Td>
                    <Td className="max-w-44 truncate text-ink-secondary">{r.schoolName ?? "—"}</Td>
                    <Td className="text-ink-secondary">{r.p.classYear}</Td>
                    <Td right>{r.age ?? "—"}</Td>
                    <Td right>{r.season?.gamesPlayed ?? "—"}</Td>
                    <Td right>{r.season?.goals ?? "—"}</Td>
                    <Td right>{r.season?.assists ?? "—"}</Td>
                    <Td right>{r.derived?.points ?? "—"}</Td>
                    <Td right>{r.derived?.ppg?.toFixed(2) ?? "—"}</Td>
                    <Td right>{r.derived?.shotsPerGame?.toFixed(1) ?? "—"}</Td>
                    <Td className="text-ink-secondary">
                      {r.p.nhlDraftStatus === "drafted" ? `Drafted · ${r.p.nhlRightsHolder ?? "rights held"}` : r.p.collegeFreeAgentStatus === "eligible" ? "Undrafted · CFA eligible" : "Undrafted"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{rows.length} prospects (showing up to 150, sorted by PPG)</p>
        </Card>
      )}
    </div>
  );
}
