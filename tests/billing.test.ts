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
import { PLANS, formatCents, planHas, price, yearlySaving } from "@/lib/billing/plans";
import { billingConfig, createCheckoutSession, verifyStripeSignature } from "@/lib/billing/stripe";
import { applyStripeEvent, entitled, getPlanState } from "@/server/services/billingService";
import { acceptInvite, createInvite } from "@/server/services/inviteService";

const ON = {
  BILLING_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  APP_URL: "https://rosteriq.example/",
  STRIPE_PRICE_PRO_MONTH: "price_pm",
  STRIPE_PRICE_PRO_YEAR: "price_py",
  STRIPE_PRICE_CLUB_MONTH: "price_cm",
  STRIPE_PRICE_CLUB_YEAR: "price_cy",
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
  it("yearly is about two months free; features nest Free ⊂ Pro ⊂ Club", () => {
    expect(price("pro", "month")).toBe(999);
    expect(price("pro", "year")).toBe(9900);
    expect(price("club", "year")).toBe(PLANS.club.monthly * 10);
    expect(yearlySaving("pro")).toBeCloseTo(1 - 9900 / 11988, 6);
    expect(yearlySaving("club")).toBeCloseTo(1 / 6, 6);
    expect(formatCents(999)).toBe("$9.99");
    expect(formatCents(49000)).toBe("$490");
    for (const f of PLANS.free.features) expect(planHas("pro", f)).toBe(true);
    for (const f of PLANS.pro.features) expect(planHas("club", f)).toBe(true);
    expect(planHas("pro", "cap_tools")).toBe(false);
  });
});

describe("stripe plumbing", () => {
  it("billing is off unless explicitly enabled with every key", () => {
    expect(billingConfig({}).enabled).toBe(false);
    expect(billingConfig({ ...ON, BILLING_ENABLED: "false" }).reason).toContain("BILLING_ENABLED");
    expect(billingConfig({ ...ON, STRIPE_PRICE_CLUB_YEAR: "" }).reason).toContain("STRIPE_PRICE_CLUB_YEAR");
    expect(billingConfig({ ...ON, STRIPE_SECRET_KEY: "pk_live_oops" }).reason).toContain("not a Stripe secret key");
    const cfg = billingConfig(ON);
    expect(cfg.enabled).toBe(true);
    expect(cfg.priceFor("club", "year")).toBe("price_cy");
    expect(cfg.prices.price_pm).toEqual({ plan: "pro", interval: "month" });
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
      { organizationId: fx.org, plan: "pro", interval: "year", email: "admin@b.test" },
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
      createCheckoutSession(cfg, { organizationId: fx.org, plan: "pro", interval: "month", email: "x@y.z" }, async () => ({
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
    expect(s).toMatchObject({ billingEnabled: false, plan: "club", seatLimit: null });
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

  it("subscription events: Club with 2 extra seats; stale events skipped; cancellation drops to Free", async () => {
    expect(await applyStripeEvent(subEvent("customer.subscription.created", 2000), cfg, "price_seat")).toBe("updated");
    let s = await getPlanState(fx.org, ON);
    expect(s).toMatchObject({ plan: "club", seatLimit: 7 });
    expect(s.subscription).toMatchObject({ interval: "month", stripeCustomerId: "cus_1", status: "active" });
    expect(s.subscription!.currentPeriodEnd!.getTime()).toBe((2000 + 30 * 86400) * 1000);
    expect(entitled(s, "cap_tools")).toBe(true);

    // An older "past_due" update arriving late must not overwrite newer state.
    expect(await applyStripeEvent(subEvent("customer.subscription.updated", 1500, { status: "past_due" }), cfg, "price_seat")).toBe("stale");
    const { token } = await createInvite({ organizationId: fx.org, actorId: fx.admin, actorRole: "org_admin", role: "scout" });
    await acceptInvite({ token, userId: fx.b, userEmail: "b@b.test", env: ON }); // 3 of 7 seats

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
