import Link from "next/link";
import { resolveAppContext } from "@/server/appContext";
import { roleHasCapability } from "@/lib/auth/roles";

const TABS = [
  { href: "/scouting", label: "Dashboard" },
  { href: "/scouting/players", label: "NCAA players" },
  { href: "/scouting/roles", label: "Role finder" },
  { href: "/scouting/fit", label: "Organizational fit" },
  { href: "/scouting/board", label: "Draft board" },
  { href: "/scouting/free-agents", label: "College FAs" },
  { href: "/scouting/watchlists", label: "Watchlists" },
  { href: "/scouting/assignments", label: "Assignments" },
  { href: "/scouting/reports", label: "Reports" },
  { href: "/scouting/models", label: "Model center" },
];

export default async function ScoutingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await resolveAppContext();
  if (!roleHasCapability(ctx.role, "view_scouting")) {
    return (
      <div className="rounded-lg border border-line bg-navy-900 px-6 py-12 text-center">
        <h1 className="font-medium">Amateur scouting is not available for your role</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ask an organization administrator to grant scouting access.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <nav className="no-print flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Amateur scouting">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-md px-2.5 py-1.5 text-sm text-ink-secondary hover:bg-navy-850 hover:text-ink"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
