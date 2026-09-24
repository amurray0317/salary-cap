/**
 * Draft pick → NHL player id linking, on real recorded responses
 * (tests/fixtures/connectors/nhl, see manifest.json).
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  landingMatchesPick,
  linkDraftPick,
  normalizeName,
  parseDraftPickRefs,
  parseSearchResults,
  rankCandidates,
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

describe("name helpers", () => {
  it("normalises accents and punctuation", () => {
    expect(normalizeName("Lavallée-Smotherman, Jordan")).toBe("lavallee smotherman jordan");
  });

  it("ranks exact full-name matches first", () => {
    const ranked = rankCandidates({ firstName: "Mikko", lastName: "Lehtonen" }, parseSearchResults(load("search-mikko_lehtonen.json")));
    expect(ranked.slice(0, 3).map((c) => c.name)).toEqual(["Mikko Lehtonen", "Mikko Lehtonen", "Mikko Lehtonen"]);
  });
});
