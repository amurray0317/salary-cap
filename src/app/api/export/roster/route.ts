import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveApiContext } from "@/server/apiContext";
import { csvResponse, toCsv } from "@/lib/csv";
import { statusLabel } from "@/lib/format";

export async function GET(): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx || !ctx.team || !ctx.season) {
    return new Response("Unauthorized or no team selected", { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({
      player: schema.players,
      contract: schema.contracts,
      cs: schema.contractSeasons,
    })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .innerJoin(
      schema.contractSeasons,
      and(
        eq(schema.contractSeasons.contractId, schema.contracts.id),
        eq(schema.contractSeasons.seasonId, ctx.season.id),
      ),
    )
    .where(and(eq(schema.contracts.teamId, ctx.team.id), eq(schema.contracts.contractStatus, "active")));

  const csv = toCsv(
    ["Player", "Position", "Status", "Cap hit", "Base salary", "Total cash", "Contract type", "Contract end", "Provenance"],
    rows
      .sort((a, b) => b.cs.capHit - a.cs.capHit)
      .map(({ player, contract, cs }) => [
        player.fullName,
        player.position,
        statusLabel(player.rosterStatus),
        cs.capHit,
        cs.baseSalary,
        cs.totalCash,
        contract.contractType,
        contract.endDate,
        contract.provenance,
      ]),
  );
  const meta = `# RosterIQ roster export,team=${ctx.team.name},season=${ctx.season.name},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`roster-${ctx.team.abbreviation}-${ctx.season.name}.csv`, meta + csv);
}
