/** Display formatting helpers (no calculation logic lives here). */

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US")}`;
}

/** Compact money for tiles/axes: $88.0M, $825K. */
export function moneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs}`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export const POSITIONS = ["C", "LW", "RW", "D", "G"] as const;

export function positionLabel(pos: string): string {
  const map: Record<string, string> = {
    C: "Center",
    LW: "Left wing",
    RW: "Right wing",
    D: "Defense",
    G: "Goaltender",
  };
  return map[pos] ?? pos;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pro_active: "Active roster",
    pro_scratch: "Scratch",
    injured_reserve: "Injured reserve",
    ltir: "LTIR",
    minor: "Minors",
    juniors: "Juniors",
    loaned: "Loaned",
    suspended: "Suspended",
    unsigned: "Unsigned",
    non_roster: "Non-roster",
    under_contract: "Under contract",
    rfa: "RFA",
    ufa: "UFA",
    unsigned_prospect: "Unsigned prospect",
  };
  return map[status] ?? status.replace(/_/g, " ");
}
