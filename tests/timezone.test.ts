import { describe, expect, it } from "vitest";
import { isValidTimeZone, resolveTimeZone, zoneName } from "@/lib/timezone";
import { readPreferences } from "@/lib/preferences";

describe("time zones", () => {
  it("automatic is the default and follows the device; pinned zones win", () => {
    expect(readPreferences({}).timeZone).toBe("auto");
    expect(resolveTimeZone("auto", "Europe/Helsinki")).toBe("Europe/Helsinki");
    expect(resolveTimeZone("auto", "America/Edmonton")).toBe("America/Edmonton");
    expect(resolveTimeZone("America/Chicago", "Europe/Helsinki")).toBe("America/Chicago");
  });

  it("never trusts a bad cookie: unknown or hostile values fall back to Eastern", () => {
    expect(resolveTimeZone("auto", null)).toBe("America/New_York");
    expect(resolveTimeZone("auto", "Mars/Olympus_Mons")).toBe("America/New_York");
    expect(isValidTimeZone("<script>")).toBe(false);
    expect(isValidTimeZone("x".repeat(80))).toBe(false);
  });

  it("names the zone for labels", () => {
    expect(zoneName("America/Chicago", new Date("2026-10-10T00:00:00Z"))).toBe("Central Daylight Time");
    expect(zoneName("America/Chicago", new Date("2027-01-10T00:00:00Z"))).toBe("Central Standard Time");
  });
});
