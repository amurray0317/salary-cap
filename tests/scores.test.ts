/**
 * Live Scores page: scoreboard parsing on recorded NHL responses
 * (tests/fixtures/connectors/nhl/score-*.json) and the short in-memory cache.
 */
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FetchImpl } from "@/lib/connectors/http";
import { parseScoreboard, periodLabel, scoreboardUrl } from "@/lib/connectors/nhlScores";
import { clearScoreboardCache, getScoreboard } from "@/server/services/scoresService";

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "connectors", "nhl", f), "utf8"));

describe("parseScoreboard", () => {
  it("reads a finished game day: scores, shots and every goal in order", () => {
    const b = parseScoreboard(load("score-2026-04-16.json"));
    expect(b).toMatchObject({ date: "2026-04-16", prevDate: "2026-04-15", nextDate: "2026-04-18" });
    expect(b.games).toHaveLength(6);
    expect(b.games.every((g) => g.status === "final" && g.gameType === "regular")).toBe(true);
    const stl = b.games.find((g) => g.away.abbrev === "STL")!;
    expect(stl).toMatchObject({ away: { score: 5 }, home: { abbrev: "UTA", score: 3 }, period: "3rd", clock: null, finishedIn: null });
    expect(stl.goals).toHaveLength(8);
    expect(stl.goals[0]).toMatchObject({ period: "1st", time: "03:45", team: "STL", scorer: "P. Buchnevich", scorerTotal: 20, assists: ["J. Kyrou", "P. Suter"], awayScore: 1, homeScore: 0 });
    expect(stl.goals.some((x) => x.emptyNet)).toBe(true);
    // The last goal's running score is the final score.
    const last = stl.goals[stl.goals.length - 1]!;
    expect([last.awayScore, last.homeScore]).toEqual([5, 3]);
  });

  it("labels games decided in overtime and in a shootout", () => {
    const b = parseScoreboard(load("score-2026-04-13.json"));
    const by = (a: string, h: string) => b.games.find((g) => g.away.abbrev === a && g.home.abbrev === h)!;
    expect(by("DET", "TBL")).toMatchObject({ finishedIn: "OT", period: "OT" });
    expect(by("CAR", "PHI")).toMatchObject({ finishedIn: "SO", period: "SO" });
    expect(b.games.filter((g) => g.finishedIn === null).every((g) => g.period === "3rd")).toBe(true);
  });

  it("shows scheduled preseason games without scores", () => {
    const b = parseScoreboard(load("score-2026-09-24-pregame.json"));
    expect(b.games).toHaveLength(11);
    expect(b.games.every((g) => g.status === "scheduled" && g.gameType === "preseason" && g.away.score === null && g.goals.length === 0)).toBe(true);
  });

  it("maps live states, intermissions and period labels", () => {
    const base = load("score-2026-04-16.json").games[0];
    const live = { ...base, gameState: "LIVE", periodDescriptor: { number: 2, periodType: "REG", maxRegulationPeriods: 3 }, clock: { timeRemaining: "07:12", running: true, inIntermission: false } };
    const inter = { ...live, clock: { ...live.clock, inIntermission: true } };
    const b = parseScoreboard({ currentDate: "2026-04-16", games: [live, inter, { ...base, gameScheduleState: "PPD" }] });
    expect(b.games.map((g) => [g.status, g.period, g.clock])).toEqual([
      ["live", "2nd", "07:12"],
      ["intermission", "2nd", "07:12"],
      ["postponed", null, null],
    ]);
    expect(periodLabel({ number: 5, periodType: "OT", maxRegulationPeriods: 3 })).toBe("2OT");
    expect(() => parseScoreboard({ games: [{ ...base, gameState: "WEIRD" }] })).toThrow(/unknown game state/);
    expect(() => parseScoreboard({})).toThrow(/games array/);
  });

  it("only builds scoreboard URLs for a date or now", () => {
    expect(scoreboardUrl("now")).toBe("https://api-web.nhle.com/v1/score/now");
    expect(() => scoreboardUrl("../standings")).toThrow();
  });
});

describe("getScoreboard cache", () => {
  beforeEach(() => clearScoreboardCache());

  it("serves repeat views from memory and re-fetches after the short live TTL", async () => {
    let calls = 0;
    const body = fs.readFileSync(path.join(__dirname, "fixtures", "connectors", "nhl", "score-2026-09-24-pregame.json"), "utf8");
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      return { status: 200, headers: { get: () => "application/json" }, text: async () => body };
    };
    let t = 0;
    const deps = { fetchImpl, now: () => t };
    await getScoreboard("now", deps);
    t = 10_000;
    await getScoreboard("now", deps);
    expect(calls).toBe(1);
    t = 16_000;
    await getScoreboard("now", deps);
    expect(calls).toBe(2);
  });
});
