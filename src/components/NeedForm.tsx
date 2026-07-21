"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/fitActions";

const input =
  "w-full rounded-md border border-line bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const label = "mb-1 block text-sm text-ink-secondary";

export interface NeedFormValues {
  needId?: string;
  name?: string;
  description?: string | null;
  position?: string;
  secondaryPosition?: string | null;
  handedness?: string | null;
  targetRoleKey?: string | null;
  targetScoutRoleKey?: string | null;
  priority?: number;
  timelineYears?: number;
  earliestArrivalYears?: number;
  latestArrivalYears?: number;
  targetArrivalSeason?: string | null;
  preferredAcquisition?: string;
  maxRiskTolerance?: string;
  sizePreference?: string | null;
  specialTeamsRequirement?: string | null;
  nhlRosterNeed?: boolean;
  ahlOpportunity?: boolean;
  notes?: string | null;
  minGrades?: Record<string, number>;
}

const POSITIONS = ["C", "LW", "RW", "D", "G", "F"];
const GRADE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "skating", label: "Min skating" },
  { key: "hockey_sense", label: "Min hockey sense" },
  { key: "puck_skills", label: "Min puck skills" },
  { key: "compete", label: "Min compete" },
  { key: "defensive_play", label: "Min defensive play" },
];

export function NeedForm({
  action,
  organizationId,
  roles,
  initial,
  submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  organizationId: string;
  roles: Array<{ key: string; label: string }>;
  initial?: NeedFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = initial ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {v.needId && <input type="hidden" name="needId" value={v.needId} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="nd-name">Name *</label>
          <input id="nd-name" name="name" required maxLength={120} defaultValue={v.name ?? ""} placeholder="e.g. Right-shot transition defenseman" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="nd-desc">Description</label>
          <input id="nd-desc" name="description" maxLength={2000} defaultValue={v.description ?? ""} className={input} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="nd-pos">Position *</label>
          <select id="nd-pos" name="position" defaultValue={v.position ?? "D"} className={input}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p === "F" ? "F (any forward)" : p}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-pos2">Secondary position</label>
          <select id="nd-pos2" name="secondaryPosition" defaultValue={v.secondaryPosition ?? ""} className={input}>
            <option value="">None</option>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-hand">Shoots/catches</label>
          <select id="nd-hand" name="handedness" defaultValue={v.handedness ?? ""} className={input}>
            <option value="">Any</option>
            <option value="L">L</option>
            <option value="R">R</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-priority">Priority (1 = top)</label>
          <select id="nd-priority" name="priority" defaultValue={String(v.priority ?? 3)} className={input}>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-role">Target statistical role</label>
          <select id="nd-role" name="targetRoleKey" defaultValue={v.targetRoleKey ?? ""} className={input}>
            <option value="">None</option>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-srole">Target scout-defined role</label>
          <select id="nd-srole" name="targetScoutRoleKey" defaultValue={v.targetScoutRoleKey ?? ""} className={input}>
            <option value="">None</option>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-acq">Preferred acquisition</label>
          <select id="nd-acq" name="preferredAcquisition" defaultValue={v.preferredAcquisition ?? "draft"} className={input}>
            <option value="draft">NHL Draft</option>
            <option value="college_fa">College FA signing</option>
            <option value="trade">Trade</option>
            <option value="any">Any</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-risk">Max risk tolerance</label>
          <select id="nd-risk" name="maxRiskTolerance" defaultValue={v.maxRiskTolerance ?? "medium"} className={input}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="nd-timeline">Target arrival (years)</label>
          <input id="nd-timeline" name="timelineYears" type="number" min={0} max={6} defaultValue={v.timelineYears ?? 3} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="nd-earliest">Earliest arrival (years)</label>
          <input id="nd-earliest" name="earliestArrivalYears" type="number" min={0} max={6} defaultValue={v.earliestArrivalYears ?? 0} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="nd-latest">Latest arrival (years)</label>
          <input id="nd-latest" name="latestArrivalYears" type="number" min={0} max={8} defaultValue={v.latestArrivalYears ?? 4} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="nd-season">Target arrival season</label>
          <input id="nd-season" name="targetArrivalSeason" placeholder="e.g. 2028-29" maxLength={20} defaultValue={v.targetArrivalSeason ?? ""} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="nd-size">Size preference</label>
          <select id="nd-size" name="sizePreference" defaultValue={v.sizePreference ?? ""} className={input}>
            <option value="">No preference</option>
            <option value="prefers_size">Prefers size</option>
            <option value="prefers_mobility">Prefers mobility</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="nd-st">Special-teams requirement</label>
          <select id="nd-st" name="specialTeamsRequirement" defaultValue={v.specialTeamsRequirement ?? ""} className={input}>
            <option value="">None</option>
            <option value="pp">Power play</option>
            <option value="pk">Penalty kill</option>
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink-secondary">
          <input type="checkbox" name="nhlRosterNeed" defaultChecked={v.nhlRosterNeed ?? false} />
          NHL roster need (want NHL-ready)
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink-secondary">
          <input type="checkbox" name="ahlOpportunity" defaultChecked={v.ahlOpportunity ?? true} />
          AHL opportunity matters
        </label>
      </div>

      <div>
        <p className="mb-1 text-sm text-ink-secondary">Minimum scouting grades (20–80 scale; blank = no minimum)</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {GRADE_FIELDS.map((g) => (
            <div key={g.key}>
              <label className={label} htmlFor={`nd-min-${g.key}`}>{g.label}</label>
              <input
                id={`nd-min-${g.key}`}
                name={`min_${g.key}`}
                type="number"
                min={20}
                max={80}
                step={5}
                defaultValue={v.minGrades?.[g.key] ?? ""}
                className={input}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="nd-notes">Notes</label>
        <textarea id="nd-notes" name="notes" rows={2} maxLength={2000} defaultValue={v.notes ?? ""} className={input} />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
