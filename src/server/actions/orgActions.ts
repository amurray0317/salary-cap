"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { requireOrgAccess, requireUser, writeAudit } from "@/server/context";
import { ORG_COOKIE, TEAM_COOKIE } from "@/server/appContext";

export interface FormState {
  error?: string;
}

const orgSchema = z.object({ name: z.string().min(2).max(120) });

export async function createOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = orgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: "Organization name must be at least 2 characters" };

  const db = getDb();
  const slugBase = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: parsed.data.name, slug, createdBy: user.id })
    .returning();
  if (!org) return { error: "Could not create organization" };
  await db.insert(schema.organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: "org_admin",
  });
  await writeAudit({
    organizationId: org.id,
    userId: user.id,
    action: "organization.create",
    entityType: "organization",
    entityId: org.id,
    newValues: { name: org.name },
  });
  const store = await cookies();
  store.set(ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/onboarding");
}

const teamSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(2).max(120),
  abbreviation: z.string().min(2).max(5).toUpperCase(),
  city: z.string().max(120).optional(),
  leagueId: z.string().min(1),
  // Fields for creating a new league inline:
  leagueName: z.string().max(120).optional(),
  leagueAbbr: z.string().max(10).optional(),
  capYear1: z.coerce.number().int().positive().optional(),
  capGrowthPct: z.coerce.number().min(0).max(25).optional(),
  floorPct: z.coerce.number().min(0).max(100).optional(),
  minSalary: z.coerce.number().int().positive().optional(),
});

/**
 * Creates a team. When leagueId === "__new__", also creates an NHL-style
 * league with four seasons of versioned rules from the submitted cap
 * parameters (upper limit year 1, growth %, floor %, minimum salary).
 */
export async function createTeamAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = teamSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;
  const ctx = await requireOrgAccess(input.organizationId, "manage_team");

  const db = getDb();
  let leagueId = input.leagueId;

  if (leagueId === "__new__") {
    if (!input.leagueName || !input.capYear1) {
      return { error: "New league requires a name and a year-1 cap upper limit" };
    }
    const [league] = await db
      .insert(schema.leagues)
      .values({
        name: input.leagueName,
        abbreviation: input.leagueAbbr || input.leagueName.slice(0, 3).toUpperCase(),
        sport: "hockey",
        level: "professional",
        capSystem: "annual_hard_cap",
      })
      .returning();
    if (!league) return { error: "Could not create league" };
    leagueId = league.id;

    const growth = (input.capGrowthPct ?? 4) / 100;
    const floorPct = (input.floorPct ?? 74) / 100;
    const minSalary = input.minSalary ?? 800_000;
    const startYear = new Date().getFullYear();
    for (let y = 0; y < 4; y++) {
      const cap = Math.round(input.capYear1 * (1 + growth) ** y);
      const name = `${startYear + y}-${String((startYear + y + 1) % 100).padStart(2, "0")}`;
      const startDate = `${startYear + y}-10-07`;
      const [season] = await db
        .insert(schema.leagueSeasons)
        .values({
          leagueId,
          name,
          startDate,
          endDate: `${startYear + y + 1}-06-20`,
          isCurrent: y === 0,
          sortOrder: y,
        })
        .returning();
      if (!season) return { error: "Could not create league seasons" };
      const rules = [
        { key: "cap.upper_limit", name: "Salary cap upper limit", category: "cap", value: cap },
        { key: "cap.lower_limit", name: "Salary cap lower limit (floor)", category: "cap", value: Math.round(cap * floorPct) },
        { key: "cap.buried_allowance", name: "Buried-contract cap relief allowance", category: "cap", value: 1_150_000 },
        { key: "roster.max_active", name: "Maximum active roster size", category: "roster", value: 23 },
        { key: "roster.min_active", name: "Minimum active roster size", category: "roster", value: 20 },
        { key: "roster.min_goalies", name: "Minimum goaltenders on active roster", category: "roster", value: 2 },
        { key: "contract.max_slots", name: "Maximum contracts per organization", category: "contract", value: 50 },
        { key: "salary.min", name: "League minimum salary", category: "salary", value: Math.round(minSalary * (1 + growth / 2) ** y) },
        { key: "salary.max_individual_pct", name: "Maximum individual cap hit (% of upper limit)", category: "salary", value: 20 },
      ];
      await db.insert(schema.leagueRules).values(
        rules.map((r) => ({
          leagueId,
          seasonId: season.id,
          ruleKey: r.key,
          ruleName: r.name,
          ruleCategory: r.category,
          numericValue: r.value,
          effectiveDate: startDate,
          ruleVersion: 1,
          isActive: true,
          notes: "Created from the new-league template; edit under League rules.",
        })),
      );
    }
  } else {
    const league = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
    if (league.length === 0) return { error: "League not found" };
  }

  const [team] = await db
    .insert(schema.teams)
    .values({
      organizationId: ctx.organizationId,
      leagueId,
      name: input.name,
      abbreviation: input.abbreviation,
      city: input.city ?? null,
      level: "pro",
    })
    .returning();
  if (!team) return { error: "Could not create team" };
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    action: "team.create",
    entityType: "team",
    entityId: team.id,
    newValues: { name: team.name, leagueId },
  });
  const store = await cookies();
  store.set(TEAM_COOKIE, team.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}
