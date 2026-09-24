/**
 * Connector parser tests — every expectation below is checked against REAL
 * responses recorded in tests/fixtures/connectors/ (see manifest.json and
 * scripts/record-connector-fixtures.ts), not hand-written payloads.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  ConnectorParseError,
  clockToSeconds,
  int,
  nhlSeasonLabel,
  normalizePosition,
  seasonLabelToNhlId,
  startYearSeasonLabel,
  type NormalizedRecord,
} from "@/lib/connectors/util";
import {
  nhlUrls,
  parseDraftPicks,
  parseDraftRankings,
  parseGameLog,
  parseGoalieSummary,
  parsePlayerBio,
  parsePlayerCareer,
  parseRoster,
  parseSkaterSummary,
  parseTeamIndex,
  parseTeamSummary,
} from "@/lib/connectors/nhl";
import { moneyPuckUrl, parseMoneyPuckGoalies, parseMoneyPuckSkaters, parseMoneyPuckTeams } from "@/lib/connectors/moneypuck";
import { epPlayerSearchUrl, getEpConfig, parseEpError, parseEpPlayers } from "@/lib/connectors/eliteprospects";
import { cacheKeyFor, redactUrl } from "@/lib/connectors/http";
import { HostRateLimiter } from "@/lib/connectors/rateLimiter";
import { CONNECTOR_DEFINITIONS, type ConnectorImportType } from "@/lib/import/connectorDefinitions";
import { isCsvImportType } from "@/lib/import/definitions";

const FIX = path.join(process.cwd(), "tests", "fixtures", "connectors");
const json = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const text = (f: string): string => fs.readFileSync(path.join(FIX, f), "utf8");

/** Every record must pass its dataset's own field validators (parsers and definitions agree). */
function expectValid(type: ConnectorImportType, records: NormalizedRecord[]) {
  const def = CONNECTOR_DEFINITIONS[type];
  const problems: string[] = [];
  records.forEach((r, i) => {
    for (const f of def.fields) {
      const v = r[f.key] ?? "";
      if (f.required && v === "") problems.push(`#${i} ${f.key} required`);
      const err = f.validate(v);
      if (err) problems.push(`#${i} ${f.key}=${v}: ${err}`);
    }
    for (const k of Object.keys(r)) {
      if (!def.fields.some((f) => f.key === k)) problems.push(`#${i} unexpected key ${k}`);
    }
  });
  expect(problems).toEqual([]);
}

describe("connector utilities", () => {
  it("converts clocks, seasons, and positions deterministically", () => {
    expect(clockToSeconds("22:59")).toBe("1379");
    expect(clockToSeconds("297:30")).toBe("17850");
    expect(clockToSeconds(undefined)).toBe("");
    expect(clockToSeconds("7:5")).toBe("");
    expect(nhlSeasonLabel(20242025)).toBe("2024-25");
    expect(nhlSeasonLabel(20242026)).toBe("");
    expect(startYearSeasonLabel("2024")).toBe("2024-25");
    expect(startYearSeasonLabel("1999")).toBe("1999-00");
    expect(seasonLabelToNhlId("2024-25")).toBe("20242025");
    expect(normalizePosition("L")).toBe("LW");
    expect(normalizePosition("R")).toBe("RW");
    expect(normalizePosition("Team Level")).toBe("");
    expect(int("61.0")).toBe("61");
    expect(int("61.5")).toBe("");
    expect(int(null)).toBe("");
  });

  it("refuses malformed URL inputs before any request is made", () => {
    expect(() => nhlUrls.roster("chicago", "20242025")).toThrow(ConnectorParseError);
    expect(() => nhlUrls.roster("CHI", "20242026")).toThrow(ConnectorParseError);
    expect(() => nhlUrls.playerLanding("123")).toThrow(ConnectorParseError);
    expect(() => nhlUrls.draftRankings(2005, 1)).toThrow(ConnectorParseError);
    expect(() => moneyPuckUrl(2007, "regular", "skaters")).toThrow(ConnectorParseError);
    expect(moneyPuckUrl(2024, "regular", "skaters")).toBe(
      "https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/skaters.csv",
    );
  });
});

