/**
 * RosterIQ plans and prices (USD). Plans belong to an organization; seats
 * are its members. Yearly prices are about ten months of the monthly price
 * (Pro $99 = 17.4% off twelve months; Club $490 = 16.7% off).
 *
 * Positioning (checked September 2026): Evolving-Hockey $4.99/mo or
 * $53.99/yr; HockeyViz US$7 or $14/mo; EliteProspects Premium $11.99/mo or
 * $119.88/yr. Pro sits just under EP Premium with models none of them sell;
 * Club is priced for a scouting staff, far below team platforms.
 */

export type PlanId = "free" | "pro" | "club";
export type Interval = "month" | "year";

export type Feature =
  | "scores_standings"
  | "game_states"
  | "player_pages"
  | "xg_models"
  | "prospect_model"
  | "exports"
  | "cap_tools"
  | "scouting_workspace"
  | "team_roles";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Cents; 0 for free. */
  monthly: number;
  yearly: number;
  seats: number;
  /** Price per extra member per month, in cents (Club only). */
  extraSeatMonthly: number | null;
  features: Feature[];
  highlights: string[];
}

const FREE_FEATURES: Feature[] = ["scores_standings", "game_states", "player_pages"];
const PRO_FEATURES: Feature[] = [...FREE_FEATURES, "xg_models", "prospect_model", "exports"];
const CLUB_FEATURES: Feature[] = [...PRO_FEATURES, "cap_tools", "scouting_workspace", "team_roles"];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Follow the league",
    monthly: 0,
    yearly: 0,
    seats: 1,
    extraSeatMonthly: null,
    features: FREE_FEATURES,
    highlights: ["Live scores and standings", "Special teams & game states (official numbers)", "Player pages and league stats"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For the analyst",
    monthly: 999,
    yearly: 9900,
    seats: 1,
    extraSeatMonthly: null,
    features: PRO_FEATURES,
    highlights: [
      "Everything in Free",
      "RosterIQ expected goals: players, goalies, teams, PP and PK",
      "Prospect model: NHL-regular and top-of-lineup odds for every draft-eligible",
      "League equivalencies (NHLe) and CSV exports",
    ],
  },
  club: {
    id: "club",
    name: "Club",
    tagline: "For a front office or scouting staff",
    monthly: 4900,
    yearly: 49000,
    seats: 5,
    extraSeatMonthly: 900,
    features: CLUB_FEATURES,
    highlights: [
      "Everything in Pro, for 5 people",
      "Cap planning, scenarios and contract tools",
      "Scouting workspace: reports, lists, boards, assignments",
      "Roles and invite links for your staff; $9/month per extra person",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "club"];

export function price(plan: PlanId, interval: Interval): number {
  return interval === "year" ? PLANS[plan].yearly : PLANS[plan].monthly;
}

/** Yearly saving vs twelve monthly payments, as a fraction. */
export function yearlySaving(plan: PlanId): number {
  const p = PLANS[plan];
  return p.monthly === 0 ? 0 : 1 - p.yearly / (p.monthly * 12);
}

export function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function planHas(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}
