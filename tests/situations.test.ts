/**
 * Team game-state splits, parsed from recorded NHL stats REST responses
 * (2025-26 regular season). Expected values are hand-computed from the raw JSON.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { TEAM_REPORTS, parseTeamSituations, teamReportUrl, type TeamReport } from "@/lib/connectors/nhlSituations";
import { ConnectorParseError } from "@/lib/connectors/util";

const DIR = path.join(process.cwd(), "tests", "fixtures", "connectors", "nhl", "situations-20252026-2");
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as unknown;
const reports = Object.fromEntries(TEAM_REPORTS.map((r) => [r, load(`${r}.json`)])) as Record<TeamReport, unknown>;
const index = load("team-index.json");

describe("team situations", () => {
  const xg = new Map([["TOR", { ev5: { xgf: 158.3696, xga: 190.8895 }, pp: { xgf: 43.2508, xga: 6.1564 }, pk: { xgf: 5.5891, xga: 59.4213 } }]]);
  const teams = parseTeamSituations(reports, index, xg);
  const tor = teams.find((t) => t.team === "TOR")!;

  it("one row per team, keyed to tri-codes", () => {
    expect(teams).toHaveLength(32);
    expect(new Set(teams.map((t) => t.team)).size).toBe(32);
    expect(teams.every((t) => /^[A-Z]{3}$/.test(t.team) && t.gp === 82)).toBe(true);
  });

  it("power play: official splits and per-60 rates over 5v4 time", () => {
    expect(tor.pp).toMatchObject({ goals5v4: 40, opportunities5v4: 191, toi5v4: 19972, goals5v3: 1, opportunities5v3: 2 });
    // By-strength 5on4 goals (37) over 19,972 s of 5v4 time.
    expect(tor.pp.gf60_5v4).toBeCloseTo(37 / (19972 / 3600), 6);
    expect(tor.pp.xgf60_5v4).toBeCloseTo(43.2508 / (19972 / 3600), 6);
  });

  it("5v5: shares and rates from strength goals and 5v5 time per game", () => {
    expect(tor.ev5.gf).toBe(171);
    expect(tor.ev5.ga).toBe(206);
    expect(tor.ev5.gfPct).toBeCloseTo(171 / 377, 6);
    expect(tor.ev5.xgfPct).toBeCloseTo(158.3696 / (158.3696 + 190.8895), 6);
    const toi = tor.ev5.toiPerGame! * 82;
    expect(tor.ev5.gf60).toBeCloseTo(171 / (toi / 3600), 6);
    expect(tor.ev5.xga60).toBeCloseTo(190.8895 / (toi / 3600), 6);
  });

  it("special-teams index is PP% + PK%; teams without our xG get null xG, not zero", () => {
    expect(tor.specialTeamsIndex).toBeCloseTo(tor.pp.pct! + tor.pk.pct!, 9);
    const other = teams.find((t) => t.team !== "TOR")!;
    expect(other.pp.xgf60_5v4).toBeNull();
    expect(other.ev5.xgfPct).toBeNull();
    expect(other.pp.gf60_5v4).not.toBeNull();
  });

  it("league totals are internally consistent (every goal for is someone's goal against)", () => {
    const sum = (f: (t: (typeof teams)[number]) => number | null) => teams.reduce((a, t) => a + (f(t) ?? 0), 0);
    expect(sum((t) => t.ev5.gf)).toBe(sum((t) => t.ev5.ga));
    expect(sum((t) => t.other.gf3v3)).toBe(sum((t) => t.other.ga3v3));
    expect(sum((t) => t.shootout.wins)).toBe(sum((t) => t.shootout.losses));
    expect(sum((t) => t.pp.goals)).toBe(sum((t) => t.pk.goalsAgainst));
  });

  it("rejects a malformed report and a bad season id", () => {
    expect(() => parseTeamSituations({ ...reports, shootout: { nope: 1 } }, index)).toThrow(ConnectorParseError);
    expect(() => teamReportUrl("powerplay", "2025-26", 2)).toThrow(ConnectorParseError);
    expect(teamReportUrl("powerplay", "20252026", 2)).toContain("seasonId%3D20252026%20and%20gameTypeId%3D2");
  });
});
