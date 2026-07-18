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
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_TIER: Record<OrgRole, number> = {
  viewer: 0,
  coach: 1,
  scout: 1,
  agent: 1,
  consultant: 1,
  compliance_officer: 2,
  finance_admin: 2,
  nil_admin: 2,
  college_admin: 2,
  analyst: 3,
  cap_analyst: 3,
  assistant_gm: 4,
  general_manager: 4,
  org_admin: 5,
  league_admin: 5,
};

export type Capability = "read" | "annotate" | "review" | "edit_data" | "manage_team" | "admin";

const CAPABILITY_MIN_TIER: Record<Capability, number> = {
  read: 0,
  annotate: 1,
  review: 2,
  edit_data: 3,
  manage_team: 4,
  admin: 5,
};

export function roleHasCapability(role: OrgRole, capability: Capability): boolean {
  return ROLE_TIER[role] >= CAPABILITY_MIN_TIER[capability];
}
