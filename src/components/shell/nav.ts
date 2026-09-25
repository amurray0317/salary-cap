/**
 * Primary navigation: categories grouped under six areas (super-sections),
 * each category with optional sub-groups. Items without an href are planned
 * and shown disabled, with the reason as a tooltip, so the whole layout is
 * visible before every page exists. Every href appears once (tested), so
 * the active page belongs to exactly one category.
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

export const AREAS = ["Hockey ops", "Scouting & draft", "Analytics", "Player care", "Management", "Me & data"] as const;
export type Area = (typeof AREAS)[number];

export interface NavSection {
  id: string;
  label: string;
  icon: string;
  area: Area;
  groups: NavGroup[];
}

const MANUAL = "Planned: staff-entered data (no public source).";
const LATER_LEAGUES = "Planned: as league data sources are connected.";

export const NAV: NavSection[] = [
  /* ------------------------------------------------------------ Hockey ops */
  {
    id: "leagues",
    label: "Leagues",
    icon: "◎",
    area: "Hockey ops",
    groups: [
      {
        items: [
          {
            label: "League directory",
            planned: "Planned: every league we track, with standings, stats, teams and how complete our data is (see LEAGUE_COVERAGE).",
          },
          { label: "Junior & minor pro (HockeyTech)", planned: "Planned: OHL, WHL, QMJHL, USHL, AHL, ECHL pages; data connector built." },
        ],
      },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    icon: "⌂",
    area: "Hockey ops",
    groups: [
      {
        items: [
          { label: "NHL team stats", href: "/real-data/teams" },
          { label: "Team hubs", planned: "Planned: per team roster, depth chart, lines (from shift data), cap sheet, schedule, results, xG trend." },
          { label: "Other leagues' teams", planned: LATER_LEAGUES },
        ],
      },
    ],
  },
  {
    id: "games",
    label: "Games",
    icon: "◷",
    area: "Hockey ops",
    groups: [
      {
        items: [
          { label: "Scores (live)", href: "/scores" },
          { label: "Game center", planned: "Planned: box score, shot map, xG timeline, goal by goal (NHL play-by-play)." },
          { label: "Other leagues' scores", planned: LATER_LEAGUES },
        ],
      },
    ],
  },
  {
    id: "tactics",
    label: "Tactics & situations",
    icon: "⌖",
    area: "Hockey ops",
    groups: [
      {
        items: [
          { label: "Special teams & game states", href: "/games/situations" },
          {
            label: "Team systems (video tagging)",
            planned:
              "Planned: tag forecheck (1-2-2, 2-1-2, 1-3-1), neutral-zone, D-zone coverage, breakouts, PP and PK formations per game from video. Public data has no player tracking, so structures are tagged by staff, not inferred.",
          },
          {
            label: "Forecheck & transition",
            planned:
              "Planned: rush vs. cycle chances, forecheck turnovers and rebound chances from play-by-play timing and location, with RosterIQ xG.",
          },
          { label: "Special-teams units", planned: "Planned: player PP/PK time, points and on-ice xG per 60; shootout shooters and goalies." },
        ],
      },
    ],
  },
  {
    id: "standings",
    label: "Standings",
    icon: "≡",
    area: "Hockey ops",
    groups: [
      {
        items: [
          { label: "NHL standings", href: "/standings" },
          { label: "Other leagues", planned: LATER_LEAGUES },
        ],
      },
    ],
  },
  {
    id: "pro-scouting",
    label: "Pro scouting",
    icon: "⌖",
    area: "Hockey ops",
    groups: [
      {
        items: [
          { label: "Opponent pre-scouts", planned: "Planned: next opponent's lines, special teams and xG trends (NHL data)." },
          { label: "Pro player reports", planned: MANUAL },
          { label: "Trade targets", planned: "Planned: a list with cap fit and value, feeding the trade analyzer." },
          { label: "Waiver watch", planned: "Planned: players likely on waivers, with fit and cap impact." },
        ],
      },
    ],
  },

  /* ------------------------------------------------------ Scouting & draft */
  {
    id: "development",
    label: "Development",
    icon: "▲",
    area: "Scouting & draft",
    groups: [
      {
        label: "Development",
        items: [{ label: "Development reports", planned: MANUAL }],
      },
      {
        label: "Prospects",
        items: [
          {
            label: "In-season prospect tracker",
            planned: "Planned: every drafted or ranked prospect's season, updated daily, with P(regular) re-scored.",
          },
          { label: "Scouting reports", href: "/scouting/reports" },
          { label: "Prospect fit", href: "/scouting/fit" },
          { label: "Viewing planner", planned: "Planned: which tracked prospects play where tonight and this week, grouped by city." },
          { label: "Prospect comparables", planned: "Planned: most similar draft-year profiles and what became of them." },
          { label: "WAR components", planned: "Planned: no public WAR exists for junior or European players." },
          { label: "Prospect traits", planned: MANUAL },
        ],
      },
      {
        label: "Dev / coaching tools",
        items: [
          { label: "Drill library", planned: MANUAL },
          { label: "Development video", planned: "Planned: development clips, in the Video library." },
        ],
      },
    ],
  },
  {
    id: "draft",
    label: "Draft",
    icon: "✚",
    area: "Scouting & draft",
    groups: [
      {
        items: [
          { label: "Prospect model rankings", href: "/real-data/prospects" },
          { label: "Draft boards", href: "/scouting/board" },
          { label: "Draft history", href: "/real-data/draft" },
          { label: "Mock drafts", planned: "Planned: simulate the draft with the model, Central Scouting and team needs." },
          { label: "War room", planned: "Planned for June 2027: live board, picks crossed off, best available with reasons." },
          { label: "Re-drafts & class reviews", planned: "Planned: past drafts re-ordered by outcomes vs how our model ranked them." },
        ],
      },
    ],
  },
  {
    id: "video",
    label: "Video",
    icon: "▶",
    area: "Scouting & draft",
    groups: [
      {
        items: [
          { label: "Clip library", planned: "Planned: clips by player, game and tag (links to YouTube, Vimeo or Drive; no uploads)." },
          { label: "Tagging & playlists", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "womens",
    label: "Women's hockey",
    icon: "♀",
    area: "Scouting & draft",
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

  /* ------------------------------------------------------------- Analytics */
  {
    id: "lab",
    label: "Analytics lab",
    icon: "⚗",
    area: "Analytics",
    groups: [
      {
        items: [
          { label: "Model cards", href: "/real-data/models" },
          { label: "Scouting model center", href: "/scouting/models" },
          { label: "xG explorer & shot maps", planned: "Planned: every shot with its xG and breakdown, by player, team, goalie." },
          { label: "On-ice impact", planned: "Planned: shift data + xG: on-ice xGF/xGA per 60, lines, with-or-without-you." },
          { label: "Research notes", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "player-stats",
    label: "Player stats",
    icon: "▤",
    area: "Analytics",
    groups: [
      {
        items: [
          { label: "Our players", href: "/players" },
          { label: "NHL players", href: "/real-data/players" },
          { label: "NCAA players", href: "/scouting/players" },
          { label: "League leaders", planned: "Planned: leaders by league and category (points, xG, rates), all connected leagues." },
          { label: "Player comparison", planned: "Planned: 2–4 players side by side (stats, xG, model breakdowns, contracts)." },
          { label: "Other leagues' players", planned: LATER_LEAGUES },
        ],
      },
    ],
  },
  {
    id: "predictions",
    label: "Game predictions",
    icon: "%",
    area: "Analytics",
    groups: [
      {
        items: [
          {
            label: "Win probability, puck line, totals",
            planned: "Planned: from a team goal model on our xG; shown only after out-of-sample validation.",
          },
          { label: "Model track record", planned: "Planned: calibration and log loss of every past prediction." },
        ],
      },
    ],
  },
  {
    id: "officials",
    label: "Officials",
    icon: "⚑",
    area: "Analytics",
    groups: [
      {
        items: [
          {
            label: "Referee tendencies",
            planned: "Planned: penalties per game, power-play rates, home/away splits (NHL game data; source to verify).",
          },
          { label: "Linesmen", planned: "Planned: offsides and faceoff violations where the data allows." },
        ],
      },
    ],
  },
  {
    id: "history",
    label: "History & records",
    icon: "⌛",
    area: "Analytics",
    groups: [
      {
        items: [
          { label: "Franchise history", planned: "Planned: season-by-season archives (NHL data)." },
          { label: "Records & awards", planned: "Planned: league and franchise records, award winners." },
        ],
      },
    ],
  },

  /* ----------------------------------------------------------- Player care */
  {
    id: "performance",
    label: "Performance",
    icon: "⚡",
    area: "Player care",
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
      { label: "Amateur", items: [{ label: "Amateur player tracking", planned: MANUAL }] },
    ],
  },
  {
    id: "medical",
    label: "Injuries & medical",
    icon: "✙",
    area: "Player care",
    groups: [
      {
        items: [
          { label: "Injury log", planned: "Planned: staff-entered (the NHL publishes no free injury feed); private to you." },
          { label: "Return-to-play timelines", planned: MANUAL },
          { label: "Games missed & cap (IR/LTIR)", planned: "Planned: linked to the cap tools." },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------ Management */
  {
    id: "cap",
    label: "Cap & contracts",
    icon: "$",
    area: "Management",
    groups: [
      {
        items: [
          { label: "Cap dashboard", href: "/dashboard" },
          { label: "Contracts", href: "/contracts" },
          { label: "Scenarios", href: "/scenarios" },
          { label: "Player valuation", href: "/valuation" },
          { label: "Trade analyzer", planned: "Planned (before the trade deadline): cap impact and value on both sides." },
          { label: "Contract value model", planned: "Planned: projected AAV and term for upcoming UFAs/RFAs." },
          { label: "Arbitration comparables", planned: "Planned: comparable contracts for RFA arbitration cases." },
        ],
      },
    ],
  },
  {
    id: "league",
    label: "League",
    icon: "§",
    area: "Management",
    groups: [
      {
        items: [
          { label: "Overview", planned: "Planned: league-wide summary (standings, cap space, recent moves)." },
          { label: "Free agents", href: "/scouting/free-agents" },
          { label: "Transactions", href: "/transactions" },
          { label: "League rules", href: "/rules" },
        ],
      },
    ],
  },
  {
    id: "front-office",
    label: "GMs & AGMs",
    icon: "◆",
    area: "Management",
    groups: [
      {
        items: [
          {
            label: "GM / AGM directory & careers",
            planned: "Planned: general managers and assistant GMs from league rosters; NHL front offices source to verify.",
          },
          { label: "Draft & trade track records", planned: "Planned: draft value vs pick expectation, trade and signing outcomes, cap efficiency." },
          { label: "Executive hiring pipeline", planned: "Planned: rising AGMs and GMs across leagues." },
          { label: "Front-office notes", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "coaches",
    label: "Coaches",
    icon: "✦",
    area: "Management",
    groups: [
      {
        items: [
          {
            label: "Coach directory & careers",
            planned:
              "Planned: head/assistant coaches from league rosters (CHL, USHL, AHL, ECHL back to the early 2000s); NHL staff source to verify.",
          },
          {
            label: "Coaching track records",
            planned: "Planned: results, goal and xG share vs expected, special teams, player development under each coach.",
          },
          { label: "Coaching hiring pipeline", planned: "Planned: rising coaches in the AHL, CHL, USHL and NCAA." },
          { label: "Coaching notes", planned: MANUAL },
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "Agents & negotiations",
    icon: "✎",
    area: "Management",
    groups: [
      {
        items: [
          { label: "Agent directory", planned: "Planned: who represents whom (staff-entered; no free source)." },
          { label: "Negotiation log", planned: MANUAL },
          { label: "Comparable contracts", planned: "Planned: from the contract data and the contract value model." },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------- Me & data */
  {
    id: "feed",
    label: "Feed",
    icon: "☷",
    area: "Me & data",
    groups: [
      {
        items: [
          { label: "My feed", planned: "Planned: prospect breakouts, new Central Scouting lists, standings moves, alerts, in one stream." },
          { label: "News & notes", planned: "Planned: NHL transactions (source to verify) and our own research write-ups." },
        ],
      },
    ],
  },
  {
    id: "calendar",
    label: "Calendar & key dates",
    icon: "▦",
    area: "Me & data",
    groups: [
      {
        items: [
          { label: "Key dates", planned: "Planned: trade deadline, free agency, RFA/UFA dates, draft and combine, Central Scouting releases." },
          { label: "My calendar", planned: MANUAL },
          { label: "Prospect calendar", planned: "Planned: tracked prospects' games (all connected leagues)." },
        ],
      },
    ],
  },
  {
    id: "tools",
    label: "Tools & data",
    icon: "☰",
    area: "Me & data",
    groups: [
      {
        label: "Lists & tools",
        items: [
          { label: "Scouting dashboard", href: "/scouting" },
          { label: "Watchlists", href: "/scouting/watchlists" },
          { label: "Smart lists", planned: "Planned: saved searches that refresh themselves (e.g. OHL D, draft year, > 1.0 P/GP)." },
          { label: "Scouting assignments", href: "/scouting/assignments" },
          { label: "Organizational needs", href: "/scouting/needs" },
          { label: "Role finder", href: "/scouting/roles" },
          { label: "Reports", href: "/reports" },
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
    area: "Me & data",
    groups: [{ items: [{ label: "Team chat", planned: "Planned: messages between staff, stored in the app." }] }],
  },
  {
    id: "profile",
    label: "Profile",
    icon: "◉",
    area: "Me & data",
    groups: [
      {
        items: [
          { label: "My profile", href: "/profile" },
          { label: "Account & security", href: "/profile/account" },
          { label: "Notifications", href: "/profile/notifications" },
          { label: "Preferences", href: "/profile/preferences" },
          { label: "Organization settings", href: "/settings" },
          { label: "Plan & billing", href: "/settings/billing" },
        ],
      },
    ],
  },
];

/** The item whose href is the longest prefix of the current path. */
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
