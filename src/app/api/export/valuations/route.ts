import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveApiContext } from "@/server/apiContext";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx || !ctx.season) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({ valuation: schema.playerValuations, player: schema.players })
    .from(schema.playerValuations)
    .innerJoin(schema.players, eq(schema.playerValuations.playerId, schema.players.id))
    .where(
      and(
        eq(schema.players.organizationId, ctx.org.id),
        eq(schema.playerValuations.seasonId, ctx.season.id),
      ),
    );

  const csv = toCsv(
    ["Player", "Position", "Estimated AAV", "Low", "High", "Term (years)", "Est. total", "Performance value", "Confidence", "Model version", "Input data date", "Provenance"],
    rows.map(({ valuation, player }) => [
      player.fullName,
      player.position,
      valuation.estimatedAav,
      valuation.estimatedAavLow,
      valuation.estimatedAavHigh,
      valuation.estimatedTermYears,
      valuation.estimatedTotalValue,
      valuation.performanceValue,
      valuation.confidence,
      valuation.modelVersion,
      valuation.inputDataDate,
      valuation.provenance,
    ]),
  );
  const meta = `# RosterIQ valuation export (ESTIMATES ONLY),org=${ctx.org.name},season=${ctx.season.name},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`valuations-${ctx.season.name}.csv`, meta + csv);
}
