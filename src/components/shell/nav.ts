/**
 * Primary navigation: eight sections, each with optional sub-groups.
 * Items without an href are planned and shown disabled, so the layout the
 * staff asked for is visible before every page exists.
 */
export interface NavItem {
  label: string;
  href?: string;
  /** Why it is not built yet (shown as a tooltip on planned items). */
  planned?: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  groups: NavGroup[];
}

const MANUAL = "Planned: staff-entered data (no public source).";

export const NAV: NavSection[] = [
  {
    id: "development",
    label: "Development",
    icon: "▲",
    groups: [
      {
        label: "Development",
        items: [
          { label: "Development reports", planned: MANUAL },
          { label: "My calendar", planned: MANUAL },
        ],
      },
      {
        label: "Prospects",
        items: [
          { label: "Prospect model", href: "/real-data/prospects" },
          { label: "Draft boards", href: "/scouting/board" },
          { label: "Scouting reports", href: "/scouting/reports" },
          { label: "Prospect fit", href: "/scouting/fit" },
          { label: "Viewing planner", planned: "Planned: which tracked prospects play where tonight and this week, grouped by city." },
          { label: "Re-drafts & class reviews", planned: "Planned: past drafts re-ordered by outcomes vs how our model ranked them." },
          { label: "Prospect calendar", planned: MANUAL },
          { label: "WAR components", planned: "Planned: no public WAR exists for junior or European players." },
          { label: "Prospect traits", planned: MANUAL },
        ],
      },
      {
        label: "Dev / coaching tools",
        items: [
          { label: "Drill library", planned: MANUAL },
          { label: "Development video", planned: "Planned: video links (YouTube, Vimeo, Drive)." },
        ],
      },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: "⚡",
    groups: [
      {
        label: "Pro",
        items: [
          { label: "Player tracking", planned: "Planned: NHL EDGE skating and shot data (free)." },
          { label: "Workout designer", planned: MANUAL },
          { label: "Workout programs", planned: MANUAL },
          { label: "Daily console", planned: MANUAL },
        ],
      },
      { label: "Amateur", items: [{ label: "Player tracking", planned: MANUAL }] },
    ],
  },
  {
    id: "league",
    label: "League",
    icon: "§",
    groups: [
      {
        items: [
          { label: "Overview", planned: "Planned: league-wide summary (standings, cap space, recent moves)." },
          { label: "Free agents", href: "/scouting/free-agents" },
          { label: "Cap by team", href: "/dashboard" },
          { label: "Contracts", href: "/contracts" },
          { label: "Transactions", href: "/transactions" },
          { label: "Injuries", planned: "Planned: the NHL publishes no free injury feed; staff-entered." },
          { label: "League rules", href: "/rules" },
        ],
      },
    ],
  },
  {
    id: "standings",
    label: "Standings",
    icon: "≡",
    groups: [{ items: [{ label: "NHL standings", href: "/standings" }, { label: "Other leagues", planned: "Planned: as league data sources are connected." }] }],
  },
  {
    id: "scores",
    label: "Scores",
    icon: "◷",
    groups: [{ items: [{ label: "NHL scores (live)", href: "/scores" }, { label: "Other leagues", planned: "Planned: as league data sources are connected." }] }],
  },
  {
    id: "player-stats",
    label: "Player stats",
    icon: "▤",
    groups: [
      {
        items: [
          { label: "Our players", href: "/players" },
          { label: "NHL players", href: "/real-data/players" },
          { label: "NHL teams", href: "/real-data/teams" },
          { label: "NHL draft", href: "/real-data/draft" },
          { label: "NCAA players", href: "/scouting/players" },
        ],
      },
    ],
  },
  {
    id: "coaches",
    label: "Coaches",
    icon: "✦",
    groups: [
      {
        items: [
          { label: "Coach directory & careers", planned: "Planned: head/assistant coaches from league rosters (CHL, USHL, AHL, ECHL back to the early 2000s); NHL staff source to verify." },
          { label: "Coaching track records", planned: "Planned: results, goal and xG share vs expected, special teams, player development under each coach." },
          { label: "Coaching hiring pipeline", planned: "Planned: rising coaches in the AHL, CHL, USHL and NCAA." },
          { label: "Private notes", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "front-office",
    label: "GMs & AGMs",
    icon: "◆",
    groups: [
      {
        items: [
          { label: "GM / AGM directory & careers", planned: "Planned: general managers and assistant GMs from league rosters; NHL front offices source to verify." },
          { label: "Draft & trade track records", planned: "Planned: draft value vs pick expectation, trade and signing outcomes, cap efficiency." },
          { label: "Executive hiring pipeline", planned: "Planned: rising AGMs and GMs across leagues." },
          { label: "Private notes", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "womens",
    label: "Women's hockey",
    icon: "♀",
    groups: [
      {
        items: [
          { label: "PWHL", planned: "Planned: standings, scores, player stats (stats platform to verify)." },
          { label: "NCAA women's", planned: "Planned: rosters and stats (source to verify)." },
          { label: "International (IIHF)", planned: "Planned: Olympics, Worlds, U18 Worlds (source to verify)." },
          { label: "Women's analytics", planned: "Planned: xG, prospect model and comparables once enough data is connected." },
        ],
      },
    ],
  },
  {
    id: "lists-tools",
    label: "Lists & tools",
    icon: "☰",
    groups: [
      {
        label: "Lists",
        items: [
          { label: "Watchlists", href: "/scouting/watchlists" },
          { label: "Scouting assignments", href: "/scouting/assignments" },
          { label: "Organizational needs", href: "/scouting/needs" },
        ],
      },
      {
        label: "Tools",
        items: [
          { label: "Scouting dashboard", href: "/scouting" },
          { label: "Scenarios", href: "/scenarios" },
          { label: "Player valuation", href: "/valuation" },
          { label: "Role finder", href: "/scouting/roles" },
          { label: "Reports", href: "/reports" },
          { label: "Model cards", href: "/real-data/models" },
          { label: "Scouting model center", href: "/scouting/models" },
        ],
      },
      {
        label: "Data",
        items: [
          { label: "Real data connectors", href: "/real-data" },
          { label: "Data imports", href: "/imports" },
          { label: "Data health", planned: "Planned: every source's last pull, row counts, failures and drift alarms." },
          { label: "Backups & exports", planned: "Planned: nightly database backups; exports of notes, boards and reports." },
        ],
      },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: "✉",
    groups: [{ items: [{ label: "Team chat", planned: "Planned: messages between staff, stored in the app." }] }],
  },
  {
    id: "profile",
    label: "Profile",
    icon: "◉",
    groups: [{ items: [{ label: "Profile & settings", href: "/settings" }] }],
  },
];

/** The section that owns a path: the item whose href is the longest prefix of it. */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const s of NAV) {
    for (const g of s.groups) {
      for (const i of g.items) {
        if (!i.href) continue;
        const hit = pathname === i.href || pathname.startsWith(i.href + "/");
        if (hit && (!best || i.href.length > best.length)) best = i.href;
      }
    }
  }
  return best;
}
