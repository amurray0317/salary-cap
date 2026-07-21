import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { uploadImportAction } from "@/server/actions/importActions";
import { UploadImportForm } from "@/components/ImportForms";
import { Card, Td, Th } from "@/components/ui";
import { IMPORT_DEFINITIONS, IMPORT_TYPES } from "@/lib/import/definitions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Data imports" };

const STATUS_LABELS: Record<string, string> = {
  pending: "Needs mapping",
  validating: "Validating",
  awaiting_approval: "Awaiting approval",
  committed: "Committed",
  rejected: "Rejected",
  failed: "Failed",
};

export default async function ImportsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.imports)
    .where(eq(schema.imports.organizationId, ctx.org.id))
    .orderBy(desc(schema.imports.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Data imports</h1>
        <p className="text-sm text-ink-muted">
          Upload CSV files, map columns, review row-level validation, and explicitly approve
          before anything is written. Invalid rows are never committed.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New import">
          <UploadImportForm
            action={uploadImportAction}
            organizationId={ctx.org.id}
            types={IMPORT_TYPES.map((t) => ({ value: t, label: IMPORT_DEFINITIONS[t].label }))}
          />
        </Card>
        <Card title="Templates">
          <p className="mb-3 text-sm text-ink-muted">
            Download a template with the expected columns and example rows:
          </p>
          <ul className="space-y-2 text-sm">
            {IMPORT_TYPES.map((t) => (
              <li key={t}>
                <a href={`/api/import-templates/${t}`} className="text-accent-text hover:underline">
                  {IMPORT_DEFINITIONS[t].label} template →
                </a>
                <p className="text-xs text-ink-muted">{IMPORT_DEFINITIONS[t].description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Import history">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No imports yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>File</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th right>Rows</Th>
                <Th right>Committed</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td>
                    <Link href={`/imports/${r.id}`} className="font-medium hover:text-accent-text">
                      {r.fileName}
                    </Link>
                  </Td>
                  <Td className="text-ink-secondary">{r.importType}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        r.status === "committed"
                          ? "bg-good/10 text-good"
                          : r.status === "rejected" || r.status === "failed"
                            ? "bg-critical/10 text-critical"
                            : "bg-navy-800 text-ink-secondary"
                      }`}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </Td>
                  <Td right>{r.rowCount}</Td>
                  <Td right>{r.status === "committed" ? r.committedCount : "—"}</Td>
                  <Td className="text-ink-secondary">{formatDate(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
