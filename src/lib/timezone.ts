/**
 * Resolving the time zone a page should use. The browser reports its IANA
 * zone (Intl) into a cookie; the server trusts it only if Intl accepts it.
 */
export const TZ_COOKIE = "riq_tz";
export const FALLBACK_TIME_ZONE = "America/New_York";

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Preference "auto" → the device's zone (if valid) → Eastern; otherwise the pinned zone. */
export function resolveTimeZone(preference: string, deviceZone: string | null | undefined): string {
  if (preference !== "auto") return isValidTimeZone(preference) ? preference : FALLBACK_TIME_ZONE;
  return isValidTimeZone(deviceZone) ? deviceZone : FALLBACK_TIME_ZONE;
}

/** "Central Daylight Time"-style name for a zone at a moment, for labels. */
export function zoneName(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}