describe("NHL API parsers (recorded fixtures)", () => {
  it("player landing → bio with draft details", () => {
    const bio = parsePlayerBio(json("nhl/player-landing-8478402.json"));
    expect(bio).toMatchObject({
      external_id: "8478402",
      full_name: "Connor McDavid",
      position: "C",
      shoots_catches: "L",
      date_of_birth: "1997-01-13",
      height_cm: "188",
      weight_kg: "86",
      birth_country: "CAN",
      current_team_abbrev: "EDM",
      is_active: "true",
      draft_year: "2015",
      draft_round: "1",
      draft_overall: "1",
      draft_team_abbrev: "EDM",
    });
    expectValid("nhl_players", [bio]);

    const retired = parsePlayerBio(json("nhl/player-landing-8471679.json"));
    expect(retired).toMatchObject({ full_name: "Carey Price", position: "G", is_active: "false", current_team_abbrev: "", draft_overall: "5" });
    expectValid("nhl_players", [retired]);
  });

  it("career seasons keep TOI only where the source reports it", () => {
    const career = parsePlayerCareer(json("nhl/player-landing-8478402.json"));
    expectValid("nhl_player_seasons", career.records);
    const nhl2526 = career.records.find((r) => r.season === "2025-26" && r.league === "NHL" && r.game_type === "regular");
    expect(nhl2526).toMatchObject({ games_played: "82", goals: "48", assists: "90", points: "138", toi_per_game_seconds: "1379", pp_points: "54" });
    const minor = career.records.find((r) => r.league === "GTHL");
    expect(minor?.toi_per_game_seconds).toBe(""); // never estimated
    expect(minor?.plus_minus).toBe("");
    expect(career.warnings.some((w) => w.includes("no time-on-ice"))).toBe(true);
    expect(career.effectiveSeason).toBe("2025-26");
  });

  it("goalie career: exact TOI conversion, placeholder 0 save % stays missing", () => {
    const career = parsePlayerCareer(json("nhl/player-landing-8471679.json"));
    expectValid("nhl_player_seasons", career.records);
    const last = career.records.find((r) => r.season === "2021-22" && r.league === "NHL" && r.game_type === "regular");
    expect(last).toMatchObject({ shots_against: "148", goals_against: "18", save_pct: "0.878378", toi_seconds: "17850", wins: "1" });
    const pcbhl = career.records.find((r) => r.league === "PCBHL");
    expect(pcbhl?.save_pct).toBe(""); // source reports 0.0 with no shots against
    expect(pcbhl?.gaa).toBe("2.89");
    expect(career.warnings.some((w) => w.includes("save % 0 without shots against"))).toBe(true);
  });

  it("skater game log reconciles with the career season line", () => {
    const log = parseGameLog(json("nhl/game-log-8478402-20242025-2.json"), "8478402", json("nhl/player-landing-8478402.json"));
    expect(log.records).toHaveLength(67);
    expectValid("nhl_game_logs", log.records);
    const total = (k: string) => log.records.reduce((a, r) => a + Number(r[k]), 0);
    // Same season line from the landing: 67 GP, 26 G, 100 P, avgToi 22:02.
    const career = parsePlayerCareer(json("nhl/player-landing-8478402.json")).records.find(
      (r) => r.season === "2024-25" && r.league === "NHL" && r.game_type === "regular",
    )!;
    expect(String(log.records.length)).toBe(career.games_played);
    expect(String(total("goals"))).toBe(career.goals);
    expect(String(total("points"))).toBe(career.points);
    expect(Math.round(total("toi_seconds") / 67)).toBe(Number(career.toi_per_game_seconds)); // 1322 s = 22:02
    const first = log.records.find((r) => r.game_id === "2024021306")!;
    expect(first).toMatchObject({ player_name: "Connor McDavid", game_date: "2025-04-16", home_road: "R", opponent_abbrev: "SJS", toi_seconds: "1051", shifts: "16", decision: "", shots_against: "" });
    expect(log.effectiveSeason).toBe("2024-25");
    const playoffs = parseGameLog(json("nhl/game-log-8478402-20242025-3.json"), "8478402");
    expect(playoffs.records).toHaveLength(22);
    expect(playoffs.records.every((r) => r.game_type === "playoffs")).toBe(true);
    expect(playoffs.warnings.some((w) => w.includes("name unavailable"))).toBe(true);
  });

  it("goalie game log: W/L/O decisions, relief appearance left without a decision", () => {
    const log = parseGameLog(json("nhl/game-log-8476945-20242025-2.json"), "8476945", json("nhl/player-landing-8476945.json"));
    expect(log.records).toHaveLength(63);
    expectValid("nhl_game_logs", log.records);
    const dec = (d: string) => log.records.filter((r) => r.decision === d).length;
    expect([dec("W"), dec("L"), dec("O"), dec("")]).toEqual([47, 12, 3, 1]);
    const relief = log.records.find((r) => r.decision === "")!;
    expect(relief).toMatchObject({ games_started: "0", toi_seconds: "610", goals: "0", points: "", shots: "" });
    expect(log.records.reduce((a, r) => a + Number(r.shots_against), 0)).toBe(1664);
    expect(log.records.reduce((a, r) => a + Number(r.goals_against), 0)).toBe(125);
    expect(log.warnings.some((w) => w.includes("1 relief appearance"))).toBe(true);
  });

  it("game log rejects a missing envelope", () => {
    expect(() => parseGameLog({ gameLog: [] }, "8478402")).toThrow(/seasonId/);
    expect(() => parseGameLog({ seasonId: 20242025, gameTypeId: 2 }, "8478402")).toThrow(ConnectorParseError);
  });

  it("roster → one record per skater and goalie with wing relabel", () => {
    const roster = parseRoster(json("nhl/roster-CHI-20242025.json"), "CHI", "20242025");
    expect(roster.records).toHaveLength(24);
    expectValid("nhl_roster", roster.records);
    const bedard = roster.records.find((r) => r.external_id === "8484144");
    expect(bedard).toMatchObject({ full_name: "Connor Bedard", position: "C", sweater_number: "98", season: "2024-25", team_abbrev: "CHI", height_cm: "178" });
    expect(roster.records.some((r) => r.position === "LW")).toBe(true);
    expect(roster.records.every((r) => ["C", "LW", "RW", "D", "G"].includes(r.position!))).toBe(true);
  });

  it("Central Scouting rankings keep midterm and final ranks separate", () => {
    const na = parseDraftRankings(json("nhl/draft-rankings-2025-1.json"));
    expectValid("nhl_draft_rankings", na.records);
    expect(na.effectiveSeason).toBe("2025 NHL Draft");
    expect(na.records[0]).toMatchObject({ player_name: "Matthew Schaefer", position: "D", midterm_rank: "1", final_rank: "1", last_amateur_league: "OHL", category_id: "1" });
    const noMid = na.records.filter((r) => r.midterm_rank === "");
    expect(noMid.length).toBeGreaterThan(0);
    expect(noMid.every((r) => r.final_rank !== "")).toBe(true);
    expect(na.warnings.some((w) => w.includes("no midterm rank"))).toBe(true);

    const goalies = parseDraftRankings(json("nhl/draft-rankings-2025-3.json"));
    expectValid("nhl_draft_rankings", goalies.records);
    expect(goalies.records[0]).toMatchObject({ player_name: "Joshua Ravensbergen", position: "G", category_key: "north-american-goalie" });
  });

  it("draft picks: round 1 of 2024", () => {
    const picks = parseDraftPicks(json("nhl/draft-picks-2024-1.json"));
    expect(picks.records).toHaveLength(32);
    expectValid("nhl_draft_picks", picks.records);
    expect(picks.records[0]).toMatchObject({
      draft_year: "2024",
      overall_pick: "1",
      team_abbrev: "SJS",
      player_name: "Macklin Celebrini",
      position: "C",
      amateur_club: "Boston University",
      height_inches: "72",
    });
    expect(picks.warnings).toEqual([]);
  });

  it("league skater summary: traded players aggregated, null faceoff % stays blank", () => {
    const s = parseSkaterSummary(json("nhl/stats-skater-summary-20242025-2.json"), 2);
    expect(s.records).toHaveLength(17);
    expectValid("nhl_skater_stats", s.records);
    const traded = s.records.find((r) => r.team_name === "PHI,COL");
    expect(traded?.player_name).toBe("Erik Johnson");
    expect(traded?.faceoff_pct).toBe("");
    expect(s.records.every((r) => r.toi_per_game_seconds !== "")).toBe(true);
    // The fixture is trimmed; the parser reports the source's own total honestly.
    expect(s.warnings.some((w) => w.includes("reported 920 rows but returned 17"))).toBe(true);
    expect(s.effectiveSeason).toBe("2024-25");
  });

  it("goalie and team summaries", () => {
    const g = parseGoalieSummary(json("nhl/stats-goalie-summary-20242025-2.json"), 2);
    expect(g.records).toHaveLength(10);
    expectValid("nhl_goalie_stats", g.records);
    expect(g.records.every((r) => r.position === "G" && r.save_pct !== "")).toBe(true);

    const index = parseTeamIndex(json("nhl/stats-teams.json"));
    expect(index.get("54")).toBe("VGK");
    const t = parseTeamSummary(json("nhl/stats-team-summary-20242025-2.json"), 2, index);
    expect(t.records).toHaveLength(32);
    expectValid("nhl_team_stats", t.records);
    expect(t.records.find((r) => r.team_abbrev === "VGK")).toMatchObject({ points: "110", goals_for: "274", goals_against: "214" });
    expect(t.warnings).toEqual([]);
  });

  it("fails loudly on an unexpected envelope", () => {
    expect(() => parseRoster({ players: [] }, "CHI", "20242025")).toThrow(ConnectorParseError);
    expect(() => parseDraftRankings({ rankings: [] })).toThrow(/draftYear/);
    expect(() => parseSkaterSummary([], 2)).toThrow(ConnectorParseError);
  });
});

