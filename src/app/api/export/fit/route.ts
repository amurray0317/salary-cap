import type { NextRequest } from "next/server";
import { resolveApiContext } from "@/server/apiContext";
import { getOwnedNeed, getRankedFits } from "@/server/services/fitService";
import { csvResponse, toCsv } from "@/lib/csv";
import { roleHasCapability } from "@/lib/auth/roles";
import { FIT_COMPONENT_KEYS, FIT_COMPONENT_LABELS } from "@/lib/scouting/fit";

interface StoredComponent {
  key: string;
  finalScore: number | null;
}

/** Exports the ranked fit results for one organizational need. */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!roleHasCapability(ctx.role, "export_scouting")) {
    return new Response("Your role cannot export scouting data", { status: 403 });
  }
  const needId = req.nextUrl.searchParams.get("needId");
  if (!needId) return new Response("needId is required", { status: 400 });

  let need;
  let rows;
  try {
    ({ need } = await getOwnedNeed(needId, ctx.org.id));
    rows = await getRankedFits(needId, ctx.org.id);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const componentCols = FIT_COMPONENT_KEYS.map((k) => FIT_COMPONENT_LABELS[k]);
  const csv = toCsv(
    ["Rank", "Prospect", "Position", "Shoots", "School", "Class", "Draft status", "Overall fit", "Confidence", ...componentCols, "Warnings", "Model", "Computed"],
    rows.map((r, i) => {
      const list = ((r.f.components as { list?: StoredComponent[] }).list ?? []);
      const byKey = new Map(list.map((c) => [c.key, c.finalScore]));
      return [
        i + 1,
        r.p.fullName,
        r.p.position,
        r.p.shootsCatches ?? "",
        r.schoolName ?? "",
        r.p.classYear,
        r.p.nhlDraftStatus,
        r.f.overallScore,
        r.f.confidence ?? "",
        ...FIT_COMPONENT_KEYS.map((k) => byKey.get(k) ?? ""),
        ((r.f.explanation as { warnings?: string[] }).warnings ?? []).join("; "),
        r.f.modelVersion,
        r.f.computedAt.toISOString(),
      ];
    }),
  );
  const meta = `# RosterIQ prospect-fit export,org=${ctx.org.name},need=${need.name},generated=${new Date().toISOString()}\r\n`;
  return csvResponse(`fit-${need.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, meta + csv);
}
