/**
 * Stripe, through its REST API (no SDK): Checkout for new subscriptions, the
 * customer portal for changes and cancellation, and webhook verification.
 *
 * Billing is OFF unless BILLING_ENABLED=true and the key, webhook secret and
 * app URL are set. Each plan is sold only once its Stripe price ids are set
 * (STRIPE_PRICE_<PLAN>_MONTH / _YEAR, e.g. STRIPE_PRICE_SCOUT_YEAR); the rest
 * show as not yet available. While billing is off, every organization has
 * every feature. Card details never touch RosterIQ: Checkout and the portal
 * are pages on
 * stripe.com.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { PURCHASABLE, type Interval, type PlanId } from "@/lib/billing/plans";

export const STRIPE_API = "https://api.stripe.com/v1";

export interface BillingConfig {
  enabled: boolean;
  /** Why billing is off (shown to admins), when it is. */
  reason: string | null;
  secretKey: string;
  webhookSecret: string;
  appUrl: string;
  /** Stripe price id → plan and interval. */
  prices: Record<string, { plan: Exclude<PlanId, "free">; interval: Interval }>;
  priceFor: (plan: Exclude<PlanId, "free">, interval: Interval) => string | null;
}

export const priceEnvKey = (plan: PlanId, interval: Interval) => `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;

export function billingConfig(env: Record<string, string | undefined> = process.env): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? "";
  const appUrl = (env.APP_URL ?? "").replace(/\/$/, "");
  const prices: BillingConfig["prices"] = {};
  const byPlan = new Map<string, string>();
  for (const plan of PURCHASABLE) {
    for (const interval of ["month", "year"] as const) {
      const id = env[priceEnvKey(plan, interval)];
      if (id) {
        prices[id] = { plan: plan as Exclude<PlanId, "free">, interval };
        byPlan.set(`${plan}:${interval}`, id);
      }
    }
  }
  const missing = [
    !secretKey && "STRIPE_SECRET_KEY",
    !webhookSecret && "STRIPE_WEBHOOK_SECRET",
    !appUrl && "APP_URL",
    byPlan.size === 0 && "any STRIPE_PRICE_<PLAN>_<MONTH|YEAR>",
  ].filter(Boolean);
  const reason =
    env.BILLING_ENABLED !== "true"
      ? "BILLING_ENABLED is not set to true"
      : missing.length
        ? `missing ${missing.join(", ")}`
        : secretKey.startsWith("sk_") || secretKey.startsWith("rk_")
          ? null
          : "STRIPE_SECRET_KEY is not a Stripe secret key";
  return {
    enabled: reason === null,
    reason,
    secretKey,
    webhookSecret,
    appUrl,
    prices,
    priceFor: (plan, interval) => byPlan.get(`${plan}:${interval}`) ?? null,
  };
}

export type StripeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;
const defaultFetch: StripeFetch = (url, init) => fetch(url, init);

async function stripePost(cfg: BillingConfig, path: string, form: Record<string, string>, fetchImpl: StripeFetch = defaultFetch) {
  const res = await fetchImpl(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json()) as { url?: string; error?: { message?: string } };
  if (res.status >= 400 || !body.url) throw new Error(`Stripe: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body.url;
}

/** A Checkout page for one plan; returns its URL. The organization id rides along in metadata. */
export function createCheckoutSession(
  cfg: BillingConfig,
  opts: { organizationId: string; plan: Exclude<PlanId, "free">; interval: Interval; email: string; customerId?: string | null },
  fetchImpl?: StripeFetch,
): Promise<string> {
  const priceId = cfg.priceFor(opts.plan, opts.interval);
  if (!priceId) throw new Error(`No Stripe price configured for ${opts.plan} (${opts.interval})`);
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: opts.organizationId,
    "metadata[organization_id]": opts.organizationId,
    "subscription_data[metadata][organization_id]": opts.organizationId,
    allow_promotion_codes: "true",
    success_url: `${cfg.appUrl}/settings/billing?checkout=success`,
    cancel_url: `${cfg.appUrl}/settings/billing?checkout=cancelled`,
  };
  if (opts.customerId) form.customer = opts.customerId;
  else form.customer_email = opts.email;
  return stripePost(cfg, "/checkout/sessions", form, fetchImpl);
}

/** Stripe's customer portal (change plan, update card, cancel); returns its URL. */
export function createPortalSession(cfg: BillingConfig, customerId: string, fetchImpl?: StripeFetch): Promise<string> {
  return stripePost(cfg, "/billing_portal/sessions", { customer: customerId, return_url: `${cfg.appUrl}/settings/billing` }, fetchImpl);
}

/**
 * Verifies a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=...]"): HMAC-SHA256
 * of "<t>.<raw body>" with the endpoint secret, compared in constant time, and
 * the timestamp within `toleranceSec` of now (replay protection).
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || sigs.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
