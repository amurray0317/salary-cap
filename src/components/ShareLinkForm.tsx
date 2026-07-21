"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/reportActions";

export function CreateShareLinkForm({
  action,
  organizationId,
  teamId,
  seasonId,
  teamName,
  seasonName,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  teamId: string;
  seasonId: string;
  teamName: string;
  seasonName: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="seasonId" value={seasonId} />
      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Generating…" : `Create share link (${teamName}, ${seasonName})`}
      </button>
      <p className="text-xs text-ink-muted">
        Creates a frozen snapshot of the current cap report and a private URL anyone can view
        without signing in. Revoke it any time; the snapshot never updates.
      </p>
    </form>
  );
}
