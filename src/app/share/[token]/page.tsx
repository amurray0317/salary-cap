/**
 * Public, read-only shared report. No authentication: access is granted by
 * possession of an unguessable token, and only the frozen snapshot stored at
 * generation time is rendered. Revoked or unknown tokens 404.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSharedReport } from "@/server/services/reportService";
import { money, statusLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Shared report" };

interface SummaryContent {
  totals: Record<string, number>;
  counts: Record<string, number>;
  calculatedAt: string;
}
interface LineItemsContent {
  rows: Array<{ label: string; category: string; amount: number; formula: string }>;
}
interface CommitmentsContent {
  rows: Array<{ season: string; capUpperLimit: number; totalCapCharge: number; capSpace: number; contractSlots: number }>;
}
interface ComplianceContent {
  items: Array<{ severity: string; message: string; ruleKey: string; ruleVersion: number | null }>;
}
interface DisclaimerContent {
  text: string;
}

const th = "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-ink-muted";
const td = "px-2 py-1.5 text-sm";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await getSharedReport(token);
  if (!shared) notFound();
  const { report, sections } = shared;

  const summary = sections.find((s) => s.sectionType === "summary")?.content as SummaryContent | undefined;
  const lineItems = sections.find((s) => s.sectionType === "line_items")?.content as LineItemsContent | undefined;
  const commitments = sections.find((s) => s.sectionType === "commitments")?.content as CommitmentsContent | undefined;
  const compliance = sections.find((s) => s.sectionType === "compliance")?.content as ComplianceContent | undefined;
  const disclaimer = sections.find((s) => s.sectionType === "disclaimer")?.content as DisclaimerContent | undefined;

  const summaryRows: Array<[string, string]> = summary
    ? [
        ["Cap upper limit", money(summary.totals.capUpperLimit)],
        ["Total cap charge", money(summary.totals.totalCapCharge)],
        ["Cap space", money(summary.totals.capSpace)],
        ["Retained salary", money(summary.totals.retainedTotal)],
        ["Dead cap", money(summary.totals.deadCapTotal)],
        ["LTIR relief", money(summary.totals.ltirRelief)],
        ["Cash payroll", money(summary.totals.totalCashPayroll)],
        ["Active roster / contracts", `${summary.counts.activeRoster} / ${summary.counts.contractSlots}`],
      ]
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-line pb-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block h-5 w-5 rounded bg-accent" aria-hidden />
          <span className="font-semibold">RosterIQ</span>
          <span className="ml-2 rounded bg-navy-800 px-2 py-0.5 text-xs text-ink-secondary">
            Shared read-only report
          </span>
        </div>
        <h1 className="text-xl font-semibold">{report.title}</h1>
        <p className="mt-1 text-xs text-ink-muted">
          Generated {report.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · frozen
          snapshot — does not update
        </p>
      </header>

      {summary && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-secondary">Cap summary</h2>
          <table className="w-full">
            <tbody>
              {summaryRows.map(([k, v]) => (
                <tr key={k} className="border-b border-line/50 last:border-0">
                  <td className={`${td} text-ink-muted`}>{k}</td>
                  <td className={`${td} text-right tabular-nums`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {commitments && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-secondary">Future commitments</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Season</th>
                <th className={`${th} text-right`}>Cap limit</th>
                <th className={`${th} text-right`}>Committed</th>
                <th className={`${th} text-right`}>Space</th>
                <th className={`${th} text-right`}>Contracts</th>
              </tr>
            </thead>
            <tbody>
              {commitments.rows.map((r) => (
                <tr key={r.season} className="border-b border-line/50 last:border-0">
                  <td className={td}>{r.season}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(r.capUpperLimit)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(r.totalCapCharge)}</td>
                  <td className={`${td} text-right tabular-nums ${r.capSpace < 0 ? "text-critical" : ""}`}>
                    {money(r.capSpace)}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{r.contractSlots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {lineItems && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-secondary">Cap charges by line</h2>
          <div className="max-h-96 overflow-auto rounded-md border border-line">
            <table className="w-full">
              <thead className="sticky top-0 bg-navy-900">
                <tr className="border-b border-line">
                  <th className={th}>Line</th>
                  <th className={th}>Category</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.rows.map((l, i) => (
                  <tr key={i} className="border-b border-line/50 last:border-0">
                    <td className={td}>{l.label}</td>
                    <td className={`${td} text-ink-muted`}>{statusLabel(l.category)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {compliance && compliance.items.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-secondary">Compliance at generation time</h2>
          <ul className="space-y-1 text-sm">
            {compliance.items.map((v, i) => (
              <li key={i} className="rounded-md border border-line px-3 py-2">
                <span className={v.severity === "blocking" ? "text-critical" : "text-warn"}>
                  {v.severity === "blocking" ? "⛔" : "⚠"} {v.severity}:
                </span>{" "}
                {v.message}{" "}
                <span className="text-xs text-ink-muted">
                  ({v.ruleKey}
                  {v.ruleVersion !== null ? ` v${v.ruleVersion}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-line pt-4 text-xs text-ink-muted">
        {disclaimer?.text ??
          "Frozen snapshot generated by RosterIQ. Estimated values are model outputs, not official figures."}
      </footer>
    </main>
  );
}
