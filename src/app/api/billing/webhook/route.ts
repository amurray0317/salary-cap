import { billingConfig, verifyStripeSignature } from "@/lib/billing/stripe";
import { applyStripeEvent } from "@/server/services/billingService";

/** Stripe → RosterIQ subscription changes. Only signed, recent events are applied. */
export async function POST(req: Request): Promise<Response> {
  const cfg = billingConfig();
  if (!cfg.enabled) return new Response("Billing is not enabled", { status: 404 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), cfg.webhookSecret)) return new Response("Bad signature", { status: 400 });
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const outcome = await applyStripeEvent(event, cfg);
  return Response.json({ received: true, outcome });
}
