/**
 * Plans and entitlements for an organization, and the Stripe webhook's
 * effect on them. While billing is off (the default), every organization has
 * every feature and no seat limit.
 */
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { PLANS, planHas, type Feature, type Interval, type PlanId } from "@/lib/billing/plans";
import { billingConfig, type BillingConfig } from "@/lib/billing/stripe";

/** Statuses that keep paid features on. past_due keeps them during Stripe's retry window. */
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface PlanState {
  billingEnabled: boolean;
  /** The plan whose features apply now. */
  plan: PlanId;
  subscription: typeof schema.organizationSubscriptions.$inferSelect | null;
  seatsUsed: number;
  /** Null = no limit (billing off). */
  seatLimit: number | null;
}

export async function getPlanState(organizationId: string, env: Record<string, string | undefined> = process.env): Promise<PlanState> {
  const cfg = billingConfig(env);
  const db = getDb();
  const [sub] = await db.select().from(schema.organizationSubscriptions).where(eq(schema.organizationSubscriptions.organizationId, organizationId));
  const [{ n }] = (await db
    .select({ n: count() })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, organizationId))) as [{ n: number }];
  if (!cfg.enabled) return { billingEnabled: false, plan: "club", subscription: sub ?? null, seatsUsed: n, seatLimit: null };
  const paid = sub && PAID_STATUSES.has(sub.status) && (sub.plan === "pro" || sub.plan === "club") ? (sub.plan as PlanId) : "free";
  return { billingEnabled: true, plan: paid, subscription: sub ?? null, seatsUsed: n, seatLimit: paid === "free" ? PLANS.free.seats : sub!.seats };
}

export function entitled(state: PlanState, feature: Feature): boolean {
  return !state.billingEnabled || planHas(state.plan, feature);
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; quantity?: number; current_period_end?: number }> };
}

export type EventOutcome = "updated" | "ignored" | "stale";

/**
 * Applies one verified Stripe event. Subscription events are the source of
 * truth (Checkout copies the organization id into subscription metadata).
 * Events older than the stored state are skipped, since Stripe does not
 * guarantee delivery order.
 */
export async function applyStripeEvent(
  event: { type: string; created: number; data: { object: unknown } },
  cfg: BillingConfig = billingConfig(),
  extraSeatPriceId: string | undefined = process.env.STRIPE_PRICE_EXTRA_SEAT,
): Promise<EventOutcome> {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return "ignored";
  const sub = event.data.object as StripeSubscription;
  const orgId = sub.metadata?.organization_id;
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) return "ignored";
  const items = sub.items?.data ?? [];
  const base = items.map((i) => cfg.prices[i.price?.id ?? ""]).find(Boolean);
  if (!base) return "ignored"; // not one of our plan prices
  const extraSeats = items.filter((i) => extraSeatPriceId && i.price?.id === extraSeatPriceId).reduce((a, i) => a + (i.quantity ?? 0), 0);
  const eventAt = new Date(event.created * 1000);
  const periodEnd = sub.current_period_end ?? items[0]?.current_period_end;

  const db = getDb();
  const [org] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!org) return "ignored";
  const [current] = await db.select().from(schema.organizationSubscriptions).where(eq(schema.organizationSubscriptions.organizationId, orgId));
  if (current && current.updatedAt > eventAt) return "stale";

  const values = {
    plan: base.plan,
    interval: base.interval as Interval,
    status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
    seats: PLANS[base.plan].seats + (base.plan === "club" ? extraSeats : 0),
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    updatedAt: eventAt,
  };
  await db
    .insert(schema.organizationSubscriptions)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({ target: schema.organizationSubscriptions.organizationId, set: values });
  return "updated";
}
