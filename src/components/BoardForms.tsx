"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/boardActions";
import { CFA_RELATIONSHIP_STATUSES } from "@/lib/scouting/cfa";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const input =
  "w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";
const smallInput =
  "rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent";

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
      {error}
    </p>
  );
}

export function CreateDraftBoardForm({ action, organizationId }: { action: Action; organizationId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="min-w-56">
        <label className={label} htmlFor="db-name">Board name *</label>
        <input id="db-name" name="name" required maxLength={120} placeholder="e.g. 2027 Draft Board" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="db-year">Draft year *</label>
        <input id="db-year" name="draftYear" type="number" min={2020} max={2040} defaultValue={2027} required className={input} />
      </div>
      <div className="min-w-64 flex-1">
        <label className={label} htmlFor="db-desc">Description</label>
        <input id="db-desc" name="description" maxLength={1000} className={input} />
      </div>
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create board"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function AddBoardProspectForm({
  action,
  organizationId,
  boardId,
  prospects,
  buttonLabel,
}: {
  action: Action;
  organizationId: string;
  boardId: string;
  prospects: Array<{ id: string; label: string }>;
  buttonLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (prospects.length === 0) return <p className="text-sm text-ink-muted">No eligible prospects left to add.</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="boardId" value={boardId} />
      <div className="min-w-72">
        <label className={label} htmlFor="ab-prospect">Prospect</label>
        <select id="ab-prospect" name="prospectId" className={input}>
          {prospects.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Adding…" : buttonLabel}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

/** Compact inline "my rank" submitter for the ranked table. */
export function ScoutRankForm({
  action,
  organizationId,
  boardId,
  prospectId,
  currentRank,
}: {
  action: Action;
  organizationId: string;
  boardId: string;
  prospectId: string;
  currentRank: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input name="rank" type="number" min={1} max={500} defaultValue={currentRank ?? ""} aria-label="My rank" className={`${smallInput} w-14`} />
      <button disabled={pending} className="rounded border border-line px-1.5 py-1 text-xs text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "…" : "✓"}
      </button>
      {state.error && <span className="text-xs text-critical">{state.error}</span>}
    </form>
  );
}

export function EntryEditForm({
  action,
  organizationId,
  boardId,
  entries,
  notesOnly,
}: {
  action: Action;
  organizationId: string;
  boardId: string;
  entries: Array<{ prospectId: string; name: string }>;
  notesOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (entries.length === 0) return <p className="text-sm text-ink-muted">Add prospects to edit their board fields.</p>;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="boardId" value={boardId} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="ee-prospect">Prospect</label>
          <select id="ee-prospect" name="prospectId" className={input}>
            {entries.map((e) => (
              <option key={e.prospectId} value={e.prospectId}>{e.name}</option>
            ))}
          </select>
        </div>
        {!notesOnly && (
          <>
            <div>
              <label className={label} htmlFor="ee-round">Expected round (1–7)</label>
              <input id="ee-round" name="expectedRound" type="number" min={1} max={7} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ee-rs">Range start (overall pick)</label>
              <input id="ee-rs" name="expectedRangeStart" type="number" min={1} max={300} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ee-re">Range end (overall pick)</label>
              <input id="ee-re" name="expectedRangeEnd" type="number" min={1} max={300} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ee-risk">Risk</label>
              <select id="ee-risk" name="risk" className={input}>
                <option value="">(unchanged)</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="ee-floor">Floor</label>
              <input id="ee-floor" name="floor" maxLength={120} placeholder="e.g. AHL depth" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ee-ceiling">Ceiling</label>
              <input id="ee-ceiling" name="ceiling" maxLength={120} placeholder="e.g. Top-four D" className={input} />
            </div>
          </>
        )}
        <div>
          <label className={label} htmlFor="ee-rec">Recommendation</label>
          <input id="ee-rec" name="recommendation" maxLength={500} className={input} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ee-notes">Private notes (replaces the stored note)</label>
        <textarea id="ee-notes" name="notes" rows={2} maxLength={2000} className={input} />
      </div>
      <p className="text-xs text-ink-muted">Blank fields are left unchanged; every change lands in board history with its previous value.</p>
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Saving…" : "Save entry fields"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function CreateCfaBoardForm({ action, organizationId }: { action: Action; organizationId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="min-w-56">
        <label className={label} htmlFor="cb-name">Board name *</label>
        <input id="cb-name" name="name" required maxLength={120} placeholder="e.g. Spring 2027 signing targets" className={input} />
      </div>
      <div className="min-w-64 flex-1">
        <label className={label} htmlFor="cb-desc">Description</label>
        <input id="cb-desc" name="description" maxLength={1000} className={input} />
      </div>
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Creating…" : "Create CFA board"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}

export function CfaEntryEditForm({
  action,
  organizationId,
  boardId,
  entries,
  staff,
  canContacts,
  canFollowUps,
}: {
  action: Action;
  organizationId: string;
  boardId: string;
  entries: Array<{ entryId: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  canContacts: boolean;
  canFollowUps: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (entries.length === 0) return <p className="text-sm text-ink-muted">Add a candidate first.</p>;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="boardId" value={boardId} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="ce-entry">Candidate</label>
          <select id="ce-entry" name="entryId" className={input}>
            {entries.map((e) => (
              <option key={e.entryId} value={e.entryId}>{e.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ce-rights">NHL rights status</label>
          <select id="ce-rights" name="nhlRightsStatus" className={input}>
            <option value="">(unchanged)</option>
            <option value="unowned">Unowned</option>
            <option value="rights_held_by_other">Held by another club</option>
            <option value="rights_held_by_us">Held by us</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ce-elig">Remaining eligibility</label>
          <input id="ce-elig" name="remainingEligibility" maxLength={60} placeholder="e.g. 1 season" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ce-avail">Expected availability</label>
          <input id="ce-avail" name="expectedAvailability" type="date" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ce-ready">Estimated readiness</label>
          <select id="ce-ready" name="readiness" className={input}>
            <option value="">(unchanged)</option>
            <option value="nhl_ready">NHL ready</option>
            <option value="ahl_ready">AHL ready</option>
            <option value="development_needed">Development needed</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ce-ahl">Projected AHL role</label>
          <input id="ce-ahl" name="projectedAhlRole" maxLength={80} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ce-nhl">Projected NHL role</label>
          <input id="ce-nhl" name="projectedNhlRole" maxLength={80} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="ce-comp">Signing competition</label>
          <select id="ce-comp" name="marketCompetition" className={input}>
            <option value="">(unchanged)</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        {canContacts && (
          <>
            <div>
              <label className={label} htmlFor="ce-agent">Agent</label>
              <input id="ce-agent" name="agentName" maxLength={120} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ce-rel">Relationship status</label>
              <select id="ce-rel" name="relationshipStatus" className={input}>
                <option value="">(unchanged)</option>
                {CFA_RELATIONSHIP_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="ce-last">Last contact date</label>
              <input id="ce-last" name="lastContactDate" type="date" className={input} />
            </div>
          </>
        )}
        {canFollowUps && (
          <>
            <div>
              <label className={label} htmlFor="ce-next">Next action</label>
              <input id="ce-next" name="nextAction" maxLength={300} placeholder="e.g. Call agent after playoffs" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ce-nextdate">Next action date</label>
              <input id="ce-nextdate" name="nextActionDate" type="date" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="ce-staff">Assigned staff</label>
              <select id="ce-staff" name="assignedStaffId" className={input}>
                <option value="">(unchanged)</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label className={label} htmlFor="ce-status">Candidate status</label>
          <select id="ce-status" name="entryStatus" className={input}>
            <option value="">(unchanged)</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ce-rec">Recommendation</label>
          <input id="ce-rec" name="recommendation" maxLength={500} className={input} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ce-notes">Private notes (replaces the stored note)</label>
        <textarea id="ce-notes" name="notes" rows={2} maxLength={2000} className={input} />
      </div>
      <p className="text-xs text-ink-muted">Blank fields are left unchanged; every change is recorded with its previous value.</p>
      <button disabled={pending} className="rounded-md border border-line px-3 py-2 text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
        {pending ? "Saving…" : "Save candidate fields"}
      </button>
      <ErrorNote error={state.error} />
    </form>
  );
}
