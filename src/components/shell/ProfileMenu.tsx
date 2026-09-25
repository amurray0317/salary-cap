"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { logoutAction } from "@/server/actions/auth";

const LINKS = [
  { href: "/profile", label: "Profile" },
  { href: "/profile/account", label: "Account & security" },
  { href: "/profile/notifications", label: "Notifications" },
  { href: "/profile/preferences", label: "Preferences" },
  { href: "/settings", label: "Organization settings" },
  { href: "/settings/billing", label: "Plan & billing" },
];

/** Top-right account menu: photo or initials; opens profile links and Sign out. */
export function ProfileMenu(props: {
  name: string;
  email: string;
  jobTitle: string | null;
  role: string;
  orgName: string;
  avatarSrc: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto md:ml-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition hover:bg-track lg:pr-2.5"
      >
        <Avatar name={props.name} src={props.avatarSrc} size={34} className="shadow-sm" />
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-semibold text-ink">{props.name}</span>
          <span className="block text-[11px] text-ink-muted">{props.role}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_40px_-12px_rgba(30,27,75,0.35)]"
        >
          <div className="flex items-center gap-3 bg-linear-to-br from-nav-from to-nav-to px-4 py-4 text-white">
            <Avatar name={props.name} src={props.avatarSrc} size={48} />
            <div className="min-w-0">
              <div className="truncate font-display font-bold">{props.name}</div>
              <div className="truncate text-xs text-nav-muted">{props.jobTitle || props.email}</div>
              <div className="mt-1 inline-block rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                {props.role} · {props.orgName}
              </div>
            </div>
          </div>
          <nav className="py-1.5">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                role="menuitem"
                href={l.href}
                className={`block px-4 py-2 text-sm hover:bg-subtle ${pathname === l.href ? "font-semibold text-accent-text" : "text-ink"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="border-t border-line p-1.5">
            <button role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-critical hover:bg-subtle">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
