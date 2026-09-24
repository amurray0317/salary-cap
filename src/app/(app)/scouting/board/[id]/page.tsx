import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getBoardDetail } from "@/server/services/boardService";
import { ScoutingError } from "@/server/services/scoutingService";
import {
  addBoardNoteAction,
  addBoardProspectAction,
  removeBoardProspectAction,
  reorderBoardAction,
  setBoardStatusAction,
  setDirectorRankAction,
  submitScoutRankingAction,
  updateBoardEntryAction,
} from "@/server/actions/boardActions";
import { AddBoardProspectForm, EntryEditForm, ScoutRankForm } from "@/components/BoardForms";
import { BoardDnD } from "@/components/BoardDnD";
import { BoardNoteForm } from "@/components/BoardNoteForm";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { roleHasCapability } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Draft board" };

interface Search {
  q?: string;
  pos?: string;
  hand?: string;
  school?: string;
  conf?: string;
  maxAge?: string;
  draft?: string;
  round?: string;
  role?: string;
  srole?: string;
  minFit?: string;
  risk?: string;
  minViews?: string;
  minReports?: string;
}

/** Age on Sept 15 of the draft year (the NHL draft-eligibility reference date). */
function draftAge(dob: string | null, draftYear: number | null): number | null {
  if (!dob || !draftYear) return null;
  const ref = new Date(`${draftYear}-09-15`);
  const d = new Date(dob);
  let age = ref.getFullYear() - d.getFullYear();
  if (ref.getMonth() < d.getMonth() || (ref.getMonth() === d.getMonth() && ref.getDate() < d.getDate())) age -= 1;
  return age;
}

