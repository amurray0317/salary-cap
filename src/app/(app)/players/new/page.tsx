import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { createPlayerAction } from "@/server/actions/playerActions";
import { PlayerForm } from "@/components/PlayerForm";

export const metadata: Metadata = { title: "Add player" };

export default async function NewPlayerPage() {
  const ctx = await resolveAppContext();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add player</h1>
      <PlayerForm
        action={createPlayerAction}
        organizationId={ctx.org.id}
        teams={ctx.teams.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
