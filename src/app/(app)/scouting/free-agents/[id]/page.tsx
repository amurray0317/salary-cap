import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getCfaBoardDetail } from "@/server/services/boardService";
import { ScoutingError } from "@/server/services/scoutingService";
import {
  addBoardNoteAction,
  addCfaEntryAction,
  reorderCfaAction,
  setCfaBoardStatusAction,
  updateCfaEntryAction,
} from "@/server/actions/boardActions";
import { AddBoardProspectForm, CfaEntryEditForm, CFA_RELATIONSHIP_STATUSES } from "@/components/BoardForms";
import { BoardDnD } from "@/components/BoardDnD";
import { BoardNoteForm } from "@/components/BoardNoteForm";
import { Card, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "CFA board" };

interface Search {
  pos?: string;
  hand?: string;
  school?: string;
  conf?: string;
  rights?: string;
  elig?: string;
  availBy?: string;
  ready?: string;
  minFit?: string;
  maxPriority?: string;
  rel?: string;
  staff?: string;
  due?: string; // overdue | week
  status?: string; // active (default) | archived | all
}

export default async function CfaBoardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const sp = await searchParams;

  let detail;
  try {
    detail = await getCfaBoardDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const { board, entries } = detail;
  const db = getDb();

  const onBoard = entries.map((r) => r.p.id);
  const eligible = await db
    .select({ id: schema.amateurProspects.id, name: schema.amateurProspects.fullName, position: schema.amateurProspects.position, cfa: schema.amateurProspects.collegeFreeAgentStatus })
    .from(schema.amateurProspects)
    .where(
      and(
        eq(schema.amateurProspects.organizationId, ctx.org.id),
        eq(schema.amateurProspects.nhlDraftStatus, "undrafted"),
        ...(onBoard.length > 0 ? [notInArray(schema.amateurProspects.id, onBoard)] : []),
      ),
    )
    .orderBy(asc(schema.amateurProspects.fullName));

  const staff = await db
    .select({ id: schema.users.id, name: schema.users.fullName })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.organizationMembers.userId, schema.users.id))
    .where(eq(schema.organizationMembers.organizationId, ctx.org.id))
    .orderBy(asc(schema.users.fullName));

  const schools = await db.select().from(schema.schools).orderBy(asc(schema.schools.name));
  const conferences = await db.select().from(schema.conferences).orderBy(asc(schema.conferences.name));
  const schoolBy = new Map(schools.map((s) => [s.id, s]));

  const entryIds = entries.map((r) => r.e.id);
  const history = entryIds.length
    ? await db
        .select({ h: schema.collegeFreeAgentStatusHistory, userName: schema.users.fullName })
        .from(schema.collegeFreeAgentStatusHistory)
        .leftJoin(schema.users, eq(schema.collegeFreeAgentStatusHistory.userId, schema.users.id))
        .where(inArray(schema.collegeFreeAgentStatusHistory.entryId, entryIds))
        .orderBy(desc(schema.collegeFreeAgentStatusHistory.createdAt))
        .limit(40)
    : [];
  const entryName = new Map(entries.map((r) => [r.e.id, r.p.fullName]));

  const notes = await db
    .select({ n: schema.boardMeetingNotes, author: schema.users.fullName })
    .from(schema.boardMeetingNotes)
    .leftJoin(schema.users, eq(schema.boardMeetingNotes.authorId, schema.users.id))
    .where(and(eq(schema.boardMeetingNotes.boardId, board.id), eq(schema.boardMeetingNotes.boardKind, "college_free_agent"), eq(schema.boardMeetingNotes.organizationId, ctx.org.id)))
    .orderBy(desc(schema.boardMeetingNotes.createdAt));

  const canManage = roleHasCapability(ctx.role, "manage_cfa_boards");
  const canContacts = roleHasCapability(ctx.role, "manage_contacts");
  const canFollowUps = roleHasCapability(ctx.role, "assign_followups");
  const canExport = roleHasCapability(ctx.role, "export_scouting");
  const active = board.status === "active";

  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  const statusFilter = sp.status ?? "active";
  const filtered = entries.filter((r) => {
    if (statusFilter !== "all" && r.e.entryStatus !== statusFilter) return false;
    if (sp.pos && r.p.position !== sp.pos) return false;
    if (sp.hand && r.p.shootsCatches !== sp.hand) return false;
    if (sp.school && r.p.schoolId !== sp.school) return false;
    if (sp.conf && (r.p.schoolId ? schoolBy.get(r.p.schoolId)?.conferenceId : null) !== sp.conf) return false;
    if (sp.rights && r.e.nhlRightsStatus !== sp.rights) return false;
    if (sp.elig && !(r.e.remainingEligibility ?? "").toLowerCase().includes(sp.elig.toLowerCase())) return false;
    if (sp.availBy && !(r.e.expectedAvailability && r.e.expectedAvailability <= sp.availBy)) return false;
    if (sp.ready && r.e.readiness !== sp.ready) return false;
    const minFit = num(sp.minFit);
    if (minFit !== null && (r.e.fitScore ?? -1) < minFit) return false;
    const maxPriority = num(sp.maxPriority);
    if (maxPriority !== null && r.e.priorityRank > maxPriority) return false;
    if (sp.rel && r.e.relationshipStatus !== sp.rel) return false;
    if (sp.staff && r.e.assignedStaffId !== sp.staff) return false;
    if (sp.due === "overdue" && !(r.e.nextActionDate && r.e.nextActionDate < today)) return false;
    if (sp.due === "week" && !(r.e.nextActionDate && r.e.nextActionDate <= weekOut)) return false;
    return true;
  });
  const hasFilters = Object.entries(sp).some(([k, v]) => v && !(k === "status" && v === "active"));

  const selectCls =
    "rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/scouting/free-agents" className="text-sm text-accent-text hover:underline">← CFA boards</Link>
          <h1 className="mt-1 text-xl font-semibold">{board.name}{!active && ` (${board.status})`}</h1>
          <p className="text-sm text-ink-muted">
            {entries.length} candidates ({entries.filter((r) => r.e.entryStatus === "archived").length} archived) · agent,
            relationship, and contact records are organization-private
          </p>
          {board.description && <p className="text-sm text-ink-muted">{board.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <a href={`/api/export/cfa-board?boardId=${board.id}`} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              Export CSV
            </a>
          )}
          {canManage && (
            <form action={setCfaBoardStatusAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="boardId" value={board.id} />
              <input type="hidden" name="status" value={active ? "archived" : "active"} />
              <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
                {active ? "Archive board" : "Restore board"}
              </button>
            </form>
          )}
        </div>
      </div>

      <form method="get" className="flex flex-wrap gap-2" aria-label="Candidate filters">
        <select name="pos" defaultValue={sp.pos ?? ""} className={selectCls} aria-label="Position">
          <option value="">All positions</option>
          {["C", "LW", "RW", "D", "G"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select name="hand" defaultValue={sp.hand ?? ""} className={selectCls} aria-label="Shoots">
          <option value="">Any hand</option>
          <option value="L">L</option>
          <option value="R">R</option>
        </select>
        <select name="school" defaultValue={sp.school ?? ""} className={selectCls} aria-label="School">
          <option value="">All schools</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="conf" defaultValue={sp.conf ?? ""} className={selectCls} aria-label="Conference">
          <option value="">All conferences</option>
          {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="rights" defaultValue={sp.rights ?? ""} className={selectCls} aria-label="NHL rights">
          <option value="">Any rights status</option>
          <option value="unowned">Unowned</option>
          <option value="rights_held_by_other">Held by another club</option>
          <option value="rights_held_by_us">Held by us</option>
        </select>
        <input name="elig" defaultValue={sp.elig ?? ""} placeholder="Eligibility contains…" className={`${selectCls} w-40`} aria-label="Remaining eligibility" />
        <input name="availBy" type="date" defaultValue={sp.availBy ?? ""} className={selectCls} aria-label="Available by" />
        <select name="ready" defaultValue={sp.ready ?? ""} className={selectCls} aria-label="Readiness">
          <option value="">Any readiness</option>
          <option value="nhl_ready">NHL ready</option>
          <option value="ahl_ready">AHL ready</option>
          <option value="development_needed">Development needed</option>
        </select>
        <input name="minFit" defaultValue={sp.minFit ?? ""} placeholder="Min fit" inputMode="decimal" className={`${selectCls} w-20`} aria-label="Minimum fit" />
        <input name="maxPriority" defaultValue={sp.maxPriority ?? ""} placeholder="Top N priority" inputMode="numeric" className={`${selectCls} w-28`} aria-label="Top priorities" />
        <select name="rel" defaultValue={sp.rel ?? ""} className={selectCls} aria-label="Relationship status">
          <option value="">Any relationship</option>
          {CFA_RELATIONSHIP_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select name="staff" defaultValue={sp.staff ?? ""} className={selectCls} aria-label="Assigned staff">
          <option value="">Any staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="due" defaultValue={sp.due ?? ""} className={selectCls} aria-label="Next action date">
          <option value="">Any next-action date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due within 7 days</option>
        </select>
        <select name="status" defaultValue={statusFilter} className={selectCls} aria-label="Candidate status">
          <option value="active">Active candidates</option>
          <option value="archived">Archived candidates</option>
          <option value="all">All candidates</option>
        </select>
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Filter</button>
        {hasFilters && <Link href={`/scouting/free-agents/${board.id}`} className="rounded-md px-3 py-1.5 text-sm text-accent-text hover:underline">Reset</Link>}
      </form>

      <Card title={`Signing priorities (${filtered.length}${hasFilters ? " filtered" : ""})`}>
        {filtered.length === 0 ? (
          <p className="text-sm text-ink-muted">{entries.length === 0 ? "No candidates yet — add undrafted prospects below." : "No candidates match these filters."}</p>
        ) : (
          <form method="get" action={`/scouting/free-agents/${board.id}/compare`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th> </Th>
                    <Th right>Priority</Th>
                    <Th>Prospect</Th>
                    <Th>Pos</Th>
                    <Th>School</Th>
                    <Th>Rights</Th>
                    <Th>Eligibility left</Th>
                    <Th>Available</Th>
                    <Th>Readiness</Th>
                    <Th>AHL / NHL role</Th>
                    <Th right>Fit</Th>
                    <Th>Competition</Th>
                    {canContacts && <Th>Agent</Th>}
                    <Th>Relationship</Th>
                    {canContacts && <Th>Last contact</Th>}
                    <Th>Next action</Th>
                    <Th>Assigned</Th>
                    <Th>Recommendation</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.e.id} className={`border-b border-line/50 last:border-0 hover:bg-navy-850 ${r.e.entryStatus === "archived" ? "opacity-50" : ""}`}>
                      <Td><input type="checkbox" name="ids" value={r.e.id} aria-label={`Compare ${r.p.fullName}`} /></Td>
                      <Td right className="font-medium">{r.e.priorityRank}</Td>
                      <Td><Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">{r.p.fullName}</Link></Td>
                      <Td>{r.p.position}{r.p.shootsCatches ? ` (${r.p.shootsCatches})` : ""}</Td>
                      <Td className="max-w-36 truncate text-ink-secondary">{r.schoolName ?? "—"}</Td>
                      <Td className="text-ink-secondary">{r.e.nhlRightsStatus.replace(/_/g, " ")}</Td>
                      <Td className="text-ink-secondary">{r.e.remainingEligibility ?? "—"}</Td>
                      <Td className="text-ink-secondary">{r.e.expectedAvailability ? formatDate(r.e.expectedAvailability) : "—"}</Td>
                      <Td className="text-ink-secondary">{r.e.readiness?.replace(/_/g, " ") ?? "—"}</Td>
                      <Td className="max-w-40 truncate text-ink-secondary">{r.e.projectedAhlRole ?? "—"} / {r.e.projectedNhlRole ?? "—"}</Td>
                      <Td right className="text-ink-secondary">{r.e.fitScore?.toFixed(0) ?? "—"}</Td>
                      <Td className={r.e.marketCompetition === "high" ? "text-warn" : "text-ink-secondary"}>{r.e.marketCompetition ?? "—"}</Td>
                      {canContacts && <Td className="max-w-32 truncate text-ink-secondary">{r.e.agentName ?? "—"}</Td>}
                      <Td className={r.e.relationshipStatus === "signed_by_organization" ? "text-good" : r.e.relationshipStatus === "signed_elsewhere" ? "text-critical" : "text-ink-secondary"}>
                        {r.e.relationshipStatus.replace(/_/g, " ")}
                      </Td>
                      {canContacts && <Td className="text-ink-secondary">{r.e.lastContactDate ? formatDate(r.e.lastContactDate) : "—"}</Td>}
                      <Td className="max-w-44 truncate text-ink-secondary">
                        {r.e.nextAction ?? "—"}
                        {r.e.nextActionDate && (
                          <span className={r.e.nextActionDate < today ? " text-critical" : " text-ink-muted"}> ({formatDate(r.e.nextActionDate)})</span>
                        )}
                      </Td>
                      <Td className="text-ink-secondary">{r.staffName ?? "—"}</Td>
                      <Td className="max-w-40 truncate text-ink-secondary">{r.e.recommendation ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Compare selected (2–5)</button>
          </form>
        )}
      </Card>

      {canManage && active && entries.length > 1 && (
        <Card title="Rank signing priorities (drag & drop, or ↑/↓; every move is recorded)">
          <BoardDnD
            action={reorderCfaAction}
            organizationId={ctx.org.id}
            boardId={board.id}
            items={entries.map((r) => ({
              id: r.e.id,
              label: r.p.fullName,
              detail: `${r.p.position} · ${r.e.relationshipStatus.replace(/_/g, " ")}${r.e.entryStatus === "archived" ? " · archived" : ""}`,
            }))}
          />
        </Card>
      )}

      {canManage && active && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Add an undrafted candidate">
              <AddBoardProspectForm
                action={addCfaEntryAction}
                organizationId={ctx.org.id}
                boardId={board.id}
                prospects={eligible.map((p) => ({ id: p.id, label: `${p.name} (${p.position}${p.cfa === "eligible" ? " · CFA eligible" : ""})` }))}
                buttonLabel="Add candidate"
              />
            </Card>
            <Card title="Recent field & relationship history">
              {history.length === 0 ? (
                <p className="text-sm text-ink-muted">No changes recorded yet.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-auto text-xs text-ink-muted">
                  {history.map(({ h, userName }) => (
                    <li key={h.id}>
                      {formatDate(h.createdAt)} · <span className="text-ink-secondary">{entryName.get(h.entryId)}</span> ·{" "}
                      {h.field.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase()}: {h.previousValue ?? "—"} → {h.newValue ?? "—"} ({userName ?? "?"})
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Update a candidate (rights, eligibility, relationship, follow-up)">
            <CfaEntryEditForm
              action={updateCfaEntryAction}
              organizationId={ctx.org.id}
              boardId={board.id}
              entries={entries.map((r) => ({ entryId: r.e.id, name: `${r.e.priorityRank}. ${r.p.fullName}` }))}
              staff={staff}
              canContacts={canContacts}
              canFollowUps={canFollowUps}
            />
          </Card>
        </>
      )}

      <Card title={`Meeting notes (${notes.length})`}>
        {canManage && active && <BoardNoteForm action={addBoardNoteAction} organizationId={ctx.org.id} boardKind="college_free_agent" boardId={board.id} />}
        {notes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No meeting notes yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {notes.map(({ n, author }) => (
              <li key={n.id} className="rounded-md border border-line px-3 py-2">
                <p>{n.note}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{author ?? "Unknown"} · {formatDate(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
