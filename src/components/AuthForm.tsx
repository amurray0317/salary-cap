"use client";

import { useActionState } from "react";
import type { AuthFormState } from "@/server/actions/auth";

interface Field {
  name: string;
  label: string;
  type: string;
  autoComplete?: string;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden = {},
}: {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: Field[];
  submitLabel: string;
  /** Extra values sent with the form (e.g. an invite token or where to go next). */
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-sm text-ink-secondary">{f.label}</span>
          <input
            name={f.name}
            type={f.type}
            required
            autoComplete={f.autoComplete}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
      ))}
      {state.error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
