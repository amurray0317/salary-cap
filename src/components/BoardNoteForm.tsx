"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/boardActions";

export function BoardNoteForm({
  action,
  organizationId,
  boardKind,
  boardId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  boardKind: "draft" | "college_free_agent";
  boardId: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="boardKind" value={boardKind} />
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="note"
        required
        maxLength={2000}
        placeholder="Add a meeting note…"
        aria-label="Meeting note"
        className="min-w-72 flex-1 rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Saving…" : "Add note"}
      </button>
      {state.error && <span className="text-sm text-critical">{state.error}</span>}
    </form>
  );
}
