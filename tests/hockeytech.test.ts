/**
 * HockeyTech (OHL/WHL/QMJHL/USHL/AHL/ECHL) parsers on recorded responses
 * (tests/fixtures/connectors/hockeytech, trimmed to a few rows).
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { HT_LEAGUES, htUrls, parseHtRoster, parseHtSeasons, parseHtSkaterStats, parseHtTeams } from "@/lib/connectors/hockeytech";
import { assertAllowedHost } from "@/lib/connectors/http";

const FIX = path.join(__dirname, "fixtures", "connectors", "hockeytech");
const text = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");
const json = (f: string) => JSON.parse(text(f));

describe("HockeyTech parsers", () => {
  it("labels seasons by start date and flags counted regular seasons", () => {
    const s = parseHtSeasons(json("ohl-seasons.json"));
    expect(s[0]).toMatchObject({ seasonId: "88", name: "2026-27 Regular Season", label: "2026-27", regular: true, playoffs: false });
    const byId = Object.fromEntries(s.map((x) => [x.seasonId, x]));
    expect(byId["87"]).toMatchObject({ regular: false, playoffs: false }); // pre-season
    expect(byId["85"]).toMatchObject({ regular: false, playoffs: true });
    expect(byId["84"]!.regular).toBe(false); // Top Prospects game
    expect(byId["83"]).toMatchObject({ label: "2025-26", regular: true });
  });

  it("reads a whole season's skater lines, including power-play and short-handed splits", () => {
    const lines = parseHtSkaterStats(text("ohl-players-83.txt"));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ playerId: "9385", name: "Nikita Klepov", team: "SAG", gp: 67, goals: 37, assists: 60, points: 97, ppGoals: 13, ppAssists: 25, shGoals: 3, shots: 240 });
    expect(lines.every((l) => l.goals + l.assists === l.points)).toBe(true);
  });

  it("takes QMJHL full names from the row properties", () => {
    const lines = parseHtSkaterStats(text("qmjhl-players-211.txt"));
    expect(lines[0]!.name).toBe("Maxim Massé");
  });

  it("keeps players with birth dates from rosters and drops team staff", () => {
    const r = parseHtRoster(json("ohl-roster-34-83.json"));
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ playerId: "9383", name: "Levi Harper", birthDate: "2008-10-03", position: "D" });
    expect(r.some((p) => /Lazary|Drinkill/.test(p.name))).toBe(false);
    expect(parseHtTeams(json("ohl-teams-83.json"))[0]).toEqual({ teamId: "7", name: "Barrie Colts", code: "BAR", division: "Central Division" });
  });

  it("fails loudly on a missing envelope", () => {
    expect(() => parseHtSkaterStats("not json")).toThrow(/not JSON/);
    expect(() => parseHtSkaterStats("([{}])")).toThrow(/sections/);
    expect(() => parseHtSeasons({})).toThrow(/Seasons/);
    expect(() => parseHtRoster({ SiteKit: {} })).toThrow(/Roster/);
  });

  it("builds only allowlisted URLs with numeric ids", () => {
    const u = htUrls.skaterStats(HT_LEAGUES.ohl, 83);
    expect(assertAllowedHost("hockeytech", u)).toBe("lscluster.hockeytech.com");
    expect(() => htUrls.roster(HT_LEAGUES.ohl, "34&x=1", 83)).toThrow(/team id/);
  });
});
