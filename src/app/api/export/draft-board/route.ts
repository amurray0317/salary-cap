import type { NextRequest } from "next/server";
import { resolveApiContext } from "@/server/apiContext";
import { getBoardDetail, recordBoardExport } from "@/server/services/boardService";
import { csvResponse, toCsv } from "@/lib/csv";
import { roleHasCapability } from "@/lib/auth/roles";

/** Exports a draft board with every ranking source kept in its own column. */
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
    detail = await getBoardDetail(boardId, ctx.org.id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const { board, entries, consensus } = detail;
  const consensusBy = new Map(consensus.map((c) => [c.prospectId, c]));

  const csv = toCsv(
    [
      "Overall rank", "Prospect", "Position", "Position rank", "Expected round", "Expected range",
      "Model rank", "Consensus mean", "Consensus median", "Consensus best-worst", "Consensus stddev",
      "Consensus submissions", "Fit rank", "Fit score", "Director final rank", "Risk", "Floor", "Ceiling",
      "Viewings", "Reports", "Recommendation", "Notes",
    ],
    entries.map((r) => {
      const c = consensusBy.get(r.p.id);
      return [
        r.e.overallRank,
        r.p.fullName,
        r.p.position,
        r.e.positionRank ?? "",
        r.e.expectedRound ?? "",
        r.e.expectedRangeStart ? `${r.e.expectedRangeStart}-${r.e.expectedRangeEnd ?? "?"}` : "",
        r.e.modelRank ?? "",
        c?.meanRank ?? "",
        c?.medianRank ?? "",
        c ? `${c.bestRank}-${c.worstRank}` : "",
        c?.stddev ?? "",
        c?.submissions ?? 0,
        r.e.fitRank ?? "",
        r.e.fitScore?.toFixed(1) ?? "",
        r.e.directorFinalRank ?? "",
        r.e.risk ?? "",
        r.e.floor ?? "",
        r.e.ceiling ?? "",
        r.e.viewingCount,
        r.e.reportCount,
        r.e.recommendation ?? "",
        r.e.notes ?? "",
      ];
    }),
  );
  await recordBoardExport({ organizationId: ctx.org.id, boardKind: "draft", boardId: board.id, userId: ctx.user.id });
  const meta = `# RosterIQ draft board export,org=${ctx.org.name},board=${board.name},version=${board.version},status=${board.status},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`draft-board-${board.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, meta + csv);
}
