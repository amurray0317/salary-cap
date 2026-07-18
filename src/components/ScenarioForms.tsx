"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/server/actions/scenarioActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
      {error}
    </p>
  );
}

export function NewScenarioForm({
  action,
  organizationId,
  teams,
  seasons,
  defaultTeamId,
  defaultSeasonId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  teams: Array<{ id: string; name: string }>;
  seasons: Array<{ id: string; name: string }>;
  defaultTeamId: string;
  defaultSeasonId: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="min-w-56 flex-1">
        <label className={label} htmlFor="sc-name">Name</label>
        <input id="sc-name" name="name" required minLength={2} className={input} placeholder="e.g. Deadline plan A" />
      </div>
      <div>
        <label className={label} htmlFor="sc-team">Team</label>
        <select id="sc-team" name="teamId" defaultValue={defaultTeamId} className={input}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="sc-season">Base season</label>
        <select id="sc-season" name="baseSeasonId" defaultValue={defaultSeasonId} className={input}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="min-w-64 flex-1">
        <label className={label} htmlFor="sc-desc">Description (optional)</label>
        <input id="sc-desc" name="description" className={input} />
      </div>
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create scenario"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

const KIND_OPTIONS = [
  { value: "sign_free_agent", label: "Sign free agent" },
  { value: "trade_in", label: "Trade in (acquire player)" },
  { value: "trade_out", label: "Trade out (send player away)" },
  { value: "call_up", label: "Call-up from minors" },
  { value: "send_down", label: "Send down to minors" },
  { value: "ir_placement", label: "Injured-reserve placement" },
  { value: "extension", label: "Contract extension" },
  { value: "buyout", label: "Buyout (simplified)" },
] as const;

export function AddTransactionForm({
  action,
  organizationId,
  scenarioId,
  contracts,
  seasons,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  scenarioId: string;
  contracts: Array<{ id: string; label: string }>;
  seasons: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [kind, setKind] = useState<string>("sign_free_agent");

  const needsContract = ["trade_out", "call_up", "send_down", "ir_placement", "extension", "buyout"].includes(kind);
  const needsPlayer = ["sign_free_agent", "trade_in"].includes(kind);
  const needsSeasons = ["sign_free_agent", "trade_in", "extension"].includes(kind);
  const needsRetained = ["trade_out", "trade_in"].includes(kind);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="tx-kind">Transaction</label>
          <select id="tx-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tx-label">Label</label>
          <input id="tx-label" name="label" required className={input} placeholder="e.g. Sign veteran winger" />
        </div>
      </div>

      {needsContract && (
        <div>
          <label className={label} htmlFor="tx-contract">Target contract</label>
          <select id="tx-contract" name="contractId" className={input}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      {needsPlayer && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tx-player">Player name</label>
            <input id="tx-player" name="playerName" className={input} placeholder="e.g. Target Winger" />
          </div>
          <div>
            <label className={label} htmlFor="tx-pos">Position</label>
            <select id="tx-pos" name="position" className={input}>
              {["C", "LW", "RW", "D", "G"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {needsRetained && (
        <div>
          <label className={label} htmlFor="tx-retained">
            {kind === "trade_out" ? "Salary we retain (%)" : "Salary retained by the other team (%)"}
          </label>
          <input id="tx-retained" name="retainedPct" type="number" min={0} max={50} step={5} defaultValue={0} className={input} />
        </div>
      )}

      {kind === "ir_placement" && (
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" name="longTerm" className="accent-[#0d9488]" />
          Long-term injured reserve (generates simplified LTIR relief)
        </label>
      )}

      {kind === "sign_free_agent" && (
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" name="isTwoWay" className="accent-[#0d9488]" />
          Two-way contract
        </label>
      )}

      {needsSeasons && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs text-ink-muted">
            Proposed cap hit per season ($ — leave blank for seasons not covered)
          </legend>
          <div className="grid gap-2 sm:grid-cols-4">
            {seasons.map((s) => (
              <div key={s.id}>
                <label className="mb-1 block text-xs text-ink-muted" htmlFor={`tx-season-${s.id}`}>{s.name}</label>
                <input
                  id={`tx-season-${s.id}`}
                  name={`season_${s.name}`}
                  type="number"
                  min={0}
                  step={25000}
                  className={input}
                />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Adding…" : "Add to scenario"}
      </button>
    </form>
  );
}
