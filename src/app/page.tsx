import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

const MODULES = [
  {
    title: "Cap management",
    body: "Season-by-season cap commitments, retained salary, dead cap, buried contracts, IR and LTIR — every figure explainable down to the rule that produced it.",
  },
  {
    title: "Transaction simulation",
    body: "Model signings, trades with retention, call-ups, demotions, extensions, and buyouts in isolated scenarios that never touch official records until applied.",
  },
  {
    title: "Player valuation",
    body: "Transparent market-value and performance-value estimates with confidence bands, comparables, and expected surplus value — always labeled as estimates.",
  },
  {
    title: "Versioned rules engine",
    body: "Cap limits, roster limits, and contract rules are configurable per league and season, versioned with effective dates and sources — never hardcoded.",
  },
  {
    title: "Compliance monitoring",
    body: "Blocking violations and early warnings for cap, floor, roster-size, contract-slot, and individual-salary rules across current and future seasons.",
  },
  {
    title: "Reports & exports",
    body: "Roster, commitment, and scenario-comparison reports with CSV export and print-ready formats, stamped with data timestamps and model versions.",
  },
];

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded bg-accent" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">RosterIQ</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link className="text-ink-secondary hover:text-ink" href="/login">
            Sign in
          </Link>
          <Link
            className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90"
            href="/register"
          >
            Create account
          </Link>
        </nav>
      </header>

      <section className="mt-20 max-w-3xl">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">
          Front-office roster intelligence for teams that manage every dollar of cap space.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-secondary">
          RosterIQ combines salary-cap accounting, contract management, transaction simulation,
          and player valuation in one configurable platform — built for professional front
          offices, agencies, and league operations.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            className="rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:opacity-90"
            href="/register"
          >
            Get started
          </Link>
          <Link
            className="rounded-md border border-line px-5 py-2.5 font-medium text-ink-secondary hover:text-ink"
            href="/login"
          >
            Explore the demo
          </Link>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Demo login: <code className="text-ink-secondary">gm@aurora.demo</code> / password{" "}
          <code className="text-ink-secondary">rosteriq-demo</code> (seeded fictional data).
        </p>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <div key={m.title} className="rounded-lg border border-line bg-navy-900 p-5">
            <h2 className="font-medium">{m.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{m.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-20 border-t border-line pt-6 text-sm text-ink-muted">
        All demonstration data is fictional. Valuation and NIL figures produced by RosterIQ
        models are estimates, not official values or guaranteed outcomes.
      </footer>
    </main>
  );
}
