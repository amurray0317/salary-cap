/**
 * Role → capability mapping (pure, shared by server context and tests).
 * Tiers are cumulative: a higher tier includes every lower capability.
 */

export const ORG_ROLES = [
  "league_admin",
  "org_admin",
  "general_manager",
  "assistant_gm",
  "analyst",
  "cap_analyst",
  "scout",
  "coach",
  "finance_admin",
  "college_admin",
  "nil_admin",
  "compliance_officer",
  "agent",
  "consultant",
  "viewer",
  "scouting_director",
  "scouting_asst_director",
  "crossover_scout",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_TIER: Record<OrgRole, number> = {
  viewer: 0, // includes read-only executives
  coach: 1,
  scout: 1, // regional scout
  crossover_scout: 1,
  agent: 1,
  consultant: 1,
  compliance_officer: 2,
  finance_admin: 2,
  nil_admin: 2,
  college_admin: 2,
  analyst: 3,
  cap_analyst: 3,
  scouting_asst_director: 3,
  assistant_gm: 4,
  general_manager: 4,
  scouting_director: 4,
  org_admin: 5,
  league_admin: 5,
};

export type Capability =
  | "read"
  | "annotate"
  | "review"
  | "edit_data"
  | "manage_team"
  | "admin"
  // Amateur-scouting capabilities (same cumulative-tier model):
  | "view_scouting"
  | "export_scouting"
  | "create_scouting_reports"
  | "edit_prospects"
  | "manage_watchlists"
  | "manage_draft_boards"
  | "assign_scouts"
  | "manage_org_needs"
  | "run_fit_models"
  | "manage_scouting_models";

const CAPABILITY_MIN_TIER: Record<Capability, number> = {
  read: 0,
  annotate: 1,
  review: 2,
  edit_data: 3,
  manage_team: 4,
  admin: 5,
  view_scouting: 0, // read-only executives can view scouting
  export_scouting: 1,
  create_scouting_reports: 1, // regional/crossover scouts and up
  edit_prospects: 1,
  manage_watchlists: 1,
  manage_draft_boards: 3, // assistant director / analysts and up
  assign_scouts: 4, // director / GM
  manage_org_needs: 4,
  run_fit_models: 3, // analysts / assistant directors and up
  manage_scouting_models: 5,
};

export function roleHasCapability(role: OrgRole, capability: Capability): boolean {
  return ROLE_TIER[role] >= CAPABILITY_MIN_TIER[capability];
}
