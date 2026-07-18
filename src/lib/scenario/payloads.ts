/**
 * Typed payloads for scenario transactions. Every scenario_transactions.payload
 * blob is validated against one of these schemas before it reaches the
 * projector, so malformed rows can never corrupt a projection.
 */
import { z } from "zod";

export const proposedSeasonSchema = z.object({
  seasonName: z.string().min(1),
  capHit: z.number().int().nonnegative(),
  baseSalary: z.number().int().nonnegative().optional(),
  performanceBonus: z.number().int().nonnegative().optional(),
});
export type ProposedSeason = z.infer<typeof proposedSeasonSchema>;

export const signFreeAgentPayload = z.object({
  kind: z.literal("sign_free_agent"),
  playerName: z.string().min(1),
  position: z.enum(["C", "LW", "RW", "D", "G"]),
  isTwoWay: z.boolean().default(false),
  seasons: z.array(proposedSeasonSchema).min(1),
});

export const tradeOutPayload = z.object({
  kind: z.literal("trade_out"),
  contractId: z.string().uuid(),
  /** Fraction of the departing cap hit this team retains (0..0.5 typical). */
  retainedPct: z.number().min(0).max(1).default(0),
  tradePartner: z.string().optional(),
});

export const tradeInPayload = z.object({
  kind: z.literal("trade_in"),
  playerName: z.string().min(1),
  position: z.enum(["C", "LW", "RW", "D", "G"]),
  /** Fraction of the incoming cap hit retained by the sending team. */
  retainedByOthersPct: z.number().min(0).max(1).default(0),
  seasons: z.array(proposedSeasonSchema).min(1),
  tradePartner: z.string().optional(),
});

export const callUpPayload = z.object({
  kind: z.literal("call_up"),
  contractId: z.string().uuid(),
});

export const sendDownPayload = z.object({
  kind: z.literal("send_down"),
  contractId: z.string().uuid(),
});

export const irPlacementPayload = z.object({
  kind: z.literal("ir_placement"),
  contractId: z.string().uuid(),
  longTerm: z.boolean().default(false),
});

export const extensionPayload = z.object({
  kind: z.literal("extension"),
  contractId: z.string().uuid(),
  seasons: z.array(proposedSeasonSchema).min(1),
});

export const buyoutPayload = z.object({
  kind: z.literal("buyout"),
  contractId: z.string().uuid(),
  /** Simplified: dead-cap fraction of remaining cap hit per remaining season. */
  deadCapFraction: z.number().min(0).max(1).default(2 / 3),
});

export const scenarioPayloadSchema = z.discriminatedUnion("kind", [
  signFreeAgentPayload,
  tradeOutPayload,
  tradeInPayload,
  callUpPayload,
  sendDownPayload,
  irPlacementPayload,
  extensionPayload,
  buyoutPayload,
]);

export type ScenarioPayload = z.infer<typeof scenarioPayloadSchema>;

/** Maps payload kinds to the transaction_type enum stored on the row. */
export const payloadKindToTransactionType: Record<ScenarioPayload["kind"], string> = {
  sign_free_agent: "sign_free_agent",
  trade_out: "trade",
  trade_in: "trade",
  call_up: "call_up",
  send_down: "send_down",
  ir_placement: "ir_placement",
  extension: "extension",
  buyout: "buyout",
};
