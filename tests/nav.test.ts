/**
 * Navigation integrity: every link points at a real page, no page is listed
 * twice (so the active item belongs to one category), areas are contiguous,
 * and every planned item says why it is not built yet.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AREAS, NAV, activeHref } from "@/components/shell/nav";

const items = NAV.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => ({ section: s.id, ...i }))));

describe("primary navigation", () => {
  it("links only to pages that exist", () => {
    for (const i of items.filter((x) => x.href)) {
      const page = path.join(process.cwd(), "src", "app", "(app)", i.href!, "page.tsx");
      expect(fs.existsSync(page), `${i.label} → ${i.href}`).toBe(true);
    }
  });

  it("lists each page once", () => {
    const hrefs = items.filter((x) => x.href).map((x) => x.href!);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("keeps each area's categories together, in the declared order", () => {
    const order = NAV.map((s) => s.area).filter((a, i, all) => i === 0 || all[i - 1] !== a);
    expect(order).toEqual([...AREAS]);
  });

  it("explains every planned item", () => {
    for (const i of items.filter((x) => !x.href)) expect(i.planned, i.label).toMatch(/^Planned/);
  });

  it("marks the deepest matching page as active", () => {
    expect(activeHref("/scouting/board/abc")).toBe("/scouting/board");
    expect(activeHref("/scouting")).toBe("/scouting");
    expect(activeHref("/real-data/players/8478402")).toBe("/real-data/players");
    expect(activeHref("/nowhere")).toBeNull();
  });
});
