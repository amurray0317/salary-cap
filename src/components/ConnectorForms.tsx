"use client";

import { useActionState } from "react";
import type { ConnectorFormState } from "@/server/actions/connectorActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-sm text-ink-secondary";

export type ConnectorField =
  | { name: string; label: string; type: "text"; placeholder?: string; defaultValue?: string; hint?: string }
  | { name: string; label: string; type: "textarea"; placeholder?: string; hint?: string }
  | { name: string; label: string; type: "select"; options: Array<{ value: string; label: string }>; defaultValue?: string }
  | { name: string; label: string; type: "checkboxes"; options: Array<{ value: string; label: string }>; defaultValues: string[] };

export function ConnectorForm({
  action,
  organizationId,
  dataset,
  fields,
  submitLabel,
  disabled = false,
}: {
  action: (prev: ConnectorFormState, fd: FormData) => Promise<ConnectorFormState>;
  organizationId: string;
  dataset: string;
  fields: ConnectorField[];
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const idp = `cf-${dataset}`;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="dataset" value={dataset} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${idp}-${f.name}`;
          if (f.type === "checkboxes") {
            return (
              <fieldset key={f.name} className="sm:col-span-2">
                <legend className={labelCls}>{f.label}</legend>
                <div className="flex flex-wrap gap-3">
                  {f.options.map((o) => (
                    <label key={o.value} className="flex items-center gap-1.5 text-sm text-ink-secondary">
                      <input type="checkbox" name={f.name} value={o.value} defaultChecked={f.defaultValues.includes(o.value)} disabled={disabled} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
              <label className={labelCls} htmlFor={id}>{f.label}</label>
              {f.type === "select" ? (
                <select id={id} name={f.name} defaultValue={f.defaultValue} className={input} disabled={disabled}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={id} name={f.name} rows={2} placeholder={f.placeholder} className={input} disabled={disabled} />
              ) : (
                <input id={id} name={f.name} placeholder={f.placeholder} defaultValue={f.defaultValue} className={input} disabled={disabled} />
              )}
              {"hint" in f && f.hint && <p className="mt-1 text-xs text-ink-muted">{f.hint}</p>}
            </div>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <input type="checkbox" name="bypassCache" disabled={disabled} /> Bypass cache (refetch from the source; still rate-limited)
      </label>
      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button
        disabled={pending || disabled}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Fetching…" : submitLabel}
      </button>
    </form>
  );
}
