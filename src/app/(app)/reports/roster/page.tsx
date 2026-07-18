import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { getTeamCapReport } from "@/server/services/capService";
import { EmptyState } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "Printable roster report" };

export default async function PrintableRosterReport() {
  const ctx = await resolveAppContext();
  if (!ctx.team || !ctx.season) {
    return <EmptyState title="No team context" body="Create a team to generate reports." />;
  }
  const report = await getTeamCapReport(ctx.team.id);
  const seasonIdx = Math.max(0, report.seasons.findIndex((s) => s.id === ctx.season?.id));
  const current = report.results[seasonIdx];
  if (!current) return <EmptyState title="No season data" body="Configure league seasons first." />;

  const generatedAt = new Date().toISOString();

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-neutral-900 print:p-0" style={{ colorScheme: "light" }}>
      <div className="no-print mb-4 flex justify-between rounded-md border border-line bg-navy-900 p-3 text-ink">
        <span className="text-sm">Print-optimized report — use your browser&rsquo;s Print → Save as PDF.</span>
        <span className="text-sm text-ink-muted">Ctrl/Cmd + P</span>
      </div>

      <header className="border-b-2 border-neutral-900 pb-3">
        <h1 className="text-2xl font-bold">{ctx.org.name}</h1>
        <p className="text-lg">
          {ctx.team.name} — Roster & cap report, {current.season.name}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Generated {generatedAt} · RosterIQ · rules versions:{" "}
          {current.appliedRules.map((r) => `${r.key} v${r.version}`).join(", ")}
        </p>
      </header>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Cap summary</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {[
              ["Cap upper limit", money(current.totals.capUpperLimit)],
              ["Total cap charge", money(current.totals.totalCapCharge)],
              ["Cap space", money(current.totals.capSpace)],
              ["Retained salary", money(current.totals.retainedTotal)],
              ["Dead cap", money(current.totals.deadCapTotal)],
              ["LTIR relief", money(current.totals.ltirRelief)],
              ["Cash payroll", money(current.totals.totalCashPayroll)],
              ["Active roster / contracts", `${current.counts.activeRoster} / ${current.counts.contractSlots}`],
            ].map(([k, v]) => (
              <tr key={k} className="border-b border-neutral-200">
                <td className="py-1 pr-4 text-neutral-600">{k}</td>
                <td className="py-1 text-right font-medium tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Cap charges by line</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left">
              <th className="py-1">Player / line</th>
              <th className="py-1">Category</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {current.lineItems.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200">
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-neutral-600">{l.category.replace(/_/g, " ")}</td>
                <td className="py-1 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Future commitments</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left">
              <th className="py-1">Season</th>
              <th className="py-1 text-right">Cap limit</th>
              <th className="py-1 text-right">Committed</th>
              <th className="py-1 text-right">Space</th>
              <th className="py-1 text-right">Contracts</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr key={r.season.id} className="border-b border-neutral-200">
                <td className="py-1">{r.season.name}</td>
                <td className="py-1 text-right tabular-nums">{money(r.totals.capUpperLimit)}</td>
                <td className="py-1 text-right tabular-nums">{money(r.totals.totalCapCharge)}</td>
                <td className="py-1 text-right tabular-nums">{money(r.totals.capSpace)}</td>
                <td className="py-1 text-right tabular-nums">{r.counts.contractSlots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(current.violations.length > 0 || current.warnings.length > 0) && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Compliance</h2>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {[...current.violations, ...current.warnings].map((v, i) => (
              <li key={i}>
                <strong>{v.severity}:</strong> {v.message} <span className="text-neutral-500">({v.ruleKey})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-500">
        Figures derive from records stored in RosterIQ as of the generation time above. Estimated
        values are model outputs, not official amounts. Fictional demonstration data may be present.
      </footer>
    </div>
  );
}
