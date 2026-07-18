/**
 * Player valuation service: assembles model inputs from stored projections,
 * league rules, and the comparable-contract pool, runs the v0.1 models, and
 * (optionally) persists the results with their model versions.
 */
import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { loadRuleSet } from "./capService";
import { RULE_KEYS } from "@/lib/engine/types";
import {
  calculateSurplusValue,
  estimateMarketValue,
  estimatePerformanceValue,
  MARKET_MODEL_VERSION,
  type MarketValueResult,
  type PerformanceValueResult,
} from "@/lib/valuation/models";

/** League-wide $/GAR assumption for the demo dataset (documented in docs/MODELS.md). */
const DOLLARS_PER_GAR = 425_000;
const CAP_INFLATION_PCT = 0.04;

export interface PlayerValuationView {
  player: typeof schema.players.$inferSelect;
  seasonId: string;
  seasonName: string;
  age: number | null;
  capHit: number | null;
  projection: typeof schema.playerProjections.$inferSelect | null;
  performance: PerformanceValueResult | null;
  market: MarketValueResult | null;
  surplus: number | null;
  inputDataDate: string;
}

function ageOn(dateOfBirth: string | null, onDate: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  let age = onDate.getFullYear() - dob.getFullYear();
  const m = onDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && onDate.getDate() < dob.getDate())) age -= 1;
  return age;
}

export async function valuatePlayer(playerId: string, seasonId: string): Promise<PlayerValuationView> {
  const db = getDb();
  const playerRows = await db.select().from(schema.players).where(eq(schema.players.id, playerId)).limit(1);
  const player = playerRows[0];
  if (!player) throw new Error("Player not found");

  const seasonRows = await db
    .select()
    .from(schema.leagueSeasons)
    .where(eq(schema.leagueSeasons.id, seasonId))
    .limit(1);
  const season = seasonRows[0];
  if (!season) throw new Error("Season not found");

  const rules = await loadRuleSet(season.leagueId, seasonId);
  const minSalary = rules.get(RULE_KEYS.minSalary)?.numericValue ?? 800_000;

  const projections = await db
    .select()
    .from(schema.playerProjections)
    .where(and(eq(schema.playerProjections.playerId, playerId), eq(schema.playerProjections.seasonId, seasonId)))
    .limit(1);
  const projection = projections[0] ?? null;

  // Current-season cap hit, if under contract with this org.
  const capRows = await db
    .select({ capHit: schema.contractSeasons.capHit })
    .from(schema.contractSeasons)
    .innerJoin(schema.contracts, eq(schema.contractSeasons.contractId, schema.contracts.id))
    .where(
      and(
        eq(schema.contracts.playerId, playerId),
        eq(schema.contracts.contractStatus, "active"),
        eq(schema.contractSeasons.seasonId, seasonId),
      ),
    )
    .limit(1);
  const capHit = capRows[0]?.capHit ?? null;

  const age = ageOn(player.dateOfBirth, new Date(season.startDate));

  let performance: PerformanceValueResult | null = null;
  let market: MarketValueResult | null = null;
  let surplus: number | null = null;

  if (projection) {
    performance = estimatePerformanceValue({
      projectedGar: projection.projectedGar,
      projectedAvailability: projection.projectedAvailability,
      position: player.position,
      age,
      leagueMinSalary: minSalary,
      dollarsPerGar: DOLLARS_PER_GAR,
    });

    // Comparable pool: global seeded comparables + this org's own records.
    const comparables = await db
      .select()
      .from(schema.comparableContracts)
      .where(
        or(
          isNull(schema.comparableContracts.organizationId),
          eq(schema.comparableContracts.organizationId, player.organizationId),
        ),
      );

    market = estimateMarketValue({
      playerName: player.fullName,
      position: player.position,
      age,
      platformPoints: projection.projectedPoints,
      performanceValue: performance.performanceValue,
      freeAgentStatus: player.freeAgentStatus,
      comparables: comparables.map((c) => ({
        id: c.id,
        playerName: c.playerName,
        position: c.position,
        ageAtSigning: c.ageAtSigning,
        platformPoints: c.platformPoints,
        aav: c.aav,
        termYears: c.termYears,
        signingSeason: c.signingSeason,
      })),
      capInflationPct: CAP_INFLATION_PCT,
      leagueMinSalary: minSalary,
    });

    if (capHit !== null) {
      surplus = calculateSurplusValue(performance.performanceValue, capHit).surplusValue;
    }
  }

  return {
    player,
    seasonId,
    seasonName: season.name,
    age,
    capHit,
    projection,
    performance,
    market,
    surplus,
    inputDataDate: new Date().toISOString().slice(0, 10),
  };
}

/** Persists a valuation snapshot (used by seed and the "save estimate" action). */
export async function persistValuation(view: PlayerValuationView): Promise<void> {
  if (!view.market || !view.performance) return;
  const db = getDb();
  await db.insert(schema.playerValuations).values({
    playerId: view.player.id,
    seasonId: view.seasonId,
    modelVersion: MARKET_MODEL_VERSION,
    estimatedAav: view.market.estimatedAav,
    estimatedAavLow: view.market.lowEstimate,
    estimatedAavHigh: view.market.highEstimate,
    estimatedTermYears: view.market.estimatedTermYears,
    estimatedTotalValue: view.market.estimatedTotalValue,
    performanceValue: view.performance.performanceValue,
    confidence: view.market.confidence,
    assumptions: { list: view.market.assumptions },
    inputDataDate: view.inputDataDate,
  });
}
