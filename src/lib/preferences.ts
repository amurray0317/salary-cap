/**
 * Per-user preferences stored in users.preferences (jsonb). Every field has a
 * default, and unknown or invalid stored values fall back to it, so older
 * rows and hand-edited JSON never break a page.
 */
import { z } from "zod";

export const START_PAGES = [
  { value: "/dashboard", label: "Dashboard" },
  { value: "/scores", label: "Scores" },
  { value: "/standings", label: "Standings" },
  { value: "/real-data/prospects", label: "Prospects" },
  { value: "/players", label: "Players" },
] as const;

/**
 * Time zones offered for game times. "auto" (the default) follows the device
 * the person is using, so a scout in Helsinki and one in Calgary each see
 * local puck drops; the rest pin a zone (every NHL market plus the main
 * European hockey ones).
 */
export const TIME_ZONES = [
  { value: "auto", label: "Automatic — this device's time zone" },
  { value: "America/New_York", label: "Eastern (New York, Toronto, Montreal)" },
  { value: "America/Chicago", label: "Central (Chicago, Dallas, Winnipeg)" },
  { value: "America/Denver", label: "Mountain (Denver, Calgary, Edmonton)" },
  { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles, Seattle, Vancouver)" },
  { value: "America/Halifax", label: "Atlantic (Halifax)" },
  { value: "America/St_Johns", label: "Newfoundland" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "Europe/Stockholm", label: "Central Europe (Stockholm, Prague, Zurich)" },
  { value: "Europe/Helsinki", label: "Eastern Europe (Helsinki)" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "UTC", label: "UTC" },
] as const;

export const NOTIFICATION_TOPICS = [
  { key: "importReady", label: "Imports waiting for approval", hint: "A connector or nightly job staged data that needs your review." },
  { key: "dataHealth", label: "Data health problems", hint: "A nightly download failed or the xG drift check tripped." },
  { key: "watchlist", label: "Watchlist players", hint: "Injuries, transactions and standout games for players on your watchlists." },
  { key: "prospects", label: "Prospect milestones", hint: "Draft-list moves, big scoring runs and call-ups for tracked prospects." },
  { key: "members", label: "Team members", hint: "Someone accepts an invite or a role changes in your organization." },
  { key: "weeklyDigest", label: "Weekly digest", hint: "Monday summary of your organization's players, prospects and imports." },
] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]["key"];

const startPage = z.enum(START_PAGES.map((p) => p.value) as [string, ...string[]]);
const timeZone = z.enum(TIME_ZONES.map((t) => t.value) as [string, ...string[]]);

export const preferencesSchema = z.object({
  startPage: startPage.catch("/dashboard"),
  timeZone: timeZone.catch("auto"),
  units: z.enum(["imperial", "metric"]).catch("imperial"),
  density: z.enum(["compact", "comfortable"]).catch("compact"),
  notifications: z
    .object({
      importReady: z.boolean().catch(true),
      dataHealth: z.boolean().catch(true),
      watchlist: z.boolean().catch(true),
      prospects: z.boolean().catch(true),
      members: z.boolean().catch(true),
      weeklyDigest: z.boolean().catch(false),
    })
    .catch({ importReady: true, dataHealth: true, watchlist: true, prospects: true, members: true, weeklyDigest: false }),
});
export type Preferences = z.infer<typeof preferencesSchema>;

/** Stored JSON → complete preferences (defaults for anything missing or invalid). */
export function readPreferences(stored: unknown): Preferences {
  const obj = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const withNotifications = { notifications: {}, ...obj };
  return preferencesSchema.parse(withNotifications);
}

export type Units = Preferences["units"];

export function formatHeight(cm: number | null | undefined, units: Units): string {
  if (!cm) return "—";
  if (units === "metric") return `${cm} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

export function formatWeight(kg: number | null | undefined, units: Units): string {
  if (!kg) return "—";
  return units === "metric" ? `${kg} kg` : `${Math.round(kg * 2.20462)} lb`;
}
