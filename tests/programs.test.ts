import { describe, expect, it } from "vitest";
import { NAV } from "@/components/shell/nav";
import { PROGRAMS, PROGRAM_IDS, hiddenSections } from "@/lib/programs";

describe("programs", () => {
  const ids = new Set(NAV.map((s) => s.id));

  it("every hidden section is a real navigation section (a rename cannot silently un-hide it)", () => {
    for (const p of PROGRAM_IDS) for (const h of PROGRAMS[p].hidden) expect(ids.has(h)).toBe(true);
  });

  it("pro shows everything; college, junior and youth never show game predictions; youth has no chat or agents", () => {
    expect(hiddenSections("pro").size).toBe(0);
    for (const p of ["junior", "college", "youth"]) expect(hiddenSections(p).has("predictions")).toBe(true);
    expect(hiddenSections("youth").has("chat")).toBe(true);
    expect(hiddenSections("youth").has("agents")).toBe(true);
    expect(hiddenSections("nonsense").size).toBe(0);
  });
});
