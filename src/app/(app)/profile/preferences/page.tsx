import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { savePreferencesAction } from "@/server/actions/profileActions";
import { START_PAGES, TIME_ZONES } from "@/lib/preferences";
import { Notice } from "@/components/Notice";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Preferences" };

const input = "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none";

function Choice({ name, value, current, label, hint }: { name: string; value: string; current: string; label: string; hint: string }) {
  return (
    <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50">
      <input type="radio" name={name} value={value} defaultChecked={current === value} className="mt-0.5 accent-[var(--color-accent)]" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

export default async function PreferencesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const p = ctx.user.preferences;
  return (
    <div className="space-y-5">
      <Notice saved={sp.saved} error={sp.error} />
      <form action={savePreferencesAction} className="space-y-5">
        <Card title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink-secondary">
              Start page after sign-in
              <select name="startPage" defaultValue={p.startPage} className={input}>
                {START_PAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-ink-secondary">
              Time zone for game times
              <select name="timeZone" defaultValue={p.timeZone} className={input}>
                {TIME_ZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>
        <Card title="Height & weight">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Choice name="units" value="imperial" current={p.units} label="Feet & pounds" hint={`6′1″, 195 lb — NHL and NCAA convention`} />
            <Choice
              name="units"
              value="metric"
              current={p.units}
              label="Centimetres & kilograms"
              hint="185 cm, 88 kg — European and IIHF convention"
            />
          </div>
        </Card>
        <Card title="Tables">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Choice name="density" value="compact" current={p.density} label="Compact" hint="More rows on screen" />
            <Choice name="density" value="comfortable" current={p.density} label="Comfortable" hint="Taller rows, easier to scan on a phone" />
          </div>
        </Card>
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Save preferences</button>
      </form>
    </div>
  );
}
