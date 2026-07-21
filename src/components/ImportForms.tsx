"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/importActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
      {error}
    </p>
  );
}

export function UploadImportForm({
  action,
  organizationId,
  types,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  types: Array<{ value: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="imp-type">Import type</label>
          <select id="imp-type" name="importType" className={input}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="imp-file">CSV file (max 1 MB, 2000 rows)</label>
          <input id="imp-file" name="file" type="file" accept=".csv,text/csv" required className={input} />
        </div>
      </div>
      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Uploading…" : "Upload & continue to mapping"}
      </button>
    </form>
  );
}

export function MappingForm({
  action,
  organizationId,
  importId,
  importType,
  headers,
  fields,
  initialMapping,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  importId: string;
  importType: string;
  headers: string[];
  fields: Array<{ key: string; label: string; required: boolean; description: string }>;
  initialMapping: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="importType" value={importType} />
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.key} className="grid grid-cols-[1fr_1fr] items-center gap-3">
            <div>
              <span className="text-sm text-ink">
                {f.label}
                {f.required && <span className="text-critical"> *</span>}
              </span>
              <p className="text-xs text-ink-muted">{f.description}</p>
            </div>
            <div>
              <label className="sr-only" htmlFor={`map-${f.key}`}>CSV column for {f.label}</label>
              <select
                id={`map-${f.key}`}
                name={`map_${f.key}`}
                defaultValue={initialMapping[f.key] ?? ""}
                className={input}
              >
                <option value="">— not mapped —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Validating…" : "Validate rows"}
      </button>
    </form>
  );
}

export function ApproveImportForm({
  action,
  organizationId,
  importId,
  validCount,
  errorCount,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  importId: string;
  validCount: number;
  errorCount: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="importId" value={importId} />
      <input type="hidden" name="confirm" value="yes" />
      <ErrorNote error={state.error} />
      <button
        disabled={pending || validCount === 0}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {pending
          ? "Committing…"
          : `Approve & commit ${validCount} valid row${validCount === 1 ? "" : "s"}`}
      </button>
      {errorCount > 0 && (
        <p className="text-xs text-warn">
          ⚠ {errorCount} row{errorCount === 1 ? "" : "s"} with errors will NOT be committed.
        </p>
      )}
    </form>
  );
}
