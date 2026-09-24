"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Re-renders the current server page every `seconds` while `active` and the
 * tab is visible (hidden tabs do not poll). Shows when it last refreshed.
 */
export function AutoRefresh({ active, seconds = 30 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  const [last, setLast] = useState<Date | null>(null);

  useEffect(() => {
    setLast(new Date());
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLast(new Date());
      }
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [active, seconds, router]);

  return (
    <span className="text-xs text-ink-muted" aria-live="polite">
      {active ? `Live · refreshes every ${seconds}s` : "No games in progress"}
      {last && ` · updated ${last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`}
    </span>
  );
}
