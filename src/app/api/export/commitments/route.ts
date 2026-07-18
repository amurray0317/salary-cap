import { resolveApiContext } from "@/server/apiContext";
import { getTeamCapReport } from "@/server/services/capService";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx || !ctx.team) {
    return new Response("Unauthorized or no team selected", { status: 401 });
  }
  const report = await getTeamCapReport(ctx.team.id);
  const csv = toCsv(
    [
      "Season",
      "Cap upper limit",
      "Cap lower limit",
      "Active-roster cap hit",
      "IR cap hit",
      "Buried",
      "Retained",
      "Dead cap",
      "LTIR relief",
      "Total cap charge",
      "Cap space",
      "Cash payroll",
      "Active roster",
      "Contract slots",
      "Blocking violations",
      "Warnings",
    ],
    report.results.map((r) => [
      r.season.name,
      r.totals.capUpperLimit,
      r.totals.capLowerLimit,
      r.totals.activeRosterCapHit,
      r.totals.injuredReserveCapHit,
      r.totals.buriedCapHit,
      r.totals.retainedTotal,
      r.totals.deadCapTotal,
      r.totals.ltirRelief,
      r.totals.totalCapCharge,
      r.totals.capSpace,
      r.totals.totalCashPayroll,
      r.counts.activeRoster,
      r.counts.contractSlots,
      r.violations.length,
      r.warnings.length,
    ]),
  );
  const meta = `# RosterIQ future commitments,team=${report.team.name},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`commitments-${report.team.abbreviation}.csv`, meta + csv);
}
