import Link from "next/link";

const TABS = [
  { href: "/real-data", label: "Connectors" },
  { href: "/real-data/players", label: "Players & stats" },
  { href: "/real-data/draft", label: "Draft" },
  { href: "/real-data/teams", label: "Teams" },
];

export default function RealDataLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <nav className="no-print flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Real data">
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
      <footer className="border-t border-line pt-3 text-xs text-ink-muted">
        Real-world reference data is imported on demand through the gated import pipeline and is kept
        separate from your organization&rsquo;s official roster and cap records. Sources: NHL.com public
        API (incl. NHL Central Scouting rankings) · Data: MoneyPuck.com · EliteProspects official API
        (when configured). Blank cells mean the source did not report a value — nothing is estimated.
      </footer>
    </div>
  );
}
