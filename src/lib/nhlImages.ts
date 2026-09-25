/**
 * NHL image URLs (assets.nhle.com, the CDN nhl.com uses). Logos and
 * headshots are NHL and club property: fine for personal and internal use,
 * but a commercial launch needs a license like the data does.
 */
const ASSETS = "https://assets.nhle.com";

/** Team logo SVG by tri-code; "dark" is the version drawn for dark backgrounds. */
export function teamLogoUrl(triCode: string, variant: "light" | "dark" = "light"): string | null {
  const t = triCode.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? `${ASSETS}/logos/nhl/svg/${t}_${variant}.svg` : null;
}

/** The player's most recent NHL headshot by NHL player id (7-8 digits). */
export function headshotUrl(nhlPlayerId: string | number | null | undefined): string | null {
  const id = String(nhlPlayerId ?? "");
  return /^\d{7,8}$/.test(id) ? `${ASSETS}/mugs/nhl/latest/${id}.png` : null;
}
