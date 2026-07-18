/**
 * Scenario projection and comparison over official cap inputs.
 * Scenario transactions are stored rows; the projector overlays them at read
 * time so official data is never modified by a simulation.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { calculateCap } from "@/lib/engine/capEngine";
import type { CapResult } from "@/lib/engine/types";
import { projectScenario, type ProjectionNote } from "@/lib/scenario/projector";
import { scenarioPayloadSchema, type ScenarioPayload } from "@/lib/scenario/payloads";
import { buildTeamCapInputs, type SeasonInfo } from "./capService";

export interface ScenarioProjection {
  scenario: typeof schema.scenarios.$inferSelect;
  transactions: Array<typeof schema.scenarioTransactions.$inferSelect>;
  seasons: SeasonInfo[];
  officialResults: CapResult[];
  projectedResults: CapResult[];
  notes: ProjectionNote[];
  invalidTransactions: Array<{ id: string; label: string; error: string }>;
}

export async function getScenarioProjection(scenarioId: string): Promise<ScenarioProjection> {
  const db = getDb();
  const scenarioRows = await db
    .select()
    .from(schema.scenarios)
    .where(eq(schema.scenarios.id, scenarioId))
    .limit(1);
  const scenario = scenarioRows[0];
  if (!scenario) throw new Error("Scenario not found");

  const txRows = await db
    .select()
    .from(schema.scenarioTransactions)
    .where(eq(schema.scenarioTransactions.scenarioId, scenarioId))
    .orderBy(asc(schema.scenarioTransactions.sortOrder), asc(schema.scenarioTransactions.createdAt));

  const base = await buildTeamCapInputs(scenario.teamId);

  const valid: Array<{ label: string; payload: ScenarioPayload }> = [];
  const invalidTransactions: ScenarioProjection["invalidTransactions"] = [];
  for (const row of txRows) {
    if (!row.isEnabled) continue;
    const parsed = scenarioPayloadSchema.safeParse(row.payload);
    if (parsed.success) {
      valid.push({ label: row.label, payload: parsed.data });
    } else {
      invalidTransactions.push({ id: row.id, label: row.label, error: parsed.error.message });
    }
  }

  const projection = projectScenario({ seasons: base.inputs }, valid);

  return {
    scenario,
    transactions: txRows,
    seasons: base.seasons,
    officialResults: base.inputs.map(calculateCap),
    projectedResults: projection.seasons.map(calculateCap),
    notes: projection.notes,
    invalidTransactions,
  };
}

export interface ScenarioComparisonRow {
  metric: string;
  format: "money" | "count";
  official: number;
  values: number[]; // one per compared scenario
}

export interface ScenarioComparison {
  seasonName: string;
  scenarioNames: string[];
  rows: ScenarioComparisonRow[];
  violationCounts: { official: number; scenarios: number[] };
}

/**
 * Compares 1–5 scenarios (same team) against the official roster for the
 * scenario's base season.
 */
export async function compareScenarios(scenarioIds: string[]): Promise<ScenarioComparison> {
  if (scenarioIds.length < 1 || scenarioIds.length > 5) {
    throw new Error("Compare between 1 and 5 scenarios");
  }
  const projections = await Promise.all(scenarioIds.map(getScenarioProjection));
  const first = projections[0];
  if (!first) throw new Error("No scenarios to compare");
  const teamIds = new Set(projections.map((p) => p.scenario.teamId));
  if (teamIds.size > 1) throw new Error("Scenarios must belong to the same team to compare");

  const baseSeasonId = first.scenario.baseSeasonId;
  const seasonIdx = Math.max(
    0,
    first.seasons.findIndex((s) => s.id === baseSeasonId),
  );

  const official = first.officialResults[seasonIdx];
  const projectedList = projections.map((p) => p.projectedResults[seasonIdx]);
  if (!official) throw new Error("No cap result for the base season");

  const metric = (
    label: string,
    format: "money" | "count",
    pick: (r: CapResult) => number,
  ): ScenarioComparisonRow => ({
    metric: label,
    format,
    official: pick(official),
    values: projectedList.map((r) => (r ? pick(r) : 0)),
  });

  return {
    seasonName: first.seasons[seasonIdx]?.name ?? "",
    scenarioNames: projections.map((p) => p.scenario.name),
    rows: [
      metric("Cap upper limit", "money", (r) => r.totals.capUpperLimit),
      metric("Total cap charge", "money", (r) => r.totals.totalCapCharge),
      metric("Cap space", "money", (r) => r.totals.capSpace),
      metric("Active-roster cap hit", "money", (r) => r.totals.activeRosterCapHit),
      metric("Injured-reserve cap hit", "money", (r) => r.totals.injuredReserveCapHit),
      metric("Buried cap hit", "money", (r) => r.totals.buriedCapHit),
      metric("Retained salary", "money", (r) => r.totals.retainedTotal),
      metric("Dead cap", "money", (r) => r.totals.deadCapTotal),
      metric("LTIR relief", "money", (r) => r.totals.ltirRelief),
      metric("Cash payroll", "money", (r) => r.totals.totalCashPayroll),
      metric("Active roster size", "count", (r) => r.counts.activeRoster),
      metric("Contract slots used", "count", (r) => r.counts.contractSlots),
      metric("Goalies (active)", "count", (r) => r.counts.goaliesActive),
    ],
    violationCounts: {
      official: official.violations.length,
      scenarios: projectedList.map((r) => r?.violations.length ?? 0),
    },
  };
}
