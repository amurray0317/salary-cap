import type { Metadata } from "next";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { changePasswordAction, signOutOthersAction } from "@/server/actions/profileActions";
import { logoutAction } from "@/server/actions/auth";
import { Notice } from "@/components/Notice";
import { Card } from "@/components/ui";
import { roleLabel } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Account & security" };

const input = "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const sessions = await getDb()
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, ctx.user.id), gt(schema.sessions.expiresAt, new Date())));
  return (
    <div className="space-y-5">
      <Notice saved={sp.saved} error={sp.error} />
      <Card title="Change password">
        <form action={changePasswordAction} className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-ink-secondary">
            Current password
            <input name="current" type="password" required autoComplete="current-password" className={input} />
          </label>
          <label className="text-sm font-medium text-ink-secondary">
            New password (8+ characters)
            <input name="next" type="password" required minLength={8} maxLength={200} autoComplete="new-password" className={input} />
          </label>
          <label className="text-sm font-medium text-ink-secondary">
            Confirm new password
            <input name="confirm" type="password" required minLength={8} maxLength={200} autoComplete="new-password" className={input} />
          </label>
          <div className="sm:col-span-3">
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Change password</button>
            <span className="ml-3 text-xs text-ink-muted">Other devices are signed out when the password changes.</span>
          </div>
        </form>
      </Card>
      <Card title="Sessions">
        <p className="text-sm text-ink-secondary">
          You are signed in on <strong>{sessions.length}</strong> device{sessions.length === 1 ? "" : "s"} or browser
          {sessions.length === 1 ? "" : "s"} (sessions last 14 days).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={signOutOthersAction}>
            <button
              disabled={sessions.length < 2}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              Sign out everywhere else
            </button>
          </form>
          <form action={logoutAction}>
            <button className="rounded-md border border-critical/40 px-3 py-1.5 text-sm font-semibold text-critical hover:bg-critical/10">
              Sign out
            </button>
          </form>
        </div>
      </Card>
      <Card title="Organizations">
        <ul className="divide-y divide-line/60 text-sm">
          {ctx.memberships.map((m) => (
            <li key={m.organizationId} className="flex items-center justify-between py-2">
              <span className="font-medium">{m.organizationName}</span>
              <span className="rounded bg-track px-2 py-0.5 text-xs font-semibold text-ink-secondary">{roleLabel(m.role)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">Roles are set by each organization&apos;s admins in Organization settings.</p>
      </Card>
    </div>
  );
}
