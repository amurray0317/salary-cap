/**
 * Shared NCAA-player list assembly: filters, sorting, and derived stats in
 * one place so the players page and the CSV export route stay consistent.
 *
 * No "server-only" import (same convention as the other services) so
 * integration tests can exercise it against in-memory PGlite.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { deriveStats, type DerivedStats } from "@/lib/scouting/stats";
import { ageAtSeason } from "@/server/services/scoutingService";

export interface ProspectListFilters {
  q?: string;
  pos?: string;
  school?: string;
  conf?: string;
  hand?: string;
  class?: string;
  draft?: string;
  maxAge?: string;
  minPpg?: string;
  minGp?: string;
  sort?: string;
  dir?: string;
}

export interface ProspectListRow {
  p: typeof schema.amateurProspects.$inferSelect;
  schoolName: string | null;
  conferenceId: string | null;
  conferenceName: string | null;
  season: typeof schema.prospectSeasons.$inferSelect | null;
  age: number | null;
  derived: DerivedStats | null;
}

const SORTS: Record<string, (r: ProspectListRow) => number | string> = {
  name: (r) => r.p.fullName,
  age: (r) => r.age ?? -1,
  gp: (r) => r.season?.gamesPlayed ?? -1,
  g: (r) => r.season?.goals ?? -1,
  a: (r) => r.season?.assists ?? -1,
  p: (r) => r.derived?.points ?? -1,
  ppg: (r) => r.derived?.ppg ?? -1,
  spg: (r) => r.derived?.shotsPerGame ?? -1,
};

export async function listProspects(
  organizationId: string,
  f: ProspectListFilters,
): Promise<ProspectListRow[]> {
  const db = getDb();
  const prospects = await db
    .select({
      p: schema.amateurProspects,
      schoolName: schema.schools.name,
      conferenceId: schema.schools.conferenceId,
    })
    .from(schema.amateurProspects)
    .leftJoin(schema.schools, eq(schema.amateurProspects.schoolId, schema.schools.id))
    .where(eq(schema.amateurProspects.organizationId, organizationId))
    .orderBy(asc(schema.amateurProspects.fullName));

  const conferences = await db.select().from(schema.conferences);
  const confNames = new Map(conferences.map((c) => [c.id, c.name]));

  const ids = prospects.map((x) => x.p.id);
  const seasonRows = ids.length
    ? await db.select().from(schema.prospectSeasons).where(inArray(schema.prospectSeasons.prospectId, ids))
    : [];
  const latestByProspect = new Map<string, (typeof seasonRows)[number]>();
  for (const s of seasonRows) {
    const cur = latestByProspect.get(s.prospectId);
    if (!cur || s.seasonName > cur.seasonName) latestByProspect.set(s.prospectId, s);
  }

  const rows: ProspectListRow[] = prospects
    .map((x) => {
      const season = latestByProspect.get(x.p.id) ?? null;
      const age = season ? ageAtSeason(x.p.dateOfBirth, season.seasonName) : null;
      const derived = season
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
      return {
        ...x,
        conferenceName: x.conferenceId ? (confNames.get(x.conferenceId) ?? null) : null,
        season,
        age,
        derived,
      };
    })
    .filter((r) => {
      if (f.q && !r.p.fullName.toLowerCase().includes(f.q.toLowerCase())) return false;
      if (f.pos && r.p.position !== f.pos) return false;
      if (f.school && r.p.schoolId !== f.school) return false;
      if (f.conf && r.conferenceId !== f.conf) return false;
      if (f.hand && r.p.shootsCatches !== f.hand) return false;
      if (f.class && r.p.classYear !== f.class) return false;
      if (f.maxAge && (r.age === null || r.age > Number(f.maxAge))) return false;
      if (f.minPpg && (r.derived === null || r.derived.ppg === null || r.derived.ppg < Number(f.minPpg))) return false;
      if (f.minGp && (r.season?.gamesPlayed ?? 0) < Number(f.minGp)) return false;
      if (f.draft === "undrafted" && r.p.nhlDraftStatus !== "undrafted") return false;
      if (f.draft === "drafted" && r.p.nhlDraftStatus !== "drafted") return false;
      if (f.draft === "cfa" && r.p.collegeFreeAgentStatus !== "eligible") return false;
      return true;
    });

  const key = SORTS[f.sort ?? "ppg"] ?? SORTS.ppg!;
  const dir = f.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (typeof ka === "string" || typeof kb === "string") {
      return dir * String(ka).localeCompare(String(kb));
    }
    return dir * (ka - kb);
  });
  return rows;
}
