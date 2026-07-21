"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/scenarioActions";

export function ApplyScenarioForm({
  action,
  organizationId,
  scenarioId,
  disabled,
  disabledReason,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  scenarioId: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <input type="hidden" name="confirm" value="yes" />
      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      {disabled ? (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          ⚠ {disabledReason ?? "This scenario cannot be applied."}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          This permanently changes official rosters, contracts, and obligations, marks the
          scenario as applied (read-only), and records every move in the transaction log and
          audit history. This cannot be undone from the UI.
        </p>
      )}
      <button
        disabled={disabled || pending}
        className="rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Applying…" : "Confirm: apply to official roster"}
      </button>
    </form>
  );
}