describe("MoneyPuck parsers (recorded CSV fixtures)", () => {
  it("skaters: situation filter, seconds TOI, individual and on-ice metrics", () => {
    const csv = text("moneypuck/skaters-2024-regular.csv");
    const all = parseMoneyPuckSkaters(csv, "regular", ["all"]);
    expect(all.records).toHaveLength(8);
    expectValid("moneypuck_skaters", all.records);
    const bunting = all.records.find((r) => r.player_name === "Michael Bunting");
    expect(bunting).toMatchObject({
      external_player_id: "8478047",
      season: "2024-25",
      team_name: "NSH",
      position: "LW",
      situation: "all",
      games_played: "76",
      toi_seconds: "70819",
      goals: "19",
      m_primary_assists: "12",
      m_secondary_assists: "7",
      points: "38",
      x_goals: "25.19",
      on_ice_xg_pct: "0.55",
    });
    const two = parseMoneyPuckSkaters(csv, "regular", ["all", "5on5"]);
    expect(two.records).toHaveLength(16);
    expect(all.effectiveSeason).toBe("2024-25");
  });

  it("goalies: goals/xGoals/ongoal are against", () => {
    const g = parseMoneyPuckGoalies(text("moneypuck/goalies-2024-regular.csv"), "regular", ["all"]);
    expect(g.records).toHaveLength(5);
    expectValid("moneypuck_goalies", g.records);
    expect(g.records.find((r) => r.player_name === "Igor Shesterkin")).toMatchObject({
      goals_against: "167",
      x_goals: "188.56",
      shots_against: "1751",
      toi_seconds: "210308",
    });
  });

  it("teams: repeated `team` header resolves to the first column", () => {
    const t = parseMoneyPuckTeams(text("moneypuck/teams-2024-regular.csv"), "regular", ["all"]);
    expect(t.records).toHaveLength(3);
    expectValid("moneypuck_teams", t.records);
    expect(t.records.find((r) => r.team_abbrev === "VGK")).toMatchObject({ games_played: "82", x_goals_pct: "0.54" });
  });

  it("rejects files missing the columns it depends on", () => {
    expect(() => parseMoneyPuckSkaters("playerId,season,name\n1,2024,X\n", "regular", ["all"])).toThrow(/expected column/);
    expect(() => parseMoneyPuckSkaters(text("moneypuck/skaters-2024-regular.csv"), "regular", ["pp"])).toThrow(/situation/);
  });
});

