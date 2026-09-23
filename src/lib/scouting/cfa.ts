/**
 * College free-agent relationship pipeline stages. Shared by server pages,
 * client forms, and server actions — kept out of "use client" modules so
 * server components receive the real array rather than a client reference.
 */
export const CFA_RELATIONSHIP_STATUSES = [
  "not_contacted",
  "researching",
  "initial_contact",
  "active_communication",
  "strong_interest",
  "mutual_interest",
  "offer_under_consideration",
  "signed_elsewhere",
  "signed_by_organization",
  "no_longer_pursuing",
] as const;

export type CfaRelationshipStatus = (typeof CFA_RELATIONSHIP_STATUSES)[number];
