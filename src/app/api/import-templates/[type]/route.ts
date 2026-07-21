import { resolveApiContext } from "@/server/apiContext";
import { buildTemplateCsv, isImportType } from "@/lib/import/definitions";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  const ctx = await resolveApiContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { type } = await params;
  if (!isImportType(type)) return new Response("Unknown template", { status: 404 });
  const template = buildTemplateCsv(type);
  return csvResponse(template.filename, toCsv(template.headers, template.rows));
}
