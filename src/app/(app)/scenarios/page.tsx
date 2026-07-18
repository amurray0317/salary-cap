import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { NewScenarioForm } from "@/components/ScenarioForms";
import { createScenarioAction } from "@/server/actions/scenarioActions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Scenarios" };

export default async function ScenariosPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const scenarios = await db
    .select({
      scenario: schema.scenarios,
      teamName: schema.teams.name,
      seasonName: schema.leagueSeasons.name,
    })
    .from(schema.scenarios)
    .innerJoin(schema.teams, eq(schema.scenarios.teamId, schema.teams.id))
    .innerJoin(schema.leagueSeasons, eq(schema.scenarios.baseSeasonId, schema.leagueSeasons.id))
    .where(eq(schema.scenarios.organizationId, ctx.org.id))
    .orderBy(desc(schema.scenarios.updatedAt));

  const active = scenarios.filter((s) => s.scenario.status !== "archived");
  const archived = scenarios.filter((s) => s.scenario.status === "archived");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Scenarios</h1>
          <p className="text-sm text-ink-muted">
            Simulations are isolated: nothing changes official data until explicitly applied.
          </p>
        </div>
        <Link
          href={`/scenarios/compare?ids=${active.slice(0, 2).map((s) => s.scenario.id).join(",")}`}
          className="rounded-md border border-line px-4 py-2 text-sm text-ink-secondary hover:text-ink"
        >
          Compare scenarios
        </Link>
      </div>

      {ctx.team && ctx.season && (
        <Card title="New scenario">
          <NewScenarioForm
            action={createScenarioAction}
            organizationId={ctx.org.id}
            teams={ctx.teams.map((t) => ({ id: t.id, name: t.name }))}
            seasons={ctx.seasons.map((s) => ({ id: s.id, name: s.name }))}
            defaultTeamId={ctx.team.id}
            defaultSeasonId={ctx.season.id}
          />
        </Card>
      )}

      {scenarios.length === 0 ? (
        <EmptyState title="No scenarios yet" body="Create a scenario above to simulate signings, trades, and roster moves." />
      ) : (
        <Card>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Name</Th>
                <Th>Team</Th>
                <Th>Base season</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...archived].map(({ scenario, teamName, seasonName }) => (
                <tr key={scenario.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td>
                    <Link href={`/scenarios/${scenario.id}`} className="font-medium hover:text-accent-text">
                      {scenario.name}
                    </Link>
                    {scenario.description && (
                      <div className="max-w-md truncate text-xs text-ink-muted">{scenario.description}</div>
                    )}
                  </Td>
                  <Td className="text-ink-secondary">{teamName}</Td>
                  <Td className="text-ink-secondary">{seasonName}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        scenario.status === "active"
                          ? "bg-accent-soft text-accent-text"
                          : scenario.status === "archived"
                            ? "bg-navy-800 text-ink-muted"
                            : "bg-navy-800 text-ink-secondary"
                      }`}
                    >
                      {scenario.status}
                    </span>
                  </Td>
                  <Td className="text-ink-secondary">{formatDate(scenario.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
