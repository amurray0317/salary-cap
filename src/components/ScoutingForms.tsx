"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/scoutingActions";

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

export interface RoleOption {
  key: string;
  label: string;
}

export function ReportForm({
  action,
  organizationId,
  prospectId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  prospectId: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const sections = [
    ["hockey_sense", "Hockey sense"],
    ["skating", "Skating"],
    ["puck_skills", "Puck skills"],
    ["compete", "Compete"],
    ["offensive_play", "Offensive play"],
    ["defensive_play", "Defensive play"],
    ["transition", "Transition"],
    ["special_teams", "Special teams"],
    ["physical_profile", "Physical profile"],
  ] as const;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="rp-view">Viewing type</label>
          <select id="rp-view" name="viewingType" className={input}>
            <option value="live">Live</option>
            <option value="video">Video</option>
            <option value="crossover">Crossover</option>
            <option value="analytics">Analytics</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="rp-date">Game date</label>
          <input id="rp-date" name="gameDate" type="date" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="rp-opp">Opponent</label>
          <input id="rp-opp" name="opponent" className={input} />
        </div>
      </div>
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-xs text-ink-muted">Grades (20–80 scale; blank = not graded)</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sections.map(([key, lbl]) => (
            <div key={key}>
              <label className="mb-0.5 block text-xs text-ink-muted" htmlFor={`g-${key}`}>{lbl}</label>
              <input id={`g-${key}`} name={`grade_${key}`} type="number" min={20} max={80} step={5} className={input} />
            </div>
          ))}
        </div>
        <input type="hidden" name="gradingScale" value="20-80" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="rp-str">Strengths</label>
          <textarea id="rp-str" name="strengths" rows={2} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="rp-con">Concerns</label>
          <textarea id="rp-con" name="concerns" rows={2} className={input} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="rp-proj">NHL projection</label>
          <input id="rp-proj" name="nhlProjection" className={input} placeholder="e.g. Middle-six winger" />
        </div>
        <div>
          <label className={label} htmlFor="rp-floor">Professional floor</label>
          <input id="rp-floor" name="professionalFloor" className={input} placeholder="e.g. AHL contributor" />
        </div>
        <div>
          <label className={label} htmlFor="rp-ceil">Professional ceiling</label>
          <input id="rp-ceil" name="professionalCeiling" className={input} placeholder="e.g. NHL top-six" />
        </div>
        <div>
          <label className={label} htmlFor="rp-time">Development timeline</label>
          <input id="rp-time" name="developmentTimeline" className={input} placeholder="e.g. 2-3 years" />
        </div>
        <div>
          <label className={label} htmlFor="rp-risk">Risk</label>
          <select id="rp-risk" name="risk" defaultValue="medium" className={input}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="rp-conf">Confidence (0–1)</label>
          <input id="rp-conf" name="confidence" type="number" min={0} max={1} step={0.05} defaultValue={0.6} className={input} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="rp-rec">Recommendation</label>
        <textarea id="rp-rec" name="recommendation" rows={2} className={input} />
      </div>
      <ErrorNote error={state.error} />
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Submit scouting report"}
      </button>
    </form>
  );
}

export function WatchlistAddForm({
  action,
  organizationId,
  prospectId,
  watchlists,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  prospectId: string;
  watchlists: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <div>
        <label className={label} htmlFor="wl-sel">Watchlist</label>
        <select id="wl-sel" name="watchlistId" className={input}>
          {watchlists.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
          <option value="">+ New watchlist…</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="wl-new">New watchlist name</label>
        <input id="wl-new" name="newWatchlistName" className={input} placeholder="Only if creating new" />
      </div>
      <div>
        <label className={label} htmlFor="wl-priority">Priority</label>
        <select id="wl-priority" name="priority" defaultValue="3" className={input}>
          <option value="1">1 — top</option>
          <option value="2">2 — high</option>
          <option value="3">3 — normal</option>
          <option value="4">4 — low</option>
          <option value="5">5 — monitor</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="wl-reason">Reason</label>
        <input id="wl-reason" name="reason" className={input} placeholder="Why this prospect" maxLength={500} />
      </div>
      <div>
        <label className={label} htmlFor="wl-follow">Follow-up date</label>
        <input id="wl-follow" name="followUpDate" type="date" className={input} />
      </div>
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Adding…" : "Add to watchlist"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function BoardAddForm({
  action,
  organizationId,
  prospectId,
  boards,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  prospectId: string;
  boards: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (boards.length === 0) return <p className="text-sm text-ink-muted">No draft boards yet.</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <div>
        <label className={label} htmlFor="bd-sel">Board</label>
        <select id="bd-sel" name="boardId" className={input}>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Adding…" : "Add to board"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function AssignmentForm({
  action,
  organizationId,
  prospects,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  prospects: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div>
        <label className={label} htmlFor="as-type">Type</label>
        <select id="as-type" name="assignmentType" className={input}>
          <option value="player">Player</option>
          <option value="cross_check">Cross-check</option>
          <option value="region">Region</option>
          <option value="school">School</option>
          <option value="game">Game</option>
        </select>
      </div>
      <div className="min-w-52">
        <label className={label} htmlFor="as-prospect">Prospect (for player/cross-check)</label>
        <select id="as-prospect" name="prospectId" className={input}>
          <option value="">—</option>
          {prospects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="as-region">Region (for region type)</label>
        <input id="as-region" name="region" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="as-scout">Scout email (org member)</label>
        <input id="as-scout" name="scoutEmail" type="email" className={input} placeholder="optional" />
      </div>
      <div>
        <label className={label} htmlFor="as-due">Due date</label>
        <input id="as-due" name="dueDate" type="date" className={input} />
      </div>
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Create assignment"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}
