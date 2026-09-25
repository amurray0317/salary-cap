import Link from "next/link";
import { Sidebar } from "@/components/shell/Sidebar";
import { ContextSelect } from "@/components/shell/ContextSelect";
import { resolveAppContext } from "@/server/appContext";
import { setContextAction } from "@/server/actions/contextActions";
import { logoutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await resolveAppContext();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] shadow-[0_1px_0_rgba(16,24,40,0.02)] backdrop-blur lg:px-5">
          <ContextSelect
            name="org"
            label="Organization"
            value={ctx.org.id}
            action={setContextAction}
            options={ctx.memberships.map((m) => ({ id: m.organizationId, label: m.organizationName }))}
          />
          {ctx.teams.length > 0 && ctx.team && (
            <ContextSelect
              name="team"
              label="Team"
              value={ctx.team.id}
              action={setContextAction}
              options={ctx.teams.map((t) => ({ id: t.id, label: t.name }))}
            />
          )}
          {ctx.seasons.length > 0 && ctx.season && (
            <ContextSelect
              name="season"
              label="Season"
              value={ctx.season.id}
              action={setContextAction}
              options={ctx.seasons.map((s) => ({ id: s.id, label: s.name }))}
            />
          )}
          <form action="/players" method="get" className="ml-auto hidden md:block" role="search">
            <label className="sr-only" htmlFor="global-search">
              Search players
            </label>
            <input
              id="global-search"
              name="q"
              placeholder="Search players…"
              className="w-52 rounded-md border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
          </form>
          <span className="ml-2 hidden text-sm text-ink-muted lg:inline" title={ctx.user.email}>
            {ctx.user.fullName}
            <span className="ml-1 rounded bg-track px-1.5 py-0.5 text-xs">{ctx.role.replace(/_/g, " ")}</span>
          </span>
          <Link href="/settings" className="hidden text-sm text-ink-muted hover:text-ink sm:inline">
            Settings
          </Link>
          <form action={logoutAction}>
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Sign out</button>
          </form>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
