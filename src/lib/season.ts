/**
 * Which hockey season "now" belongs to. The NHL league year (and the cap
 * year) starts July 1, so from July onward the upcoming season is current:
 * on 2026-09-25 that is 2026-27, before its games have started.
 */
export function seasonStartYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** "2026-27" for a season starting in 2026. */
export function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** NHL API season id, e.g. "20262027". */
export function nhlSeasonId(startYear: number): string {
  return `${startYear}${startYear + 1}`;
}

/** The current season's label, e.g. "2026-27". */
export function currentSeasonLabel(now: Date = new Date()): string {
  return seasonLabel(seasonStartYear(now));
}

/** The season named for today if the list has it, else the one flagged current, else the first. */
export function pickCurrentSeason<T extends { name: string; isCurrent: boolean }>(seasons: T[], now: Date = new Date()): T | undefined {
  const label = currentSeasonLabel(now);
  return seasons.find((s) => s.name === label) ?? seasons.find((s) => s.isCurrent) ?? seasons[0];
}
