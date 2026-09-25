"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/profile", label: "Profile" },
  { href: "/profile/account", label: "Account & security" },
  { href: "/profile/notifications", label: "Notifications" },
  { href: "/profile/preferences", label: "Preferences" },
];

export function ProfileTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Profile sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${active ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
