"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/playerActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

export function PlayerForm({
  action,
  organizationId,
  teams,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  teams: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div>
        <label className={label} htmlFor="p-name">Full name</label>
        <input id="p-name" name="fullName" required minLength={2} className={input} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="p-pos">Position</label>
          <select id="p-pos" name="position" className={input}>
            {["C", "LW", "RW", "D", "G"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="p-shoots">Shoots/catches</label>
          <select id="p-shoots" name="shootsCatches" className={input}>
            <option value="">—</option>
            <option value="L">L</option>
            <option value="R">R</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="p-dob">Date of birth</label>
          <input id="p-dob" name="dateOfBirth" type="date" className={input} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="p-nat">Nationality</label>
          <input id="p-nat" name="nationality" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="p-team">Team</label>
          <select id="p-team" name="teamId" className={input}>
            <option value="">No team (free agent / prospect)</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="p-status">Roster status</label>
          <select id="p-status" name="rosterStatus" defaultValue="pro_active" className={input}>
            <option value="pro_active">Active roster</option>
            <option value="minor">Minors</option>
            <option value="injured_reserve">Injured reserve</option>
            <option value="ltir">LTIR</option>
            <option value="non_roster">Non-roster</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="p-fa">Free-agent status</label>
          <select id="p-fa" name="freeAgentStatus" defaultValue="under_contract" className={input}>
            <option value="under_contract">Under contract</option>
            <option value="rfa">RFA</option>
            <option value="ufa">UFA</option>
            <option value="unsigned_prospect">Unsigned prospect</option>
          </select>
        </div>
      </div>
      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Add player"}
      </button>
    </form>
  );
}
