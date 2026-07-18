"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Cap dashboard", icon: "▦" },
  { href: "/players", label: "Players", icon: "▤" },
  { href: "/contracts", label: "Contracts", icon: "▧" },
  { href: "/scenarios", label: "Scenarios", icon: "⑃" },
  { href: "/valuation", label: "Valuation", icon: "◈" },
  { href: "/transactions", label: "Transactions", icon: "⇄" },
  { href: "/rules", label: "League rules", icon: "§" },
  { href: "/reports", label: "Reports", icon: "⎙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("riq_nav_collapsed") === "1");
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem("riq_nav_collapsed", next ? "1" : "0");
  };

  return (
    <aside
      className={`no-print sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-navy-900 transition-[width] ${collapsed ? "w-14" : "w-56"}`}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="inline-block h-6 w-6 shrink-0 rounded bg-accent" aria-hidden />
        {!collapsed && <span className="font-semibold tracking-tight">RosterIQ</span>}
      </div>
      <nav className="flex-1 space-y-0.5 px-2" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                active
                  ? "bg-accent-soft text-accent-text"
                  : "text-ink-secondary hover:bg-navy-850 hover:text-ink"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden className="w-4 text-center">
                {item.icon}
              </span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={toggle}
        className="m-2 rounded-md px-2.5 py-2 text-left text-sm text-ink-muted hover:bg-navy-850 hover:text-ink"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? "»" : "« Collapse"}
      </button>
    </aside>
  );
}
