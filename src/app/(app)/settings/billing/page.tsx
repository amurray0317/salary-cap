import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { roleHasCapability } from "@/lib/auth/roles";
import { PLANS, PLAN_ORDER, formatCents, price, yearlySaving, type Feature, type Interval } from "@/lib/billing/plans";
import { billingConfig } from "@/lib/billing/stripe";
import { getPlanState } from "@/server/services/billingService";
import { openPortalAction, startCheckoutAction } from "@/server/actions/billingActions";
import { Notice } from "@/components/Notice";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Plan & billing" };

const FEATURE_ROWS: Array<{ feature: Feature; label: string }> = [
  { feature: "scores_standings", label: "Live scores and standings" },
  { feature: "game_states", label: "Special teams & game states" },
  { feature: "player_pages", label: "Player pages and league stats" },
  { feature: "xg_models", label: "RosterIQ expected goals (players, goalies, teams, PP/PK)" },
  { feature: "prospect_model", label: "Prospect model and league equivalencies" },
  { feature: "exports", label: "CSV exports" },
  { feature: "cap_tools", label: "Cap planning, scenarios, contracts" },
  { feature: "scouting_workspace", label: "Scouting reports, lists, boards, assignments" },
  { feature: "team_roles", label: "Staff roles and invite links" },
];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ interval?: string; error?: string; checkout?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const interval: Interval = sp.interval === "month" ? "month" : "year";
  const isAdmin = roleHasCapability(ctx.role, "admin");
  const cfg = billingConfig();
  const state = await getPlanState(ctx.org.id);
  const sub = state.subscription;

  return (
    <div className="space-y-6">
      <div>
        <h1>Plan &amp; billing</h1>
        <p className="mt-1 text-sm text-ink-muted">Plans belong to {ctx.org.name}; everyone in the organization shares them.</p>
      </div>
      <Notice
        error={sp.error}
        saved={sp.checkout === "success" ? "Thanks! Your plan updates as soon as Stripe confirms the payment (usually a few seconds)." : undefined}
      />

      {!state.billingEnabled && (
        <div className="rounded-xl border border-ice/30 bg-accent-soft px-4 py-3 text-sm text-ink-secondary">
          <strong className="text-ink">Billing is switched off: every feature is unlocked for everyone.</strong> Paid plans turn on only after the
          data sources are licensed for commercial use and a Stripe account is connected.
          {isAdmin && cfg.reason && <span className="mt-1 block text-xs text-ink-muted">Setup status: {cfg.reason}.</span>}
        </div>
      )}

      {state.billingEnabled && (
        <Card title="Current plan">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm">
              <div className="font-display text-xl font-extrabold">{PLANS[state.plan].name}</div>
              {sub ? (
                <div className="text-ink-muted">
                  {sub.interval === "year" ? "Yearly" : "Monthly"} · status {sub.status.replace(/_/g, " ")}
                  {sub.currentPeriodEnd && ` · ${sub.cancelAtPeriodEnd ? "ends" : "renews"} ${formatDate(sub.currentPeriodEnd)}`}
                </div>
              ) : (
                <div className="text-ink-muted">No paid plan</div>
              )}
              <div className="mt-1 text-ink-secondary">
                Seats: <strong>{state.seatsUsed}</strong> of {state.seatLimit}
              </div>
            </div>
            {isAdmin && sub?.stripeCustomerId && (
              <form action={openPortalAction}>
                <input type="hidden" name="organizationId" value={ctx.org.id} />
                <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-subtle">
                  Manage billing, card &amp; cancellation
                </button>
              </form>
            )}
          </div>
        </Card>
      )}

      <div className="flex justify-center">
        <div className="inline-flex rounded-full bg-surface p-1 shadow-sm ring-1 ring-line" role="group" aria-label="Billing period">
          {(["month", "year"] as const).map((i) => (
            <Link
              key={i}
              href={`/settings/billing?interval=${i}`}
              aria-current={interval === i ? "true" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${interval === i ? "bg-linear-to-r from-accent to-accent-2 text-white shadow" : "text-ink-secondary"}`}
            >
              {i === "month" ? "Monthly" : "Yearly · 2 months free"}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const cents = price(id, interval);
          const current = state.billingEnabled ? state.plan === id : false;
          const featured = id === "pro";
          return (
            <section
              key={id}
              className={`relative flex flex-col rounded-2xl border bg-surface p-5 shadow-[0_6px_24px_-12px_rgba(30,27,75,0.25)] ${featured ? "border-accent ring-2 ring-accent/30" : "border-line"}`}
            >
              {featured && (
                <span className="absolute -top-3 left-5 rounded-full bg-linear-to-r from-accent to-accent-2 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                  Most popular
                </span>
              )}
              <h2 className="font-display text-lg font-extrabold">{p.name}</h2>
              <p className="text-sm text-ink-muted">{p.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-extrabold tracking-tight">{formatCents(cents)}</span>
                {cents > 0 && <span className="text-sm text-ink-muted">/{interval === "year" ? "year" : "month"}</span>}
              </div>
              <p className="h-5 text-xs text-ink-muted">
                {cents > 0 &&
                  interval === "year" &&
                  `${formatCents(Math.round(cents / 12))}/month billed yearly · save ${Math.round(yearlySaving(id) * 100)}%`}
                {cents > 0 && interval === "month" && `or ${formatCents(p.yearly)}/year`}
                {cents === 0 && "No card needed"}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span aria-hidden className="text-good">
                      ✓
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {current ? (
                  <div className="rounded-md bg-subtle py-2 text-center text-sm font-semibold text-ink-secondary">Your plan</div>
                ) : id === "free" ? (
                  <div className="py-2 text-center text-sm text-ink-muted">Always free</div>
                ) : (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="organizationId" value={ctx.org.id} />
                    <input type="hidden" name="plan" value={id} />
                    <input type="hidden" name="interval" value={interval} />
                    <button
                      disabled={!state.billingEnabled || !isAdmin}
                      title={
                        !state.billingEnabled ? "Billing is switched off" : !isAdmin ? "Only organization admins can change the plan" : undefined
                      }
                      className={`w-full rounded-md py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${featured ? "bg-accent text-white" : "border border-accent text-accent-text"}`}
                    >
                      Choose {p.name}
                    </button>
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Card title="Compare plans">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-secondary">
                <th className="py-2 font-semibold">Feature</th>
                {PLAN_ORDER.map((id) => (
                  <th key={id} className="w-36 py-2 text-center font-semibold">
                    {PLANS[id].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((r) => (
                <tr key={r.feature} className="border-t border-line/60">
                  <td className="py-2">{r.label}</td>
                  {PLAN_ORDER.map((id) => (
                    <td key={id} className="py-2 text-center">
                      {PLANS[id].features.includes(r.feature) ? <span className="text-good">✓</span> : <span className="text-ink-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-line/60">
                <td className="py-2">People included</td>
                {PLAN_ORDER.map((id) => (
                  <td key={id} className="py-2 text-center">
                    {PLANS[id].seats}
                    {PLANS[id].extraSeatMonthly ? ` + ${formatCents(PLANS[id].extraSeatMonthly!)}/mo each` : ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Prices in USD. Cancel any time; paid features stay on until the end of the period you paid for. Payments are handled by Stripe: card numbers
          never reach RosterIQ.
        </p>
      </Card>
    </div>
  );
}
