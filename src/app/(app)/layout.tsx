import { Sidebar } from "@/components/shell/Sidebar";
import { ContextSelect } from "@/components/shell/ContextSelect";
import { resolveAppContext } from "@/server/appContext";
import { setContextAction } from "@/server/actions/contextActions";
import { ProfileMenu } from "@/components/shell/ProfileMenu";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { avatarUrl } from "@/components/Avatar";
import { roleLabel } from "@/lib/auth/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await resolveAppContext();

  return (
    <div className="flex min-h-screen" data-density={ctx.user.preferences.density}>
      <Sidebar program={ctx.org.program} />
      <TimeZoneSync current={ctx.deviceTimeZone} />
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
          <ProfileMenu
            name={ctx.user.fullName}
            email={ctx.user.email}
            jobTitle={ctx.user.jobTitle}
            role={roleLabel(ctx.role)}
            orgName={ctx.org.name}
            avatarSrc={avatarUrl(ctx.user)}
          />
        </header>
        <main className="mx-auto max-w-[1600px] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
