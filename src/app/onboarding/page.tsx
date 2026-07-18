import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb, schema } from "@/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { createOrganizationAction, createTeamAction } from "@/server/actions/orgActions";
import { CreateOrgForm, CreateTeamForm } from "@/components/OnboardingForms";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = getDb();
  const memberships = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      name: schema.organizations.name,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizationMembers.organizationId, schema.organizations.id))
    .where(eq(schema.organizationMembers.userId, user.id));

  const firstOrg = memberships[0];

  if (firstOrg) {
    const teams = await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.organizationId, firstOrg.organizationId))
      .limit(1);
    if (teams.length > 0) redirect("/dashboard");
  }

  const leagues = firstOrg
    ? await db.select().from(schema.leagues).orderBy(asc(schema.leagues.name))
    : [];

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-8 flex items-center gap-2">
        <span className="inline-block h-6 w-6 rounded bg-accent" aria-hidden />
        <span className="text-lg font-semibold">RosterIQ</span>
      </div>
      {!firstOrg ? (
        <>
          <h1 className="text-2xl font-semibold">Create your organization</h1>
          <p className="mb-6 mt-1 text-sm text-ink-muted">
            An organization owns your teams, players, contracts, and scenarios. You&rsquo;ll be its
            administrator.
          </p>
          <CreateOrgForm action={createOrganizationAction} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Create your first team</h1>
          <p className="mb-6 mt-1 text-sm text-ink-muted">
            {firstOrg.name} has no teams yet. Pick an existing league or configure a new one with
            its cap parameters.
          </p>
          <CreateTeamForm
            action={createTeamAction}
            organizationId={firstOrg.organizationId}
            leagues={leagues.map((l) => ({ id: l.id, name: `${l.name} (${l.abbreviation})` }))}
          />
        </>
      )}
    </main>
  );
}
