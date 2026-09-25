"use client";

import { useActionState, useState } from "react";
import { createInviteAction, type InviteFormState } from "@/server/actions/inviteActions";

const input = "rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";

/** Create an invite link; the link is shown once, with a copy button. */
export function InviteForm({ organizationId, roles }: { organizationId: string; roles: Array<{ value: string; label: string }> }) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(createInviteAction, {});
  const [copied, setCopied] = useState(false);
  const url = state.link && typeof window !== "undefined" ? `${window.location.origin}${state.link}` : state.link;
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="text-xs text-ink-secondary">
          Role
          <select name="role" defaultValue="viewer" className={`mt-1 block ${input}`}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-secondary">
          Email (optional, locks the link to it)
          <input name="email" type="email" placeholder="name@example.com" className={`mt-1 block w-60 ${input}`} />
        </label>
        <label className="text-xs text-ink-secondary">
          Valid for
          <select name="days" defaultValue="7" className={`mt-1 block ${input}`}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <label className="text-xs text-ink-secondary">
          Uses
          <select name="maxUses" defaultValue="1" className={`mt-1 block ${input}`}>
            <option value="1">1 person</option>
            <option value="5">Up to 5</option>
            <option value="25">Up to 25</option>
          </select>
        </label>
        <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {pending ? "Creating…" : "Create invite link"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      {url && (
        <div className="rounded-lg border border-ice/40 bg-accent-soft/60 p-3">
          <div className="text-xs font-semibold text-ink-secondary">Send this link. It is shown only once.</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">{url}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
              className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium hover:border-accent"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {state.expiresAt && <div className="mt-1 text-xs text-ink-muted">Expires {new Date(state.expiresAt).toLocaleString()}</div>}
        </div>
      )}
    </div>
  );
}
