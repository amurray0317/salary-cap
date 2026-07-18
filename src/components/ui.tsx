import Link from "next/link";
import { money, moneyCompact } from "@/lib/format";
import type { CapViolation } from "@/lib/engine/types";

export function Card({
  title,
  children,
  action,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-navy-900 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-medium text-ink-secondary">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warn" | "critical";
}) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "critical" ? "text-critical" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-navy-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {detail && <div className="mt-0.5 text-xs text-ink-muted">{detail}</div>}
    </div>
  );
}

/**
 * Single-series meter: accent fill on a muted track, with the limit as the
 * track end. Value label always rendered as text (never color-alone).
 */
export function CapMeter({
  label,
  value,
  limit,
  sublabel,
}: {
  label: string;
  value: number;
  limit: number;
  sublabel?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : 0;
  const over = limit > 0 && value > limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-secondary">{label}</span>
        <span className="tabular-nums text-ink">
          {moneyCompact(value)} <span className="text-ink-muted">/ {moneyCompact(limit)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded bg-navy-800" role="img" aria-label={`${label}: ${money(value)} of ${money(limit)}`}>
        <div
          className={`h-full rounded ${over ? "bg-critical" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {sublabel && <div className="mt-1 text-xs text-ink-muted">{sublabel}</div>}
    </div>
  );
}

const SEVERITY_META: Record<CapViolation["severity"], { label: string; icon: string; cls: string }> = {
  blocking: { label: "Blocking", icon: "⛔", cls: "border-critical/40 bg-critical/10 text-critical" },
  requires_review: { label: "Requires review", icon: "⚑", cls: "border-warn/40 bg-warn/10 text-warn" },
  warning: { label: "Warning", icon: "⚠", cls: "border-warn/40 bg-warn/10 text-warn" },
  info: { label: "Info", icon: "ℹ", cls: "border-line bg-navy-850 text-ink-secondary" },
};

export function ViolationList({ items, emptyText = "No violations." }: { items: CapViolation[]; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((v, i) => {
        const meta = SEVERITY_META[v.severity];
        return (
          <li key={i} className={`rounded-md border px-3 py-2 text-sm ${meta.cls}`}>
            <span className="mr-1.5" aria-hidden>{meta.icon}</span>
            <span className="font-medium">{meta.label}:</span> <span className="text-ink">{v.message}</span>
            {v.recommendedResolution && (
              <div className="mt-1 text-xs text-ink-muted">Suggested: {v.recommendedResolution}</div>
            )}
            <div className="mt-0.5 text-xs text-ink-muted">
              Rule {v.ruleKey}
              {v.ruleVersion !== undefined ? ` · v${v.ruleVersion}` : ""}
              {v.effectiveDate ? ` · effective ${v.effectiveDate}` : ""}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <h3 className="font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export const thCls = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted";
export const tdCls = "px-3 py-2 text-sm";

export function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`${thCls} ${right ? "text-right" : ""}`}>{children}</th>;
}

export function Td({ children, right = false, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`${tdCls} ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>;
}
