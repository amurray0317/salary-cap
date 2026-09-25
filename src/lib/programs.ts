/**
 * The kind of hockey program an organization runs. It decides which parts
 * of RosterIQ are shown (navigation, defaults), not who may see what; access
 * is still decided by roles.
 */
export const PROGRAMS = {
  pro: {
    label: "Pro club",
    blurb: "NHL, AHL, ECHL and European pro: cap and contracts, pro and amateur scouting, analytics.",
    hidden: [] as string[],
  },
  junior: {
    label: "Junior club",
    blurb: "CHL, USHL, BCHL and other junior leagues: player development, recruiting and league drafts, NHL draft exposure.",
    hidden: ["cap", "agents", "pro-scouting", "predictions"],
  },
  college: {
    label: "College program",
    blurb:
      "NCAA and U SPORTS: recruiting, development and team analytics. Game predictions stay off: NCAA rules bar athletics staff and athletes from sports wagering.",
    hidden: ["cap", "agents", "pro-scouting", "predictions"],
  },
  youth: {
    label: "Youth / minor hockey",
    blurb:
      "U10 to U18 and prep: development, practice planning and video. Built for minors: no predictions, no agent tools, and staff chat off until safeguarding controls (two-adult messaging) are in place.",
    hidden: ["cap", "agents", "pro-scouting", "predictions", "front-office", "officials", "chat", "draft"],
  },
} as const;

export type Program = keyof typeof PROGRAMS;
export const PROGRAM_IDS = Object.keys(PROGRAMS) as Program[];

export function isProgram(v: unknown): v is Program {
  return typeof v === "string" && v in PROGRAMS;
}

export function hiddenSections(program: string | null | undefined): Set<string> {
  return new Set(isProgram(program) ? PROGRAMS[program].hidden : []);
}
