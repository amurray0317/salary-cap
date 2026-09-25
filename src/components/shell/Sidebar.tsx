"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { NAV, activeHref } from "@/components/shell/nav";

const STORE_COLLAPSED = "riq_nav_collapsed";
const STORE_OPEN = "riq_nav_open";

/** Phone tab bar: the pages used most on the go. */
const TABS = [
  { href: "/scores", label: "Scores", icon: "◷" },
  { href: "/standings", label: "Standings", icon: "≡" },
  { href: "/real-data/prospects", label: "Prospects", icon: "✚" },
  { href: "/players", label: "Players", icon: "▤" },
];

export function Sidebar() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const owner = NAV.find((s) => s.groups.some((g) => g.items.some((i) => i.href === current)))?.id;
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Phones and small tablets: the sidebar is a drawer behind a menu button.
  const [mobileOpen, setMobileOpen] = useState(false);
  const compact = collapsed && !mobileOpen;

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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
    <>
      {/* Phones: bottom tab bar; the drawer (Menu) holds everything else. */}
      <nav
        aria-label="Quick"
        className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-nav-from/95 pb-[env(safe-area-inset-bottom)] text-nav-ink backdrop-blur lg:hidden"
      >
        {TABS.map((t) => {
          const active = current === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${active ? "text-ice-bright" : "text-nav-muted"}`}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden className="text-lg leading-none">{`${t.icon}\uFE0E`}</span>
              {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-nav-muted"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <span aria-hidden className="text-lg leading-none">
            ☰
          </span>
          Menu
        </button>
      </nav>
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-30 bg-nav-from/50 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex h-screen w-72 shrink-0 flex-col bg-linear-to-b from-nav-from to-nav-to text-nav-ink shadow-[4px_0_24px_-12px_rgba(30,27,75,0.5)] transition-[transform,width] lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${compact ? "lg:w-14" : "lg:w-64"}`}
      >
        <div className="flex items-center gap-2.5 px-4 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <span
            className="inline-block h-7 w-7 shrink-0 rounded-lg bg-linear-to-br from-ice-bright to-accent shadow-[0_0_16px_rgba(56,189,248,0.45)]"
            aria-hidden
          />
          {!compact && <span className="font-display text-lg font-extrabold tracking-tight text-white">RosterIQ</span>}
          {mobileOpen && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="ml-auto rounded-md px-2 py-1 text-nav-muted hover:bg-white/10 hover:text-white lg:hidden"
              aria-label="Close navigation"
            >
              ✕
            </button>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Primary">
          {NAV.map((section, si) => {
            const areaStart = si === 0 || NAV[si - 1]!.area !== section.area;
            const heading =
              areaStart && !compact ? (
                <div className="px-2.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-nav-heading">{section.area}</div>
              ) : areaStart && si > 0 ? (
                <div className="mx-2 my-1.5 border-t border-white/10" aria-hidden />
              ) : null;
            const first = section.groups.flatMap((g) => g.items).find((i) => i.href)?.href;
            const here = section.id === owner;
            if (compact) {
              const cls = `flex items-center justify-center rounded-md px-2.5 py-2 text-sm ${here ? "bg-ice-bright text-ink" : "text-nav-ink/85 hover:bg-white/10 hover:text-white"}`;
              return (
                <Fragment key={section.id}>
                  {heading}
                  {first ? (
                    <Link href={first} title={section.label} className={cls} aria-current={here ? "page" : undefined}>
                      <span aria-hidden>{`${section.icon}\uFE0E`}</span>
                      <span className="sr-only">{section.label}</span>
                    </Link>
                  ) : (
                    <span title={`${section.label} (planned)`} className={`${cls} opacity-40`}>
                      <span aria-hidden>{`${section.icon}\uFE0E`}</span>
                    </span>
                  )}
                </Fragment>
              );
            }
            const expanded = isOpen(section.id);
            return (
              <Fragment key={section.id}>
                {heading}
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={expanded}
                    aria-controls={`nav-${section.id}`}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${here ? "bg-white/10 text-white" : "text-nav-ink/90 hover:bg-white/10 hover:text-white"}`}
                  >
                    <span aria-hidden className="w-4 text-center">
                      {`${section.icon}\uFE0E`}
                    </span>
                    <span className="flex-1 font-semibold">{section.label}</span>
                    <span aria-hidden className="text-xs text-nav-muted">
                      {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {expanded && (
                    <div id={`nav-${section.id}`} className="mb-1 ml-5 border-l border-white/15 pl-2">
                      {section.groups.map((group, gi) => (
                        <div key={group.label ?? gi} className="py-0.5">
                          {group.label && (
                            <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-nav-muted">{group.label}</div>
                          )}
                          {group.items.map((item) =>
                            item.href ? (
                              <Link
                                key={item.label}
                                href={item.href}
                                className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                                  item.href === current
                                    ? "bg-ice-bright font-semibold text-ink"
                                    : "text-nav-ink/85 hover:bg-white/10 hover:text-white"
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
                                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-nav-muted"
                              >
                                {item.label}
                                <span className="ml-2 rounded bg-white/10 px-1 text-[9px] font-semibold uppercase tracking-wider">planned</span>
                              </span>
                            ),
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        </nav>
        <button
          onClick={toggleCollapsed}
          className="m-2 hidden rounded-md lg:block px-2.5 py-2 text-left text-sm text-nav-muted hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? "»" : "« Collapse"}
        </button>
      </aside>
    </>
  );
}
