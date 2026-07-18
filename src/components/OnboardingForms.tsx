"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/server/actions/orgActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
      {error}
    </p>
  );
}

export function CreateOrgForm({
  action,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className={label} htmlFor="org-name">Organization name</label>
        <input id="org-name" name="name" required minLength={2} className={input} placeholder="e.g. Aurora Ridge Hockey Club" />
      </div>
      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

export function CreateTeamForm({
  action,
  organizationId,
  leagues,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  leagues: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? "__new__");
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="team-name">Team name</label>
          <input id="team-name" name="name" required minLength={2} className={input} placeholder="e.g. Aurora Wolfpack" />
        </div>
        <div>
          <label className={label} htmlFor="team-abbr">Abbreviation</label>
          <input id="team-abbr" name="abbreviation" required minLength={2} maxLength={5} className={input} placeholder="AUR" />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="team-city">City (optional)</label>
        <input id="team-city" name="city" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="team-league">League</label>
        <select
          id="team-league"
          name="leagueId"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          className={input}
        >
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
          <option value="__new__">Create a new league…</option>
        </select>
      </div>
      {leagueId === "__new__" && (
        <fieldset className="space-y-4 rounded-md border border-line p-4">
          <legend className="px-1 text-sm text-ink-secondary">New league (NHL-style annual cap)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="league-name">League name</label>
              <input id="league-name" name="leagueName" className={input} placeholder="e.g. Boreal Hockey League" />
            </div>
            <div>
              <label className={label} htmlFor="league-abbr">Abbreviation</label>
              <input id="league-abbr" name="leagueAbbr" className={input} placeholder="BHL" />
            </div>
            <div>
              <label className={label} htmlFor="cap-y1">Cap upper limit, year 1 ($)</label>
              <input id="cap-y1" name="capYear1" type="number" min={1_000_000} step={100_000} defaultValue={88_000_000} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="cap-growth">Cap growth per season (%)</label>
              <input id="cap-growth" name="capGrowthPct" type="number" min={0} max={25} step={0.5} defaultValue={4} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="floor-pct">Salary floor (% of cap)</label>
              <input id="floor-pct" name="floorPct" type="number" min={0} max={100} step={1} defaultValue={74} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="min-salary">League minimum salary ($)</label>
              <input id="min-salary" name="minSalary" type="number" min={0} step={25_000} defaultValue={800_000} className={input} />
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            Creates four seasons of versioned rules (cap, floor, roster limits, contract slots).
            Every value can be edited later under League rules.
          </p>
        </fieldset>
      )}
      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create team"}
      </button>
    </form>
  );
}
