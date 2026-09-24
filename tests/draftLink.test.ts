/**
 * Draft pick → NHL player id linking, on real recorded responses
 * (tests/fixtures/connectors/nhl, see manifest.json).
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  landingMatchesBirthDate,
  landingMatchesPick,
  linkDraftPick,
  linkRankedPlayer,
  nameSimilarity,
  normalizeName,
  parseDraftPickRefs,
  parseRankings,
  parseSearchResults,
  rankCandidates,
  type RankedPlayerRef,
} from "@/lib/prospects/draftLink";

const FIX = path.join(__dirname, "fixtures", "connectors", "nhl");
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

/** Search + landing backed only by recorded fixtures; a missing fixture fails the test. */
function recordedDeps() {
  const checked: string[] = [];
  return {
    checked,
    deps: {
      search: async (q: string) => parseSearchResults(load(`search-${q.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.json`)),
      landing: async (id: string) => {
        checked.push(id);
        return load(`landing-draft-${id}.json`);
      },
    },
  };
}

describe("parseDraftPickRefs", () => {
  it("parses real picks with names, round and draft-time size", () => {
    const { picks, noSelection } = parseDraftPickRefs(load("draft-picks-2005.json"), 2005);
    expect(noSelection).toEqual([]);
    expect(picks.map((p) => [p.overallPick, p.round, `${p.firstName} ${p.lastName}`])).toEqual([
      [83, 3, "Mikko Lehtonen"],
      [116, 4, "Jordan Lavallee-Smotherman"],
    ]);
    expect(picks[0]!.heightInches).toBeGreaterThan(60);
  });

  it("reports a forfeited pick as no selection instead of failing", () => {
    const { picks, noSelection } = parseDraftPickRefs(load("draft-picks-2009.json"), 2009);
    expect(picks.map((p) => p.overallPick)).toEqual([117]);
    expect(noSelection).toEqual([{ draftYear: 2009, overallPick: 118, note: "Forfeited" }]);
  });

  it("still rejects a pick missing required fields", () => {
    const bad = { picks: [{ round: 1, overallPick: 1, firstName: { default: "A" } }] };
    expect(() => parseDraftPickRefs(bad, 2020)).toThrow(/missing name/);
  });
});

describe("linkDraftPick", () => {
  it("picks the right one of three players named Mikko Lehtonen by verifying draft details", async () => {
    const { picks } = parseDraftPickRefs(load("draft-picks-2005.json"), 2005);
    const { deps, checked } = recordedDeps();
    const out = await linkDraftPick(picks[0]!, deps);
    expect(out).toMatchObject({ status: "linked", playerId: "8471747", via: "full_name" });
    // Two other exact-name matches were checked and rejected first.
    expect(checked).toEqual(["8482247", "8469714", "8471747"]);
    expect(landingMatchesPick(load("landing-draft-8469714.json"), picks[0]!)).toBe(false);
  });

  it("falls back to a last-name search when the full name finds nobody with that pick", async () => {
    const { picks } = parseDraftPickRefs(load("draft-picks-2005.json"), 2005);
    const { deps } = recordedDeps();
    const out = await linkDraftPick(picks[1]!, deps);
    expect(out).toMatchObject({ status: "linked", playerId: "8471778", via: "last_name" });
  });

  it("never links on a name match alone", async () => {
    const pick = { ...parseDraftPickRefs(load("draft-picks-2005.json"), 2005).picks[0]!, overallPick: 999 };
    const { deps, checked } = recordedDeps();
    // Both queries answered with the recorded "Mikko Lehtonen" results; the
    // three exact-name players are checked once each and all rejected.
    const lehtonen = parseSearchResults(load("search-mikko_lehtonen.json"));
    const out = await linkDraftPick(pick, { ...deps, search: async () => lehtonen }, 3);
    expect(out).toEqual({ status: "unresolved", reason: "no candidate's landing page reported this draft year and pick", candidatesChecked: 3 });
    expect(checked).toEqual(["8482247", "8469714", "8471747"]);
  });
});

