/**
 * Plans, Stripe plumbing (config, signatures, checkout) and subscription state
 * (PGlite, real migrations). No network: Stripe is a fake fetch.
 */
import path from "path";
import { createHmac } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { setDbForTesting, type Db } from "@/db/client";
import { FEATURE_LABELS, PLANS, PURCHASABLE, formatCents, planHas, price, yearlySaving } from "@/lib/billing/plans";
import { billingConfig, createCheckoutSession, verifyStripeSignature } from "@/lib/billing/stripe";
import { applyStripeEvent, entitled, getPlanState } from "@/server/services/billingService";
import { acceptInvite, createInvite } from "@/server/services/inviteService";

const ON = {
  BILLING_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  APP_URL: "https://rosteriq.example/",
  STRIPE_PRICE_SCOUT_MONTH: "price_pm",
  STRIPE_PRICE_SCOUT_YEAR: "price_py",
  STRIPE_PRICE_JUNIOR_CLUB_MONTH: "price_cm",
  STRIPE_PRICE_JUNIOR_CLUB_YEAR: "price_cy",
};

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
const fx = {} as { org: string; admin: string; a: string; b: string };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  setDbForTesting(db as unknown as Db);
  const mk = async (email: string) => (await db.insert(schema.users).values({ email, fullName: email }).returning())[0]!.id;
  fx.admin = await mk("admin@b.test");
  fx.a = await mk("a@b.test");
  fx.b = await mk("b@b.test");
  const [org] = await db.insert(schema.organizations).values({ name: "Club", slug: "club-b" }).returning();
  fx.org = org!.id;
  await db.insert(schema.organizationMembers).values({ organizationId: fx.org, userId: fx.admin, role: "org_admin" });
});

afterAll(async () => {
  await pg.close();
});

describe("plans", () => {
  it("yearly is about two months free; every plan has the basics; quoted plans are not sold by card", () => {
    expect(price("fan", "month")).toBe(499);
    expect(price("scout", "year")).toBe(24900);
    expect(price("pro_club", "year")).toBeNull();
    for (const id of Object.keys(PLANS) as Array<keyof typeof PLANS>) {
      expect(planHas(id, "scores_standings")).toBe(true);
      if (id !== "free" && id !== "pro_club") expect(yearlySaving(id)).toBeGreaterThan(0.16);
    }
    expect(formatCents(499)).toBe("$4.99");
    expect(formatCents(149000)).toBe("$1,490");
    expect(PURCHASABLE).not.toContain("free");
    expect(PURCHASABLE).not.toContain("pro_club");
    for (const f of Object.keys(FEATURE_LABELS)) expect(planHas("pro_club", f as never)).toBe(true);
  });

  it("programs for minors and NCAA athletes never include win probabilities", () => {
    for (const id of ["youth_team", "junior_club", "college_program", "player"] as const) expect(planHas(id, "win_probabilities")).toBe(false);
    expect(planHas("scout", "cap_tools")).toBe(false);
    expect(planHas("manager", "cap_tools")).toBe(true);
  });
});

describe("stripe plumbing", () => {
  it("billing is off unless explicitly enabled with every key", () => {
    expect(billingConfig({}).enabled).toBe(false);
    expect(billingConfig({ ...ON, BILLING_ENABLED: "false" }).reason).toContain("BILLING_ENABLED");
    const noPrices = Object.fromEntries(Object.entries(ON).filter(([k]) => !k.startsWith("STRIPE_PRICE_")));
    expect(billingConfig(noPrices).reason).toContain("STRIPE_PRICE_");
    expect(billingConfig({ ...ON, STRIPE_PRICE_JUNIOR_CLUB_YEAR: "" }).enabled).toBe(true); // other plans still sell
    expect(billingConfig({ ...ON, STRIPE_SECRET_KEY: "pk_live_oops" }).reason).toContain("not a Stripe secret key");
    const cfg = billingConfig(ON);
    expect(cfg.enabled).toBe(true);
    expect(cfg.priceFor("junior_club", "year")).toBe("price_cy");
    expect(cfg.priceFor("coach", "year")).toBeNull(); // not configured = not on sale
    expect(cfg.prices.price_pm).toEqual({ plan: "scout", interval: "month" });
  });

  it("webhook signatures: valid, tampered, wrong secret, replayed", () => {
    const body = '{"id":"evt_1"}';
    const t = 1_790_000_000;
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test", t + 10)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${sig}`, "whsec_test", t)).toBe(true); // rotated secrets
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, "whsec_test", t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_other", t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_test", t + 301)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_test", t)).toBe(false);
  });

  it("checkout: our price and the organization id go to Stripe; its errors come back readable", async () => {
    const cfg = billingConfig(ON);
    let sent = "";
    const url = await createCheckoutSession(
      cfg,
      { organizationId: fx.org, plan: "scout", interval: "year", email: "admin@b.test" },
      async (_u, init) => {
        sent = init.body;
        expect(init.headers.Authorization).toBe("Bearer sk_test_x");
        return { status: 200, json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test" }) };
      },
    );
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_test");
    const form = new URLSearchParams(sent);
    expect(form.get("line_items[0][price]")).toBe("price_py");
    expect(form.get("subscription_data[metadata][organization_id]")).toBe(fx.org);
    expect(form.get("success_url")).toBe("https://rosteriq.example/settings/billing?checkout=success");
    await expect(
      createCheckoutSession(cfg, { organizationId: fx.org, plan: "scout", interval: "month", email: "x@y.z" }, async () => ({
        status: 400,
        json: async () => ({ error: { message: "No such price" } }),
      })),
    ).rejects.toThrow("Stripe: No such price");
  });
});