export default async function DraftBoardDetailPage({
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
    detail = await getBoardDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const { board, entries, consensus, rankings, versions } = detail;
  const db = getDb();

  const consensusBy = new Map(consensus.map((c) => [c.prospectId, c]));
  const myRankings = new Map(rankings.filter((r) => r.r.scoutId === ctx.user.id).map((r) => [r.r.prospectId, r.r.rank]));
  const ids = entries.map((r) => r.p.id);

  // Schools, conferences, and top statistical role for filters/columns.
  const schools = await db.select().from(schema.schools).orderBy(asc(schema.schools.name));
  const conferences = await db.select().from(schema.conferences).orderBy(asc(schema.conferences.name));
  const schoolBy = new Map(schools.map((s) => [s.id, s]));
  const archetypes = await db.select().from(schema.roleArchetypes).orderBy(asc(schema.roleArchetypes.label));
  const roleLabel = (key: string | null) => archetypes.find((a) => a.key === key)?.label ?? key ?? "—";
  const topRole = new Map<string, { key: string; score: number }>();
  if (ids.length > 0) {
    const roleRows = await db
      .select({ prospectId: schema.prospectRoleScores.prospectId, score: schema.prospectRoleScores.score, key: schema.roleArchetypes.key })
      .from(schema.prospectRoleScores)
      .innerJoin(schema.roleArchetypes, eq(schema.prospectRoleScores.archetypeId, schema.roleArchetypes.id))
      .where(inArray(schema.prospectRoleScores.prospectId, ids));
    for (const r of roleRows) {
      if ((topRole.get(r.prospectId)?.score ?? -1) < r.score) topRole.set(r.prospectId, { key: r.key, score: r.score });
    }
  }

  // Draft-eligible (undrafted) prospects not yet on the board.
  const eligible = await db
    .select({ id: schema.amateurProspects.id, name: schema.amateurProspects.fullName, position: schema.amateurProspects.position })
    .from(schema.amateurProspects)
    .where(
      and(
        eq(schema.amateurProspects.organizationId, ctx.org.id),
        eq(schema.amateurProspects.nhlDraftStatus, "undrafted"),
        ...(ids.length > 0 ? [notInArray(schema.amateurProspects.id, ids)] : []),
      ),
    )
    .orderBy(asc(schema.amateurProspects.fullName));

  const notes = await db
    .select({ n: schema.boardMeetingNotes, author: schema.users.fullName })
    .from(schema.boardMeetingNotes)
    .leftJoin(schema.users, eq(schema.boardMeetingNotes.authorId, schema.users.id))
    .where(and(eq(schema.boardMeetingNotes.boardId, board.id), eq(schema.boardMeetingNotes.boardKind, "draft"), eq(schema.boardMeetingNotes.organizationId, ctx.org.id)))
    .orderBy(desc(schema.boardMeetingNotes.createdAt));

  const canManage = roleHasCapability(ctx.role, "manage_draft_boards");
  const canFinalize = roleHasCapability(ctx.role, "finalize_boards");
  const canUnlock = roleHasCapability(ctx.role, "unlock_boards");
  const canRank = roleHasCapability(ctx.role, "create_scouting_reports");
  const canExport = roleHasCapability(ctx.role, "export_scouting");
  const locked = board.status === "locked";
  const archived = board.status === "archived";
  const editable = board.status === "active";

  const num = (v?: string) => (v && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const filtered = entries.filter((r) => {
    const school = r.p.schoolId ? schoolBy.get(r.p.schoolId) : undefined;
    if (sp.q && !r.p.fullName.toLowerCase().includes(sp.q.toLowerCase())) return false;
    if (sp.pos && r.p.position !== sp.pos) return false;
    if (sp.hand && r.p.shootsCatches !== sp.hand) return false;
    if (sp.school && r.p.schoolId !== sp.school) return false;
    if (sp.conf && school?.conferenceId !== sp.conf) return false;
    const maxAge = num(sp.maxAge);
    if (maxAge !== null) {
      const age = draftAge(r.p.dateOfBirth, board.draftYear);
      if (age === null || age > maxAge) return false;
    }
    if (sp.draft && r.p.nhlDraftStatus !== sp.draft) return false;
    if (sp.round && String(r.e.expectedRound ?? "") !== sp.round) return false;
    if (sp.role && topRole.get(r.p.id)?.key !== sp.role) return false;
    if (sp.srole && r.p.scoutAssignedRoleKey !== sp.srole) return false;
    const minFit = num(sp.minFit);
    if (minFit !== null && (r.e.fitScore ?? -1) < minFit) return false;
    if (sp.risk && r.e.risk !== sp.risk) return false;
    const minViews = num(sp.minViews);
    if (minViews !== null && r.e.viewingCount < minViews) return false;
    const minReports = num(sp.minReports);
    if (minReports !== null && r.e.reportCount < minReports) return false;
    return true;
  });
  const hasFilters = Object.values(sp).some(Boolean);

  const splitCount = consensus.filter((c) => c.spread >= 10).length;
  const selectCls =
    "rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/scouting/board" className="text-sm text-accent-text hover:underline">← Draft boards</Link>
          <h1 className="mt-1 text-xl font-semibold">
            {board.name} {locked && <span className="text-warn" aria-label="locked">🔒</span>}
          </h1>
          <p className="text-sm text-ink-muted">
            Draft year {board.draftYear ?? "—"} · status {board.status} · version {board.version} · {entries.length} prospects
            {board.lockedAt && locked && ` · locked ${formatDate(board.lockedAt)}`}
          </p>
          {board.description && <p className="text-sm text-ink-muted">{board.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <a href={`/api/export/draft-board?boardId=${board.id}`} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              Export CSV
            </a>
          )}
          <Link href={`/scouting/board/${board.id}/history`} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
            History & versions ({versions.length})
          </Link>
          {editable && canFinalize && (
            <form action={setBoardStatusAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="boardId" value={board.id} />
              <input type="hidden" name="status" value="locked" />
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Lock final board</button>
            </form>
          )}
          {(locked || archived) && canUnlock && (
            <form action={setBoardStatusAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="boardId" value={board.id} />
              <input type="hidden" name="status" value="active" />
              <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
                {locked ? "Unlock" : "Restore"}
              </button>
            </form>
          )}
          {!archived && canManage && (
            <form action={setBoardStatusAction}>
              <input type="hidden" name="organizationId" value={ctx.org.id} />
              <input type="hidden" name="boardId" value={board.id} />
              <input type="hidden" name="status" value="archived" />
              <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Archive</button>
            </form>
          )}
        </div>
      </div>

      {locked && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          🔒 This board is locked: rankings and entries cannot change. Board managers can still add notes and
          recommendations; unlocking requires director authorization and is audit-logged.
        </p>
      )}
      {archived && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">This board is archived and read-only.</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Prospects" value={`${entries.length}`} detail={editable ? `${eligible.length} more draft-eligible to add` : "board frozen"} />
        <StatTile label="Scout rankings" value={`${rankings.length}`} detail={`${new Set(rankings.map((r) => r.r.scoutId)).size} scout(s) submitted`} />
        <StatTile
          label="Consensus coverage"
          value={`${consensus.length}/${entries.length}`}
          detail={`${consensus.filter((c) => c.insufficient).length} below the 3-ranking minimum`}
        />
        <StatTile
          label="Scout disagreement"
          value={consensus.length > 0 ? `${Math.max(...consensus.map((c) => c.spread))} spots max` : "—"}
          detail={`${splitCount} prospect(s) with a 10+ spot spread`}
        />
      </div>

      <form method="get" className="flex flex-wrap gap-2" aria-label="Board filters">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name…" className={`${selectCls} w-36`} />
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
        <input name="maxAge" defaultValue={sp.maxAge ?? ""} placeholder="Max age" inputMode="numeric" className={`${selectCls} w-20`} aria-label="Max age at draft" />
        <select name="draft" defaultValue={sp.draft ?? ""} className={selectCls} aria-label="Draft status">
          <option value="">Any draft status</option>
          <option value="undrafted">Undrafted</option>
          <option value="drafted">Drafted</option>
        </select>
        <select name="round" defaultValue={sp.round ?? ""} className={selectCls} aria-label="Expected round">
          <option value="">Any expected round</option>
          {[1, 2, 3, 4, 5, 6, 7].map((r) => <option key={r} value={String(r)}>Round {r}</option>)}
        </select>
        <select name="role" defaultValue={sp.role ?? ""} className={selectCls} aria-label="Statistical role">
          <option value="">Any statistical role</option>
          {archetypes.map((a) => <option key={a.key} value={a.key}>[{a.positionGroup}] {a.label}</option>)}
        </select>
        <select name="srole" defaultValue={sp.srole ?? ""} className={selectCls} aria-label="Scout-defined role">
          <option value="">Any scout role</option>
          {archetypes.map((a) => <option key={a.key} value={a.key}>[{a.positionGroup}] {a.label}</option>)}
        </select>
        <input name="minFit" defaultValue={sp.minFit ?? ""} placeholder="Min fit" inputMode="decimal" className={`${selectCls} w-20`} aria-label="Minimum fit" />
        <select name="risk" defaultValue={sp.risk ?? ""} className={selectCls} aria-label="Risk">
          <option value="">Any risk</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <input name="minViews" defaultValue={sp.minViews ?? ""} placeholder="Min views" inputMode="numeric" className={`${selectCls} w-24`} aria-label="Minimum viewings" />
        <input name="minReports" defaultValue={sp.minReports ?? ""} placeholder="Min reports" inputMode="numeric" className={`${selectCls} w-24`} aria-label="Minimum reports" />
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Filter</button>
        {hasFilters && (
          <Link href={`/scouting/board/${board.id}`} className="rounded-md px-3 py-1.5 text-sm text-accent-text hover:underline">Reset</Link>
        )}
      </form>

      <Card title={`Board (${filtered.length}${hasFilters ? ` of ${entries.length}, filtered` : ""}) — each ranking source in its own column`}>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-muted">No prospects yet — add draft-eligible prospects below.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-muted">No prospects match these filters.</p>
        ) : (
          <form method="get" action={`/scouting/board/${board.id}/compare`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th> </Th>
                    <Th right>Rank</Th>
                    <Th>Prospect</Th>
                    <Th>Pos</Th>
                    <Th right>Pos rank</Th>
                    <Th right>Age</Th>
                    <Th>Exp. round / range</Th>
                    <Th>Stat role</Th>
                    <Th>Scout role</Th>
                    <Th right>Model</Th>
                    <Th>Consensus</Th>
                    <Th right>Fit</Th>
                    <Th right>Director</Th>
                    {canRank && <Th>My rank</Th>}
                    <Th>Risk</Th>
                    <Th right>Views</Th>
                    <Th right>Reports</Th>
                    <Th>Recommendation</Th>
                    {canManage && editable && <Th> </Th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const c = consensusBy.get(r.p.id);
                    const age = draftAge(r.p.dateOfBirth, board.draftYear);
                    return (
                      <tr key={r.e.id} className="border-b border-line/50 last:border-0 hover:bg-subtle">
                        <Td><input type="checkbox" name="ids" value={r.p.id} aria-label={`Compare ${r.p.fullName}`} /></Td>
                        <Td right className="font-medium">{r.e.overallRank}</Td>
                        <Td>
                          <Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">{r.p.fullName}</Link>
                          {(r.e.floor || r.e.ceiling) && (
                            <p className="text-xs text-ink-muted">Floor {r.e.floor ?? "—"} · Ceiling {r.e.ceiling ?? "—"}</p>
                          )}
                        </Td>
                        <Td>{r.p.position}{r.p.shootsCatches ? ` (${r.p.shootsCatches})` : ""}</Td>
                        <Td right className="text-ink-secondary">{r.e.positionRank ?? "—"}</Td>
                        <Td right className="text-ink-secondary">{age ?? "—"}</Td>
                        <Td className="text-ink-secondary">
                          {r.e.expectedRound ? `R${r.e.expectedRound}` : "—"}
                          {r.e.expectedRangeStart ? ` · #${r.e.expectedRangeStart}–${r.e.expectedRangeEnd ?? "?"}` : ""}
                        </Td>
                        <Td className="max-w-36 truncate text-ink-secondary">{topRole.has(r.p.id) ? roleLabel(topRole.get(r.p.id)!.key) : "—"}</Td>
                        <Td className="max-w-36 truncate text-ink-secondary">{r.p.scoutAssignedRoleKey ? roleLabel(r.p.scoutAssignedRoleKey) : "—"}</Td>
                        <Td right className="text-ink-secondary">{r.e.modelRank ?? "—"}</Td>
                        <Td>
                          {c ? (
                            <span className={c.insufficient || c.spread >= 10 ? "text-warn" : "text-ink-secondary"}>
                              {c.meanRank.toFixed(1)}{" "}
                              <span className="text-xs">
                                (n={c.submissions}, med {c.medianRank}, {c.bestRank}–{c.worstRank}, σ {c.stddev.toFixed(1)}
                                {c.insufficient ? ", ⚠ few" : c.spread >= 10 ? ", ⚠ split" : ""})
                              </span>
                            </span>
                          ) : (
                            <span className="text-ink-muted">no rankings</span>
                          )}
                        </Td>
                        <Td right className="text-ink-secondary">
                          {r.e.fitRank ? `#${r.e.fitRank}` : "—"}
                          {r.e.fitScore !== null && <span className="text-xs text-ink-muted"> ({r.e.fitScore.toFixed(0)})</span>}
                        </Td>
                        <Td right>
                          {canFinalize && editable ? (
                            <form action={setDirectorRankAction} className="flex items-center justify-end gap-1">
                              <input type="hidden" name="organizationId" value={ctx.org.id} />
                              <input type="hidden" name="boardId" value={board.id} />
                              <input type="hidden" name="prospectId" value={r.p.id} />
                              <input
                                name="rank"
                                type="number"
                                min={1}
                                max={500}
                                defaultValue={r.e.directorFinalRank ?? ""}
                                aria-label={`Director rank for ${r.p.fullName}`}
                                className="w-14 rounded-md border border-line bg-canvas px-2 py-1 text-right text-xs text-ink outline-none focus:border-accent"
                              />
                              <button className="rounded border border-line px-1.5 py-1 text-xs text-ink-secondary hover:text-ink">✓</button>
                            </form>
                          ) : (
                            <span className="font-medium">{r.e.directorFinalRank ?? "—"}</span>
                          )}
                        </Td>
                        {canRank && (
                          <Td>
                            {editable ? (
                              <ScoutRankForm
                                action={submitScoutRankingAction}
                                organizationId={ctx.org.id}
                                boardId={board.id}
                                prospectId={r.p.id}
                                currentRank={myRankings.get(r.p.id) ?? null}
                              />
                            ) : (
                              <span className="text-ink-secondary">{myRankings.get(r.p.id) ?? "—"}</span>
                            )}
                          </Td>
                        )}
                        <Td className={r.e.risk === "high" ? "text-critical" : r.e.risk === "low" ? "text-good" : r.e.risk ? "text-warn" : "text-ink-muted"}>
                          {r.e.risk ?? "—"}
                        </Td>
                        <Td right className="text-ink-secondary">{r.e.viewingCount}</Td>
                        <Td right className="text-ink-secondary">{r.e.reportCount}</Td>
                        <Td className="max-w-44 truncate text-ink-secondary">{r.e.recommendation ?? "—"}</Td>
                        {canManage && editable && (
                          <Td>
                            <button
                              formAction={removeBoardProspectAction}
                              name="prospectId"
                              value={r.p.id}
                              className="text-xs text-critical hover:underline"
                            >
                              Remove
                            </button>
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <input type="hidden" name="organizationId" value={ctx.org.id} />
            <input type="hidden" name="boardId" value={board.id} />
            <button className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              Compare selected (2–5)
            </button>
          </form>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          Consensus shows mean (n, median, best–worst, standard deviation). Spreads of 10+ spots and samples under three
          rankings are flagged, never hidden. Model, consensus, fit, and director ranks are separate columns and never merged.
        </p>
      </Card>

      {canManage && editable && entries.length > 1 && (
        <Card title="Reorder (drag & drop, or ↑/↓; saved as one versioned change)">
          <BoardDnD
            action={reorderBoardAction}
            organizationId={ctx.org.id}
            boardId={board.id}
            items={entries.map((r) => ({
              id: r.p.id,
              label: r.p.fullName,
              detail: `${r.p.position} · model ${r.e.modelRank ?? "—"} · consensus ${r.e.consensusRank?.toFixed(1) ?? "—"} · director ${r.e.directorFinalRank ?? "—"}`,
            }))}
            withReason
          />
        </Card>
      )}

      {canManage && !archived && (
        <div className="grid gap-4 lg:grid-cols-2">
          {editable && (
            <Card title="Add a draft-eligible prospect (undrafted only)">
              <AddBoardProspectForm
                action={addBoardProspectAction}
                organizationId={ctx.org.id}
                boardId={board.id}
                prospects={eligible.map((p) => ({ id: p.id, label: `${p.name} (${p.position})` }))}
                buttonLabel="Add to board"
              />
            </Card>
          )}
          <Card title={locked ? "Notes & recommendations (still editable on a locked board)" : "Edit entry fields"}>
            <EntryEditForm
              action={updateBoardEntryAction}
              organizationId={ctx.org.id}
              boardId={board.id}
              entries={entries.map((r) => ({ prospectId: r.p.id, name: `${r.e.overallRank}. ${r.p.fullName}` }))}
              notesOnly={locked}
            />
          </Card>
        </div>
      )}

      <Card title={`Meeting notes (${notes.length})`}>
        {canManage && !archived && (
          <BoardNoteForm action={addBoardNoteAction} organizationId={ctx.org.id} boardKind="draft" boardId={board.id} />
        )}
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
