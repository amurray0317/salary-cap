import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { getImportDetail, ImportError } from "@/server/services/importService";
import {
  applyMappingAction,
  approveImportAction,
  rejectImportAction,
} from "@/server/actions/importActions";
import { ApproveImportForm, MappingForm } from "@/components/ImportForms";
import { Card, Td, Th } from "@/components/ui";
import { IMPORT_DEFINITIONS, autoMapHeaders, type ImportType } from "@/lib/import/definitions";

export const metadata: Metadata = { title: "Import detail" };

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAppContext();
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getImportDetail>>;
  try {
    detail = await getImportDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ImportError) notFound();
    throw err;
  }
  const { row, raw, errors, preview, existingCount, sourceMeta, dataSource } = detail;
  const isConnector = row.sourceKind === "connector" && sourceMeta !== null;
  const importType = row.importType as ImportType;
  const def = IMPORT_DEFINITIONS[importType];
  const storedMapping = row.mapping as Record<string, string>;
  const mappingDefaults =
    Object.keys(storedMapping).length > 0 ? storedMapping : autoMapHeaders(importType, raw.headers);

  const previewValid = preview?.validRecords.slice(0, 10) ?? [];
  const mappedFieldKeys = def.fields.map((f) => f.key);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/imports" className="text-sm text-accent-text hover:underline">← All imports</Link>
          <h1 className="mt-1 text-xl font-semibold">
            {row.fileName} <span className="text-sm font-normal text-ink-muted">({def.label})</span>
          </h1>
          <p className="text-sm text-ink-muted">
            {row.rowCount} data rows · status: {row.status.replace(/_/g, " ")}
          </p>
        </div>
        {(row.status === "pending" || row.status === "awaiting_approval") && (
          <form action={rejectImportAction}>
            <input type="hidden" name="organizationId" value={ctx.org.id} />
            <input type="hidden" name="importId" value={row.id} />
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-critical hover:underline">
              Discard import
            </button>
          </form>
        )}
      </div>

      {row.status === "committed" && (
        <p className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          ✓ Committed {row.committedCount} of {row.rowCount} rows.{" "}
          {row.rowCount - row.committedCount > 0 &&
            `${row.rowCount - row.committedCount} row(s) were skipped due to validation errors (listed below).`}{" "}
          {isConnector ? (
            <>
              Reference data is now available under{" "}
              <Link href="/real-data/players" className="underline">Real data</Link>
              {dataSource ? ` (data source recorded: ${dataSource.name}).` : "."}
            </>
          ) : (
            <>Records are now live under {importType === "players" ? "Players" : "Contracts"}.</>
          )}
        </p>
      )}
      {row.status === "rejected" && (
        <p className="rounded-md border border-line bg-navy-850 px-3 py-2 text-sm text-ink-secondary">
          This import was discarded. Nothing was committed.
        </p>
      )}

      {isConnector && sourceMeta && (
        <Card title="Source & provenance">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink-muted">Source</dt>
            <dd className="font-medium">{sourceMeta.sourceName}</dd>
            <dt className="text-ink-muted">Request URL{sourceMeta.urls.length > 1 ? "s" : ""}</dt>
            <dd className="space-y-0.5">
              {sourceMeta.urls.map((u, i) => (
                <div key={u} className="break-all font-mono text-xs">
                  {u}{" "}
                  <span className="text-ink-muted">({sourceMeta.fromCache[i] ? "served from this organization's cache" : "fetched live"})</span>
                </div>
              ))}
            </dd>
            <dt className="text-ink-muted">Retrieved</dt>
            <dd>{sourceMeta.retrievedAt.replace("T", " ").slice(0, 19)} UTC</dd>
            <dt className="text-ink-muted">Effective season</dt>
            <dd>{sourceMeta.effectiveSeason ?? "—"}</dd>
            <dt className="text-ink-muted">Credit</dt>
            <dd>{sourceMeta.credit}</dd>
            <dt className="text-ink-muted">Terms</dt>
            <dd className="text-ink-secondary">{sourceMeta.termsNote}</dd>
          </dl>
          {sourceMeta.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              {sourceMeta.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            Columns were produced by the connector, so there is no field-mapping step. Blank cells are values the
            source did not report; they are stored as empty, never estimated.
          </p>
        </Card>
      )}

      {!isConnector && (row.status === "pending" || row.status === "awaiting_approval") && (
        <Card title={row.status === "pending" ? "Step 1 · Map CSV columns to fields" : "Field mapping (edit to re-validate)"}>
          <MappingForm
            action={applyMappingAction}
            organizationId={ctx.org.id}
            importId={row.id}
            importType={importType}
            headers={raw.headers}
            fields={def.fields.map((f) => ({
              key: f.key,
              label: f.label,
              required: f.required,
              description: f.description,
            }))}
            initialMapping={mappingDefaults}
          />
        </Card>
      )}

      {row.status === "awaiting_approval" && preview && (
        <>
          <div className={`grid gap-3 ${existingCount !== null ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
            <div className="rounded-lg border border-line bg-navy-900 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-ink-muted">Total rows</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{row.rowCount}</div>
            </div>
            <div className="rounded-lg border border-line bg-navy-900 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-ink-muted">Valid</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-good">{preview.validRecords.length}</div>
            </div>
            <div className="rounded-lg border border-line bg-navy-900 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-ink-muted">Rows with errors</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${errors.length > 0 ? "text-critical" : "text-ink"}`}>
                {new Set(errors.map((e) => e.rowNumber)).size}
              </div>
            </div>
            {existingCount !== null && (
              <div className="rounded-lg border border-line bg-navy-900 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-ink-muted">New / update existing</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {preview.validRecords.length - existingCount} / {existingCount}
                </div>
              </div>
            )}
          </div>

          <Card title={`Step 2 · Preview (first ${previewValid.length} valid rows)`}>
            {previewValid.length === 0 ? (
              <p className="text-sm text-critical">
                No rows passed validation. Fix the file or the mapping and re-validate.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <Th right>Row</Th>
                      {mappedFieldKeys.map((k) => (
                        <Th key={k}>{k}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewValid.map((rec) => (
                      <tr key={rec.rowNumber} className="border-b border-line/50 last:border-0">
                        <Td right className="text-ink-muted">{rec.rowNumber}</Td>
                        {mappedFieldKeys.map((k) => (
                          <Td key={k} className="max-w-40 truncate">{rec.values[k] || "—"}</Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Step 3 · Approve">
            <p className="mb-2 text-sm text-ink-muted">
              {isConnector ? (
                <>
                  Approving writes the {preview.validRecords.length} valid row
                  {preview.validRecords.length === 1 ? "" : "s"} to your organization&rsquo;s real-data
                  reference tables in one transaction (existing rows with the same natural key are
                  updated, not duplicated) and records a data-source entry with the provenance above.
                  Official roster and cap records are not touched. Rows with errors are never committed.
                  This step is audit-logged.
                </>
              ) : (
                <>
                  Approving writes the {preview.validRecords.length} valid row
                  {preview.validRecords.length === 1 ? "" : "s"} to your organization&rsquo;s official
                  records in one transaction. Rows with errors are never committed. This step is
                  audit-logged.
                </>
              )}
            </p>
            <ApproveImportForm
              action={approveImportAction}
              organizationId={ctx.org.id}
              importId={row.id}
              validCount={preview.validRecords.length}
              errorCount={new Set(errors.map((e) => e.rowNumber)).size}
            />
          </Card>
        </>
      )}

      {errors.length > 0 && (
        <Card title={`Row-level errors (${errors.length})`}>
          <div className="max-h-96 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-navy-900">
                <tr className="border-b border-line">
                  <Th right>Row</Th>
                  <Th>Column</Th>
                  <Th>Problem</Th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id} className="border-b border-line/50 last:border-0">
                    <Td right className="text-ink-muted">{e.rowNumber}</Td>
                    <Td className="font-mono text-xs">{e.columnName ?? "—"}</Td>
                    <Td className="text-sm text-critical">{e.message}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
