import { inArray, and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveApiContext } from "@/server/apiContext";
import { compareScenarios } from "@/server/services/scenarioService";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const requested = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) return new Response("No scenario ids", { status: 400 });

  // Isolation: only this organization's scenarios are exportable.
  const db = getDb();
  const owned = await db
    .select({ id: schema.scenarios.id })
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.organizationId, ctx.org.id), inArray(schema.scenarios.id, requested)));
  const ids = owned.map((s) => s.id);
  if (ids.length === 0) return new Response("Scenarios not found", { status: 404 });

  const comparison = await compareScenarios(ids);
  const csv = toCsv(
    ["Metric", "Official", ...comparison.scenarioNames],
    [
      ...comparison.rows.map((r) => [r.metric, r.official, ...r.values]),
      ["Blocking violations", comparison.violationCounts.official, ...comparison.violationCounts.scenarios],
    ],
  );
  const meta = `# RosterIQ scenario comparison,season=${comparison.seasonName},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`scenario-comparison-${comparison.seasonName}.csv`, meta + csv);
}
