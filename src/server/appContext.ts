/**
 * Resolves the signed-in user's working context (organization → team →
 * season) from cookies, validating every selection against actual
 * memberships so a stale or forged cookie can never cross a tenant boundary.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import type { OrgRole } from "@/server/context";

export const ORG_COOKIE = "riq_org";
export const TEAM_COOKIE = "riq_team";
export const SEASON_COOKIE = "riq_season";

export interface AppContext {
  user: SessionUser;
  memberships: Array<{ organizationId: string; organizationName: string; role: OrgRole }>;
  org: { id: string; name: string; slug: string };
  role: OrgRole;
  teams: Array<typeof schema.teams.$inferSelect>;
  team: (typeof schema.teams.$inferSelect) | null;
  seasons: Array<typeof schema.leagueSeasons.$inferSelect>;
  season: (typeof schema.leagueSeasons.$inferSelect) | null;
}

export async function resolveAppContext(): Promise<AppContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = getDb();
  const memberships = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      organizationName: schema.organizations.name,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizationMembers.organizationId, schema.organizations.id))
    .where(eq(schema.organizationMembers.userId, user.id));

  if (memberships.length === 0) redirect("/onboarding");

  const store = await cookies();
  const wantedOrg = store.get(ORG_COOKIE)?.value;
  const activeMembership =
    memberships.find((m) => m.organizationId === wantedOrg) ?? memberships[0];
  if (!activeMembership) redirect("/onboarding");

  const orgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, activeMembership.organizationId))
    .limit(1);
  const org = orgRows[0];
  if (!org) redirect("/onboarding");

  const teams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.organizationId, org.id))
    .orderBy(asc(schema.teams.name));

  const wantedTeam = store.get(TEAM_COOKIE)?.value;
  const team = teams.find((t) => t.id === wantedTeam) ?? teams[0] ?? null;

  let seasons: Array<typeof schema.leagueSeasons.$inferSelect> = [];
  if (teams.length > 0) {
    const leagueIds = [...new Set(teams.map((t) => t.leagueId))];
    seasons = await db
      .select()
      .from(schema.leagueSeasons)
      .where(inArray(schema.leagueSeasons.leagueId, leagueIds))
      .orderBy(asc(schema.leagueSeasons.sortOrder), asc(schema.leagueSeasons.startDate));
  }
  const teamSeasons = team ? seasons.filter((s) => s.leagueId === team.leagueId) : seasons;

  const wantedSeason = store.get(SEASON_COOKIE)?.value;
  const season =
    teamSeasons.find((s) => s.id === wantedSeason) ??
    teamSeasons.find((s) => s.isCurrent) ??
    teamSeasons[0] ??
    null;

  return {
    user,
    memberships,
    org: { id: org.id, name: org.name, slug: org.slug },
    role: activeMembership.role,
    teams,
    team,
    seasons: teamSeasons,
    season,
  };
}