describe("parseRankings", () => {
  it("parses real Central Scouting rows with birth dates and both ranks", () => {
    const rows = parseRankings(load("draft-rankings-2025-1.json"), 2025, 1);
    expect(rows).toHaveLength(26);
    expect(rows[0]).toEqual({
      draftYear: 2025,
      category: 1,
      firstName: "Matthew",
      lastName: "Schaefer",
      birthDate: rows[0]!.birthDate,
      finalRank: 1,
      midtermRank: 1,
    });
    expect(rows[0]!.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Rows without a midterm rank (added to the final list) keep null.
    expect(rows.filter((r) => r.midtermRank === null)).toHaveLength(6);
  });

  it("rejects a row without a birth date (it could not be linked safely)", () => {
    const json = load("draft-rankings-2025-1.json");
    delete json.rankings[3].birthDate;
    expect(() => parseRankings(json, 2025, 1)).toThrow(/row 3 .* birth date/);
  });
});

describe("linkRankedPlayer", () => {
  const ref = (birthDate: string): RankedPlayerRef => ({
    draftYear: 2012,
    category: 2,
    firstName: "Mikko",
    lastName: "Lehtonen",
    birthDate,
    finalRank: 50,
    midtermRank: null,
  });

  it("picks the Mikko Lehtonen with the same birth date", async () => {
    const { deps, checked } = recordedDeps();
    const out = await linkRankedPlayer(ref("1994-01-16"), deps);
    expect(out).toMatchObject({ status: "linked", playerId: "8482247", via: "full_name" });
    expect(checked).toEqual(["8482247"]);
    const older = await linkRankedPlayer(ref("1987-04-01"), recordedDeps().deps);
    expect(older).toMatchObject({ status: "linked", playerId: "8471747" });
  });

  it("does not link a same-name player born on another day", async () => {
    const { deps, checked } = recordedDeps();
    const lehtonen = parseSearchResults(load("search-mikko_lehtonen.json"));
    const out = await linkRankedPlayer(ref("1995-01-01"), { ...deps, search: async () => lehtonen }, 3);
    expect(out).toEqual({ status: "unresolved", reason: "no candidate's landing page reported this birth date", candidatesChecked: 3 });
    expect(checked).toEqual(["8482247", "8469714", "8471747"]);
    expect(landingMatchesBirthDate(load("landing-draft-8482247.json"), "1994-01-16")).toBe(true);
  });

  it("does not open unrelated players' pages when the index returns other names", async () => {
    const { deps, checked } = recordedDeps();
    const others = parseSearchResults(load("search-mikko_lehtonen.json")).filter((c) => c.name !== "Mikko Lehtonen");
    const out = await linkRankedPlayer({ ...ref("1997-01-13"), firstName: "Nick", lastName: "Azar" }, { ...deps, search: async () => others });
    expect(out.status).toBe("unresolved");
    expect(checked).toEqual([]);
    expect(nameSimilarity("vyacheslav voynov", "vyacheslav voinov")).toBeGreaterThan(0.9);
    expect(nameSimilarity("nick azar", "nick deschenes")).toBeLessThan(0.7);
  });

  it("reports a player the index does not know (never drafted or signed) as unresolved", async () => {
    const out = await linkRankedPlayer({ ...ref("1997-01-13"), firstName: "Nick", lastName: "Azar" }, { search: async () => [], landing: async () => null });
    expect(out).toEqual({ status: "unresolved", reason: "no search candidates", candidatesChecked: 0 });
  });
});

describe("name helpers", () => {
  it("normalises accents and punctuation", () => {
    expect(normalizeName("Lavallée-Smotherman, Jordan")).toBe("lavallee smotherman jordan");
  });

  it("ranks exact full-name matches first", () => {
    const ranked = rankCandidates({ firstName: "Mikko", lastName: "Lehtonen" }, parseSearchResults(load("search-mikko_lehtonen.json")));
    expect(ranked.slice(0, 3).map((c) => c.name)).toEqual(["Mikko Lehtonen", "Mikko Lehtonen", "Mikko Lehtonen"]);
  });
});
