"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/contractActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

export function ContractForm({
  action,
  organizationId,
  players,
  teams,
  seasons,
  defaultPlayerId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  players: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  seasons: Array<{ id: string; name: string }>;
  defaultPlayerId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-player">Player</label>
          <select id="c-player" name="playerId" defaultValue={defaultPlayerId} required className={input}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="c-team">Team</label>
          <select id="c-team" name="teamId" required className={input}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="c-type">Contract type</label>
          <select id="c-type" name="contractType" defaultValue="one_way" className={input}>
            <option value="one_way">One-way</option>
            <option value="two_way">Two-way</option>
            <option value="entry_level">Entry-level</option>
            <option value="standard">Standard</option>
            <option value="minor_league">Minor-league</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="c-signed">Signed date</label>
          <input id="c-signed" name="signedDate" type="date" className={input} />
        </div>
      </div>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-sm text-ink-secondary">Salary schedule by season</legend>
        <p className="mb-3 text-xs text-ink-muted">
          Leave a season&rsquo;s cap hit blank if the contract doesn&rsquo;t cover it. Base salary
          defaults to the cap hit when blank.
        </p>
        <div className="space-y-3">
          {seasons.map((s) => (
            <div key={s.id} className="grid grid-cols-4 items-end gap-2">
              <div className="text-sm text-ink-secondary">{s.name}</div>
              <div>
                <label className="mb-1 block text-xs text-ink-muted" htmlFor={`cap-${s.id}`}>Cap hit ($)</label>
                <input id={`cap-${s.id}`} name={`capHit_${s.id}`} type="number" min={0} step={25000} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-muted" htmlFor={`base-${s.id}`}>Base salary ($)</label>
                <input id={`base-${s.id}`} name={`base_${s.id}`} type="number" min={0} step={25000} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-muted" htmlFor={`bonus-${s.id}`}>Perf. bonus ($)</label>
                <input id={`bonus-${s.id}`} name={`bonus_${s.id}`} type="number" min={0} step={25000} className={input} />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Create contract"}
      </button>
    </form>
  );
}
