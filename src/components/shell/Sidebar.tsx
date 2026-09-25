"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV, activeHref } from "@/components/shell/nav";

const STORE_COLLAPSED = "riq_nav_collapsed";
const STORE_OPEN = "riq_nav_open";

export function Sidebar() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const owner = NAV.find((s) => s.groups.some((g) => g.items.some((i) => i.href === current)))?.id;
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORE_COLLAPSED) === "1");
      setOpen(JSON.parse(window.localStorage.getItem(STORE_OPEN) ?? "{}"));
    } catch {
      // Storage blocked or corrupt: defaults (expanded, only the current section open).
    }
  }, []);

  const save = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Not persisted; the in-memory state still applies.
    }
  };
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    save(STORE_COLLAPSED, collapsed ? "0" : "1");
  };
  const isOpen = (id: string) => open[id] ?? id === owner;
  const toggleSection = (id: string) => {
    const next = { ...open, [id]: !isOpen(id) };
    setOpen(next);
    save(STORE_OPEN, JSON.stringify(next));
  };

  return (
    <aside
      className={`no-print sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] ${collapsed ? "w-14" : "w-60"}`}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="inline-block h-6 w-6 shrink-0 rounded bg-linear-to-br from-ice-bright to-accent" aria-hidden />
        {!collapsed && <span className="font-semibold tracking-tight">RosterIQ</span>}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Primary">
        {NAV.map((section) => {
          const first = section.groups.flatMap((g) => g.items).find((i) => i.href)?.href;
          const here = section.id === owner;
          if (collapsed) {
            const cls = `flex items-center justify-center rounded-md px-2.5 py-2 text-sm ${here ? "bg-accent-soft text-accent-text" : "text-ink-secondary hover:bg-subtle hover:text-ink"}`;
            return first ? (
              <Link key={section.id} href={first} title={section.label} className={cls} aria-current={here ? "page" : undefined}>
                <span aria-hidden>{section.icon}</span>
                <span className="sr-only">{section.label}</span>
              </Link>
            ) : (
              <span key={section.id} title={`${section.label} (planned)`} className={`${cls} opacity-40`}>
                <span aria-hidden>{section.icon}</span>
              </span>
            );
          }
          const expanded = isOpen(section.id);
          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={expanded}
                aria-controls={`nav-${section.id}`}
                className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm ${here ? "text-ink" : "text-ink-secondary hover:bg-subtle hover:text-ink"}`}
              >
                <span aria-hidden className="w-4 text-center">
                  {section.icon}
                </span>
                <span className="flex-1 font-medium">{section.label}</span>
                <span aria-hidden className="text-xs text-ink-muted">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>
              {expanded && (
                <div id={`nav-${section.id}`} className="mb-1 ml-5 border-l border-line pl-2">
                  {section.groups.map((group, gi) => (
                    <div key={group.label ?? gi} className="py-0.5">
                      {group.label && group.label !== section.label && (
                        <div className="px-2 pb-0.5 pt-1.5 text-[11px] uppercase tracking-wide text-ink-muted">{group.label}</div>
                      )}
                      {group.label === section.label && (
                        <div className="px-2 pb-0.5 pt-1.5 text-[11px] uppercase tracking-wide text-ink-muted">{group.label}</div>
                      )}
                      {group.items.map((item) =>
                        item.href ? (
                          <Link
                            key={item.label}
                            href={item.href}
                            className={`block rounded-md px-2 py-1.5 text-sm ${
                              item.href === current ? "bg-accent-soft text-accent-text" : "text-ink-secondary hover:bg-subtle hover:text-ink"
                            }`}
                            aria-current={item.href === current ? "page" : undefined}
                          >
                            {item.label}
                          </Link>
                        ) : (
                          <span
                            key={item.label}
                            title={item.planned}
                            aria-disabled="true"
                            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-ink-muted/70"
                          >
                            {item.label}
                            <span className="ml-2 rounded bg-subtle px-1 text-[10px] uppercase tracking-wide">planned</span>
                          </span>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <button
        onClick={toggleCollapsed}
        className="m-2 rounded-md px-2.5 py-2 text-left text-sm text-ink-muted hover:bg-subtle hover:text-ink"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? "»" : "« Collapse"}
      </button>
    </aside>
  );
}