describe("EliteProspects (official API, disabled until configured)", () => {
  it("is disabled without a key and enabled with one", () => {
    expect(getEpConfig({}).enabled).toBe(false);
    expect(getEpConfig({}).reason).toMatch(/EP_API_KEY/);
    expect(getEpConfig({ EP_API_KEY: "k" }).enabled).toBe(true);
    expect(getEpConfig({ ELITEPROSPECTS_API_KEY: "k" }).enabled).toBe(true);
  });

  it("sends the key as `apiKey` and never stores it", () => {
    const url = epPlayerSearchUrl("Macklin Celebrini", "secret-123");
    expect(url).toContain("apiKey=secret-123");
    const safe = redactUrl(url);
    expect(safe).not.toContain("secret-123");
    expect(safe).toContain("apiKey=REDACTED");
    expect(cacheKeyFor(url)).toBe(cacheKeyFor(url.replace("secret-123", "other-key")));
  });

  it("reads real 401 error bodies", () => {
    expect(parseEpError(text("eliteprospects/401-missing-key.json"))).toBe("Api Key was not present in request");
    expect(parseEpError(text("eliteprospects/401-invalid-key.json"))).toBe("Api Key didnt meet the requirements");
  });

  it("refuses shapes it has not been verified against", () => {
    expect(() => parseEpPlayers(json("eliteprospects/401-missing-key.json"))).toThrow(/shape not recognized/);
    expect(() => parseEpPlayers({ data: [{ name: "No Id" }] })).toThrow(/no numeric id/);
    const ok = parseEpPlayers({ data: [{ id: 123, firstName: "A", lastName: "B", position: "D", dateOfBirth: "2006-01-02" }] });
    expectValid("ep_players", ok.records);
    expect(ok.records[0]).toMatchObject({ external_id: "123", full_name: "A B", position: "D", height_cm: "" });
  });
});

describe("rate limiting and upload guard", () => {
  it("spaces requests per host and leaves other hosts alone", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = new HostRateLimiter({ "a.test": 500 }, 1000, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    expect(await limiter.acquire("a.test")).toBe(0);
    clock += 100;
    expect(await limiter.acquire("a.test")).toBe(400);
    expect(await limiter.acquire("b.test")).toBe(0);
    expect(await limiter.acquire("b.test")).toBe(1000);
    expect(waits).toEqual([400, 1000]);
  });

  it("connector datasets can never be uploaded as CSV", () => {
    expect(isCsvImportType("players")).toBe(true);
    for (const t of Object.keys(CONNECTOR_DEFINITIONS)) expect(isCsvImportType(t)).toBe(false);
  });
});
