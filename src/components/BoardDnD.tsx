"use client";

/**
 * Drag-and-drop ranking list (native HTML5 DnD with ↑/↓ keyboard fallback).
 * Reordering is local until "Save new order" posts the full ordered id list
 * to the server action, which records it as one versioned change.
 */
import { useActionState, useState } from "react";
import type { FormState } from "@/server/actions/boardActions";

export interface DnDItem {
  id: string; // prospect id (draft board) or entry id (CFA board)
  label: string;
  detail?: string;
}

export function BoardDnD({
  action,
  organizationId,
  boardId,
  items: initialItems,
  withReason,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  boardId: string;
  items: DnDItem[];
  withReason?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [state, formAction, pending] = useActionState(action, {});

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setItems(next);
  };

  const dirty = items.some((item, i) => item.id !== initialItems[i]?.id);

  return (
    <div className="space-y-2">
      <ol className="space-y-1" aria-label="Drag to reorder">
        {items.map((item, i) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={`flex cursor-grab items-center gap-3 rounded-md border px-3 py-1.5 text-sm ${
              overIndex === i && dragIndex !== null && dragIndex !== i ? "border-accent bg-accent-soft" : "border-line"
            } ${dragIndex === i ? "opacity-50" : ""}`}
          >
            <span aria-hidden className="text-ink-muted">⠿</span>
            <span className="w-8 text-right font-medium tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              {item.label}
              {item.detail && <span className="ml-2 text-xs text-ink-muted">{item.detail}</span>}
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                aria-label={`Move ${item.label} up`}
                className="rounded border border-line px-1.5 text-xs text-ink-secondary hover:text-ink"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                aria-label={`Move ${item.label} down`}
                className="rounded border border-line px-1.5 text-xs text-ink-secondary hover:text-ink"
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="boardId" value={boardId} />
        <input type="hidden" name="order" value={items.map((x) => x.id).join(",")} />
        {withReason && (
          <input
            name="reason"
            placeholder="Reason for the change (optional, kept in history)"
            maxLength={300}
            className="w-72 rounded-md border border-line bg-navy-950 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
        )}
        <button
          disabled={pending || !dirty}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : dirty ? "Save new order" : "Order unchanged"}
        </button>
        {state.error && <span className="text-sm text-critical">{state.error}</span>}
      </form>
    </div>
  );
}
