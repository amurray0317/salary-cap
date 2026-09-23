import type { NextRequest } from "next/server";
import { resolveApiContext } from "@/server/apiContext";
import { getCfaBoardDetail, recordBoardExport } from "@/server/services/boardService";
import { csvResponse, toCsv } from "@/lib/csv";
import { roleHasCapability } from "@/lib/auth/roles";

/** Exports a college free-agent board with relationship + follow-up fields. */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!roleHasCapability(ctx.role, "export_scouting")) {
    return new Response("Your role cannot export scouting data", { status: 403 });
  }
  const boardId = req.nextUrl.searchParams.get("boardId");
  if (!boardId) return new Response("boardId is required", { status: 400 });

  let detail;
  try {
    detail = await getCfaBoardDetail(boardId, ctx.org.id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const { board, entries } = detail;

  const csv = toCsv(
    [
      "Priority", "Prospect", "Position", "School", "Class", "NHL rights", "Remaining eligibility",
      "Expected availability", "Readiness", "Projected AHL role", "Projected NHL role", "Fit score",
      "Market competition", "Agent", "Relationship status", "Last contact", "Next action",
      "Next action date", "Assigned staff", "Recommendation", "Status", "Notes",
    ],
    entries.map((r) => [
      r.e.priorityRank,
      r.p.fullName,
      r.p.position,
      r.schoolName ?? "",
      r.p.classYear,
      r.e.nhlRightsStatus,
      r.e.remainingEligibility ?? "",
      r.e.expectedAvailability ?? "",
      r.e.readiness ?? "",
      r.e.projectedAhlRole ?? "",
      r.e.projectedNhlRole ?? "",
      r.e.fitScore?.toFixed(1) ?? "",
      r.e.marketCompetition ?? "",
      r.e.agentName ?? "",
      r.e.relationshipStatus,
      r.e.lastContactDate ?? "",
      r.e.nextAction ?? "",
      r.e.nextActionDate ?? "",
      r.staffName ?? "",
      r.e.recommendation ?? "",
      r.e.entryStatus,
      r.e.notes ?? "",
    ]),
  );
  await recordBoardExport({ organizationId: ctx.org.id, boardKind: "college_free_agent", boardId: board.id, userId: ctx.user.id });
  const meta = `# RosterIQ college free-agent board export,org=${ctx.org.name},board=${board.name},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`cfa-board-${board.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, meta + csv);
}
