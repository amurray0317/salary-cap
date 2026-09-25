/** Sign-in and registration: brand panel on large screens, form on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-linear-to-br from-nav-from to-nav-to p-12 text-nav-ink lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-ice-bright/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-accent/40 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="inline-block h-8 w-8 rounded-lg bg-linear-to-br from-ice-bright to-accent shadow-[0_0_20px_rgba(56,189,248,0.5)]" aria-hidden />
          <span className="font-display text-xl font-extrabold tracking-tight text-white">RosterIQ</span>
        </div>
        <div className="relative max-w-md">
          <p className="font-display text-4xl font-extrabold leading-tight tracking-tight text-white">Hockey operations, measured.</p>
          <ul className="mt-8 space-y-4 text-sm">
            <li>
              <span className="font-semibold text-white">Expected goals</span> built from NHL play-by-play and tested against MoneyPuck on a season it never saw.
            </li>
            <li>
              <span className="font-semibold text-white">Prospect model</span> checked on held-out drafts against draft order and NHL Central Scouting.
            </li>
            <li>
              <span className="font-semibold text-white">Cap, scouting and league data</span> in one place, every number with its source.
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-nav-muted">Data: NHL.com, MoneyPuck.com, league stats feeds. Personal, non-commercial use.</p>
      </aside>
      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}