describe("subscription state", () => {
  const cfg = billingConfig(ON);
  const subEvent = (type: string, created: number, over: Record<string, unknown> = {}) => ({
    type,
    created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        metadata: { organization_id: fx.org },
        items: {
          data: [
            { price: { id: "price_cm" }, quantity: 1, current_period_end: created + 30 * 86400 },
            { price: { id: "price_seat" }, quantity: 2 },
          ],
        },
        ...over,
      },
    },
  });

  it("billing off: every feature, no seat limit", async () => {
    const s = await getPlanState(fx.org, {});
    expect(s).toMatchObject({ billingEnabled: false, plan: "pro_club", seatLimit: null });
    expect(entitled(s, "cap_tools")).toBe(true);
  });

  it("billing on without a subscription: Free, one seat, invites blocked when full", async () => {
    const s = await getPlanState(fx.org, ON);
    expect(s).toMatchObject({ billingEnabled: true, plan: "free", seatLimit: 1, seatsUsed: 1 });
    expect(entitled(s, "xg_models")).toBe(false);
    const { token } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "scout" });
    await expect(acceptInvite({ token, userId: fx.a, userEmail: "a@b.test", env: ON })).rejects.toThrow(/1 seat, all in use/);
    // With billing off the same link works (seat limits do not apply).
    const { token: t2 } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "scout" });
    await acceptInvite({ token: t2, userId: fx.a, userEmail: "a@b.test", env: {} });
  });

  it("subscription events: Junior club with 2 extra seats; stale events skipped; cancellation drops to Free", async () => {
    expect(await applyStripeEvent(subEvent("customer.subscription.created", 2000), cfg, "price_seat")).toBe("updated");
    let s = await getPlanState(fx.org, ON);
    expect(s).toMatchObject({ plan: "junior_club", seatLimit: 17 });
    expect(s.subscription).toMatchObject({ interval: "month", stripeCustomerId: "cus_1", status: "active" });
    expect(s.subscription!.currentPeriodEnd!.getTime()).toBe((2000 + 30 * 86400) * 1000);
    expect(entitled(s, "scouting_workspace")).toBe(true);
    expect(entitled(s, "cap_tools")).toBe(false); // NHL cap tools are not part of a junior plan

    // An older "past_due" update arriving late must not overwrite newer state.
    expect(await applyStripeEvent(subEvent("customer.subscription.updated", 1500, { status: "past_due" }), cfg, "price_seat")).toBe("stale");
    const { token } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "scout" });
    await acceptInvite({ token, userId: fx.b, userEmail: "b@b.test", env: ON }); // 3 of 17 seats

    expect(await applyStripeEvent(subEvent("customer.subscription.deleted", 3000, { status: "canceled" }), cfg, "price_seat")).toBe("updated");
    s = await getPlanState(fx.org, ON);
    expect(s).toMatchObject({ plan: "free", seatLimit: 1, seatsUsed: 3 });
  });

  it("ignores events that are not ours", async () => {
    expect(await applyStripeEvent({ type: "invoice.paid", created: 9999, data: { object: {} } }, cfg)).toBe("ignored");
    expect(await applyStripeEvent(subEvent("customer.subscription.updated", 9999, { metadata: {} }), cfg)).toBe("ignored");
    expect(
      await applyStripeEvent(subEvent("customer.subscription.updated", 9999, { items: { data: [{ price: { id: "price_someone_else" } }] } }), cfg),
    ).toBe("ignored");
    expect(
      await applyStripeEvent(
        subEvent("customer.subscription.updated", 9999, { metadata: { organization_id: "00000000-0000-0000-0000-000000000000" } }),
        cfg,
      ),
    ).toBe("ignored");
  });
});
