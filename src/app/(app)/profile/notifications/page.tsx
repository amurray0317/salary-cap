import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { saveNotificationsAction } from "@/server/actions/profileActions";
import { NOTIFICATION_TOPICS } from "@/lib/preferences";
import { Notice } from "@/components/Notice";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const current = ctx.user.preferences.notifications;
  return (
    <div className="space-y-5">
      <Notice saved={sp.saved} error={sp.error} />
      <Card title="What to tell you about">
        <form action={saveNotificationsAction} className="space-y-1">
          {NOTIFICATION_TOPICS.map((t) => (
            <label key={t.key} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle">
              <input type="checkbox" name={t.key} defaultChecked={current[t.key]} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
              <span>
                <span className="block text-sm font-semibold text-ink">{t.label}</span>
                <span className="block text-xs text-ink-muted">{t.hint}</span>
              </span>
            </label>
          ))}
          <div className="pt-3">
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Save choices</button>
          </div>
        </form>
      </Card>
      <Card title="Delivery">
        <p className="text-sm text-ink-secondary">
          Notifications will appear in the app (a bell next to your photo) when alerts ship; it is next in the feature queue. These choices are saved
          now and apply from then. Email and phone push need a hosted deployment with a mail provider; they will be added here as options at that
          point.
        </p>
      </Card>
    </div>
  );
}
