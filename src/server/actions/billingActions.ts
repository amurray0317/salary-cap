"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrgAccess } from "@/server/context";
import { billingConfig, createCheckoutSession, createPortalSession } from "@/lib/billing/stripe";
import { getPlanState } from "@/server/services/billingService";

const back = (msg: string) => redirect(`/settings/billing?error=${encodeURIComponent(msg)}`);

/** Admins only: sends the browser to Stripe Checkout for the chosen plan. */
export async function startCheckoutAction(fd: FormData): Promise<void> {
  const parsed = z
    .object({ organizationId: z.string().uuid(), plan: z.enum(["pro", "club"]), interval: z.enum(["month", "year"]) })
    .safeParse({ organizationId: fd.get("organizationId"), plan: fd.get("plan"), interval: fd.get("interval") });
  if (!parsed.success) back("Choose a plan");
  const { organizationId, plan, interval } = parsed.data!;
  const ctx = await requireOrgAccess(organizationId, "admin");
  const cfg = billingConfig();
  if (!cfg.enabled) back("Billing is not switched on yet");
  const state = await getPlanState(organizationId);
  let url: string;
  try {
    url = await createCheckoutSession(cfg, {
      organizationId,
      plan,
      interval,
      email: ctx.user.email,
      customerId: state.subscription?.stripeCustomerId,
    });
  } catch (err) {
    back(err instanceof Error ? err.message : "Could not start checkout");
  }
  redirect(url!);
}

/** Admins only: Stripe's portal to change plan, update the card, or cancel. */
export async function openPortalAction(fd: FormData): Promise<void> {
  const organizationId = z.string().uuid().parse(fd.get("organizationId"));
  await requireOrgAccess(organizationId, "admin");
  const cfg = billingConfig();
  const state = await getPlanState(organizationId);
  const customer = state.subscription?.stripeCustomerId;
  if (!cfg.enabled || !customer) back("There is no subscription to manage yet");
  let url: string;
  try {
    url = await createPortalSession(cfg, customer!);
  } catch (err) {
    back(err instanceof Error ? err.message : "Could not open the billing portal");
  }
  redirect(url!);
}
