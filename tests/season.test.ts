import { describe, expect, it } from "vitest";
import { currentSeasonLabel, nhlSeasonId, pickCurrentSeason, seasonStartYear } from "@/lib/season";

describe("season rollover", () => {
  it("the league year turns over on July 1", () => {
    expect(seasonStartYear(new Date("2026-06-30T23:00:00Z"))).toBe(2025);
    expect(seasonStartYear(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
    expect(currentSeasonLabel(new Date("2026-09-25T00:00:00Z"))).toBe("2026-27");
    expect(currentSeasonLabel(new Date("2027-03-01T00:00:00Z"))).toBe("2026-27");
    expect(currentSeasonLabel(new Date("2099-12-01T00:00:00Z"))).toBe("2099-00");
    expect(nhlSeasonId(2026)).toBe("20262027");
  });

  it("defaults to today's season, then the flagged one, then the first", () => {
    const seasons = [
      { name: "2025-26", isCurrent: true },
      { name: "2026-27", isCurrent: false },
    ];
    expect(pickCurrentSeason(seasons, new Date("2026-09-25T00:00:00Z"))?.name).toBe("2026-27");
    expect(pickCurrentSeason(seasons, new Date("2030-01-01T00:00:00Z"))?.name).toBe("2025-26");
    expect(pickCurrentSeason([{ name: "x", isCurrent: false }], new Date())?.name).toBe("x");
    expect(pickCurrentSeason([], new Date())).toBeUndefined();
  });
});
