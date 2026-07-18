import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { createContractAction } from "@/server/actions/contractActions";
import { ContractForm } from "@/components/ContractForm";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Add contract" };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string }>;
}) {
  const ctx = await resolveAppContext();
  const { player } = await searchParams;
  const db = getDb();
  const players = await db
    .select({ id: schema.players.id, name: schema.players.fullName })
    .from(schema.players)
    .where(eq(schema.players.organizationId, ctx.org.id))
    .orderBy(asc(schema.players.fullName));

  if (players.length === 0 || ctx.teams.length === 0) {
    return (
      <EmptyState
        title="Add a player and team first"
        body="Contracts belong to a player on one of your teams."
        cta={{ href: players.length === 0 ? "/players/new" : "/onboarding", label: players.length === 0 ? "Add player" : "Create team" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add contract</h1>
      <ContractForm
        action={createContractAction}
        organizationId={ctx.org.id}
        players={players}
        teams={ctx.teams.map((t) => ({ id: t.id, name: t.name }))}
        seasons={ctx.seasons.map((s) => ({ id: s.id, name: s.name }))}
        defaultPlayerId={player}
      />
    </div>
  );
}
