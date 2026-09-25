/**
 * RosterIQ plans (USD). Two families:
 *
 *  - Individual plans, by role: Fan, Player, Coach, Scout, Manager. One
 *    person each; they belong to a personal organization.
 *  - Organization plans, by program level: Youth team, Junior club, College
 *    program, Pro club. Seats are the organization's members.
 *
 * Yearly = about ten months (two months free). Prices are a starting
 * hypothesis to validate with real users, anchored on what hockey analytics
 * subscriptions cost (checked September 2026): Evolving-Hockey $4.99/mo or
 * $53.99/yr, HockeyViz US$7 or $14/mo, EliteProspects Premium $11.99/mo or
 * $119.88/yr. Pro clubs buy with licensed data, SSO and a security review,
 * so that tier is quoted, not sold by card.
 */

export type PlanId = "free" | "fan" | "player" | "coach" | "scout" | "manager" | "youth_team" | "junior_club" | "college_program" | "pro_club";
export type Interval = "month" | "year";
export type PlanFamily = "individual" | "organization";

export type Feature =
  | "scores_standings"
  | "player_pages"
  | "game_states"
  | "xg_models"
  | "win_probabilities"
  | "prospect_model"
  | "exports"
  | "development_tracking"
  | "video_tools"
  | "coaching_tools"
  | "scouting_workspace"
  | "cap_tools"
  | "team_roles";

export const FEATURE_LABELS: Record<Feature, string> = {
  scores_standings: "Live scores and standings",
  player_pages: "Player pages and league stats",
  game_states: "Special teams & game states",
  xg_models: "RosterIQ expected goals (players, goalies, teams, PP/PK)",
  win_probabilities: "Pre-game win probabilities and win drivers",
  prospect_model: "Prospect model and league equivalencies",
  exports: "CSV exports",
  development_tracking: "Development tracking and goals",
  video_tools: "Video clips and tagging",
  coaching_tools: "Practice plans, drills, lineups and systems tagging",
  scouting_workspace: "Scouting reports, lists, boards, viewing planner",
  cap_tools: "Cap planning, contracts, scenarios, trades",
  team_roles: "Staff roles and invite links",
};

export interface Plan {
  id: PlanId;
  family: PlanFamily;
  name: string;
  tagline: string;
  /** Cents; 0 for free. Null = quoted (no card checkout). */
  monthly: number | null;
  yearly: number | null;
  seats: number;
  /** Price per extra member per month, in cents (organization plans). */
  extraSeatMonthly: number | null;
  features: Feature[];
  /** Shown under the price. */
  note?: string;
}

const BASE: Feature[] = ["scores_standings", "player_pages"];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    family: "individual",
    name: "Free",
    tagline: "Follow the league",
    monthly: 0,
    yearly: 0,
    seats: 1,
    extraSeatMonthly: null,
    features: BASE,
  },
  fan: {
    id: "fan",
    family: "individual",
    name: "Fan",
    tagline: "The numbers behind every game",
    monthly: 499,
    yearly: 4900,
    seats: 1,
    extraSeatMonthly: null,
    features: [...BASE, "game_states", "xg_models", "win_probabilities"],
  },
  player: {
    id: "player",
    family: "individual",
    name: "Player",
    tagline: "Your own development, tracked",
    monthly: 799,
    yearly: 7900,
    seats: 1,
    extraSeatMonthly: null,
    features: [...BASE, "game_states", "development_tracking", "video_tools"],
    note: "Under 18: a parent or guardian holds the account.",
  },
  coach: {
    id: "coach",
    family: "individual",
    name: "Coach",
    tagline: "Plan, teach and review",
    monthly: 1499,
    yearly: 14900,
    seats: 1,
    extraSeatMonthly: null,
    features: [...BASE, "game_states", "xg_models", "development_tracking", "video_tools", "coaching_tools"],
  },
  scout: {
    id: "scout",
    family: "individual",
    name: "Scout",
    tagline: "Every league, every prospect",
    monthly: 2499,
    yearly: 24900,
    seats: 1,
    extraSeatMonthly: null,
    features: [...BASE, "game_states", "xg_models", "prospect_model", "exports", "video_tools", "scouting_workspace"],
  },
  manager: {
    id: "manager",
    family: "individual",
    name: "Manager",
    tagline: "Build and run a roster",
    monthly: 3999,
    yearly: 39900,
    seats: 1,
    extraSeatMonthly: null,
    features: [...BASE, "game_states", "xg_models", "win_probabilities", "prospect_model", "exports", "scouting_workspace", "cap_tools"],
  },
  youth_team: {
    id: "youth_team",
    family: "organization",
    name: "Youth team",
    tagline: "U10 to U18 and prep",
    monthly: 2900,
    yearly: 29000,
    seats: 25,
    extraSeatMonthly: 100,
    features: [...BASE, "development_tracking", "video_tools", "coaching_tools", "team_roles"],
    note: "Coaches, players and parents. Built for minors: no predictions, no messaging without two adults.",
  },
  junior_club: {
    id: "junior_club",
    family: "organization",
    name: "Junior club",
    tagline: "CHL, USHL, BCHL and more",
    monthly: 14900,
    yearly: 149000,
    seats: 15,
    extraSeatMonthly: 900,
    features: [
      ...BASE,
      "game_states",
      "xg_models",
      "prospect_model",
      "exports",
      "development_tracking",
      "video_tools",
      "coaching_tools",
      "scouting_workspace",
      "team_roles",
    ],
  },
  college_program: {
    id: "college_program",
    family: "organization",
    name: "College program",
    tagline: "NCAA and U SPORTS",
    monthly: 19900,
    yearly: 199000,
    seats: 15,
    extraSeatMonthly: 900,
    features: [
      ...BASE,
      "game_states",
      "xg_models",
      "prospect_model",
      "exports",
      "development_tracking",
      "video_tools",
      "coaching_tools",
      "scouting_workspace",
      "team_roles",
    ],
    note: "Win probabilities stay off (NCAA sports-wagering rules).",
  },
  pro_club: {
    id: "pro_club",
    family: "organization",
    name: "Pro club",
    tagline: "NHL, AHL and European pro",
    monthly: null,
    yearly: null,
    seats: 50,
    extraSeatMonthly: null,
    features: Object.keys(FEATURE_LABELS) as Feature[],
    note: "Quoted: licensed data, single sign-on and a security review come with it.",
  },
};

export const INDIVIDUAL_PLANS: PlanId[] = ["free", "fan", "player", "coach", "scout", "manager"];
export const ORGANIZATION_PLANS: PlanId[] = ["youth_team", "junior_club", "college_program", "pro_club"];
/** Plans sold by card (Stripe Checkout). */
export const PURCHASABLE: PlanId[] = [...INDIVIDUAL_PLANS, ...ORGANIZATION_PLANS].filter((id) => id !== "free" && PLANS[id].monthly !== null);

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && v in PLANS;
}

/** Cents, or null for a quoted plan. */
export function price(plan: PlanId, interval: Interval): number | null {
  return interval === "year" ? PLANS[plan].yearly : PLANS[plan].monthly;
}

/** Yearly saving vs twelve monthly payments, as a fraction. */
export function yearlySaving(plan: PlanId): number {
  const p = PLANS[plan];
  return !p.monthly || p.yearly === null ? 0 : 1 - p.yearly / (p.monthly * 12);
}

export function formatCents(cents: number): string {
  const whole = cents % 100 === 0;
  const v = whole ? cents / 100 : cents / 100;
  return `$${whole ? v.toLocaleString("en-US") : v.toFixed(2)}`;
}

export function planHas(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}
