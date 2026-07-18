import { describe, it, expect } from "vitest";
import {
  estimatePerformanceValue,
  estimateMarketValue,
  calculateSurplusValue,
  estimateTermYears,
  MARKET_MODEL_VERSION,
  PERFORMANCE_MODEL_VERSION,
  type ComparableRecord,
} from "@/lib/valuation/models";

const MIN_SALARY = 800_000;

function comp(over: Partial<ComparableRecord>): ComparableRecord {
  return {
    id: crypto.randomUUID(),
    playerName: "Comp",
    position: "C",
    ageAtSigning: 26,
    platformPoints: 60,
    aav: 6_000_000,
    termYears: 6,
    signingSeason: "2024-25",
    ...over,
  };
}

describe("estimatePerformanceValue", () => {
  it("prices GAR above a replacement-level floor", () => {
    const res = estimatePerformanceValue({
      projectedGar: 10,
      projectedAvailability: 1,
      position: "C",
      age: 26,
      leagueMinSalary: MIN_SALARY,
      dollarsPerGar: 400_000,
    });
    expect(res.performanceValue).toBe(MIN_SALARY + 4_000_000);
    expect(res.modelVersion).toBe(PERFORMANCE_MODEL_VERSION);
    expect(res.components).toHaveLength(2);
  });

  it("never returns below the league minimum, even for negative GAR", () => {
    const res = estimatePerformanceValue({
      projectedGar: -5,
      projectedAvailability: 0.8,
      position: "D",
      age: 35,
      leagueMinSalary: MIN_SALARY,
      dollarsPerGar: 400_000,
    });
    expect(res.performanceValue).toBe(MIN_SALARY);
  });

  it("discounts by projected availability", () => {
    const full = estimatePerformanceValue({
      projectedGar: 10, projectedAvailability: 1, position: "LW", age: 25,
      leagueMinSalary: MIN_SALARY, dollarsPerGar: 400_000,
    });
    const half = estimatePerformanceValue({
      projectedGar: 10, projectedAvailability: 0.5, position: "LW", age: 25,
      leagueMinSalary: MIN_SALARY, dollarsPerGar: 400_000,
    });
    expect(half.performanceValue - MIN_SALARY).toBe((full.performanceValue - MIN_SALARY) / 2);
  });
});

describe("estimateMarketValue", () => {
  const baseInputs = {
    playerName: "Test Player",
    position: "C",
    age: 26,
    platformPoints: 62,
    performanceValue: 6_500_000,
    freeAgentStatus: "ufa" as const,
    capInflationPct: 0.04,
    leagueMinSalary: MIN_SALARY,
  };

  it("blends performance value with positional comparables", () => {
    const res = estimateMarketValue({
      ...baseInputs,
      comparables: [
        comp({ platformPoints: 58, aav: 5_800_000 }),
        comp({ platformPoints: 65, aav: 6_400_000 }),
        comp({ platformPoints: 61, aav: 6_100_000 }),
        comp({ position: "G", aav: 1_000_000 }), // wrong position, must be excluded
      ],
    });
    expect(res.comparablesUsed).toHaveLength(3);
    expect(res.comparablesUsed.every((c) => c.position === "C")).toBe(true);
    expect(res.estimatedAav).toBeGreaterThan(6_000_000);
    expect(res.lowEstimate).toBeLessThan(res.estimatedAav);
    expect(res.highEstimate).toBeGreaterThan(res.estimatedAav);
    expect(res.confidence).toBeGreaterThan(0.6);
    expect(res.modelVersion).toBe(MARKET_MODEL_VERSION);
    expect(res.disclaimer).toContain("estimate");
  });

  it("falls back to performance value with low confidence when no comparables exist", () => {
    const res = estimateMarketValue({ ...baseInputs, comparables: [] });
    expect(res.estimatedAav).toBe(6_500_000);
    expect(res.confidence).toBeLessThanOrEqual(0.35);
  });

  it("applies an RFA discount", () => {
    const ufa = estimateMarketValue({ ...baseInputs, comparables: [] });
    const rfa = estimateMarketValue({ ...baseInputs, freeAgentStatus: "rfa", comparables: [] });
    expect(rfa.estimatedAav).toBeLessThan(ufa.estimatedAav);
  });

  it("floors estimates at the league minimum", () => {
    const res = estimateMarketValue({
      ...baseInputs,
      performanceValue: 100_000,
      comparables: [],
    });
    expect(res.estimatedAav).toBe(MIN_SALARY);
    expect(res.lowEstimate).toBe(MIN_SALARY);
  });
});

describe("estimateTermYears", () => {
  it("follows the age curve", () => {
    expect(estimateTermYears(22, "rfa")).toBe(3);
    expect(estimateTermYears(25, "ufa")).toBe(5);
    expect(estimateTermYears(31, "ufa")).toBe(3);
    expect(estimateTermYears(36, "ufa")).toBe(1);
    expect(estimateTermYears(null, "ufa")).toBe(3);
  });
});

describe("calculateSurplusValue", () => {
  it("is performance value minus cap hit (worked example from the spec)", () => {
    const res = calculateSurplusValue(6_200_000, 4_000_000);
    expect(res.surplusValue).toBe(2_200_000);
  });

  it("supports negative surplus", () => {
    expect(calculateSurplusValue(2_000_000, 5_000_000).surplusValue).toBe(-3_000_000);
  });
});
