import type { NextRequest } from "next/server";
import { resolveApiContext } from "@/server/apiContext";
import { listProspects, type ProspectListFilters } from "@/server/services/prospectListService";
import { csvResponse, toCsv } from "@/lib/csv";
import { roleHasCapability } from "@/lib/auth/roles";

/** Exports the NCAA player list with the same filters/sort as the page. */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!roleHasCapability(ctx.role, "export_scouting")) {
    return new Response("Your role cannot export scouting data", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters: ProspectListFilters = {};
  for (const key of ["q", "pos", "school", "conf", "hand", "class", "draft", "maxAge", "minPpg", "minGp", "sort", "dir"] as const) {
    const v = sp.get(key);
    if (v) filters[key] = v;
  }
  const rows = await listProspects(ctx.org.id, filters);

  const csv = toCsv(
    ["Player", "Position", "Hand", "School", "Conference", "Class", "Age", "Season", "GP", "G", "A", "P", "PPG", "Shots/G", "TOI available", "Draft status", "Draft year", "Draft round", "Overall", "NHL rights", "CFA status"],
    rows.map((r) => [
      r.p.fullName,
      r.p.position,
      r.p.shootsCatches ?? "",
      r.schoolName ?? "",
      r.conferenceName ?? "",
      r.p.classYear,
      r.age ?? "",
      r.season?.seasonName ?? "",
      r.season?.gamesPlayed ?? "",
      r.season?.goals ?? "",
      r.season?.assists ?? "",
      r.derived?.points ?? "",
      r.derived?.ppg?.toFixed(3) ?? "",
      r.derived?.shotsPerGame?.toFixed(2) ?? "",
      r.season?.timeOnIceSeconds != null ? "yes" : "no",
      r.p.nhlDraftStatus,
      r.p.draftYear ?? "",
      r.p.draftRound ?? "",
      r.p.draftOverall ?? "",
      r.p.nhlRightsHolder ?? "",
      r.p.collegeFreeAgentStatus,
    ]),
  );
  const meta = `# RosterIQ NCAA player export,org=${ctx.org.name},generated=${new Date().toISOString()},filters=${sp.toString() || "none"}\r\n`;
  return csvResponse(`ncaa-players-${new Date().toISOString().slice(0, 10)}.csv`, meta + csv);
}
