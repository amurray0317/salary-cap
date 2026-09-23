import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { getBoardDetail, getBoardSnapshot } from "@/server/services/boardService";
import { ScoutingError } from "@/server/services/scoutingService";
import { Card, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Board history" };

interface SnapshotEntry {
  prospectId: string;
  prospectName: string;
  position: string;
  overallRank: number;
  directorFinalRank: number | null;
}

interface ComparisonRow {
  name: string;
  position: string;
  then: number | null;
  now: number | null;
  directorThen: number | null;
  directorNow: number | null;
  change: string;
}

export default async function BoardHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const { version } = await searchParams;

  let detail;
  try {
    detail = await getBoardDetail(id, ctx.org.id);
  } catch (err) {
    if (err instanceof ScoutingError) notFound();
    throw err;
  }
  const { board, entries, versions } = detail;
  const db = getDb();

  const history = await db
    .select({ h: schema.draftBoardRankHistory, userName: schema.users.fullName, prospectName: schema.amateurProspects.fullName })
    .from(schema.draftBoardRankHistory)
    .leftJoin(schema.users, eq(schema.draftBoardRankHistory.userId, schema.users.id))
    .leftJoin(schema.amateurProspects, eq(schema.draftBoardRankHistory.prospectId, schema.amateurProspects.id))
    .where(eq(schema.draftBoardRankHistory.boardId, board.id))
    .orderBy(desc(schema.draftBoardRankHistory.createdAt))
    .limit(250);

  // Version comparison: a stored immutable snapshot vs. the current board.
  const compareVersion = version !== undefined ? Number(version) : null;
  let comparison: { version: number; createdAt: Date; rows: ComparisonRow[]; unchanged: number } | null = null;
  let comparisonError: string | null = null;
  if (compareVersion !== null) {
    if (!Number.isInteger(compareVersion)) {
      comparisonError = "Invalid version";
    } else {
      try {
        const snap = await getBoardSnapshot(board.id, ctx.org.id, compareVersion);
        const thenEntries = snap.snapshot as SnapshotEntry[];
        const nowBy = new Map(entries.map((r) => [r.p.id, r]));
        const thenBy = new Map(thenEntries.map((e) => [e.prospectId, e]));
        const rows: ComparisonRow[] = [];
        let unchanged = 0;
        for (const t of thenEntries) {
          const now = nowBy.get(t.prospectId);
          if (!now) {
            rows.push({ name: t.prospectName, position: t.position, then: t.overallRank, now: null, directorThen: t.directorFinalRank, directorNow: null, change: "removed since" });
            continue;
          }
          const d = t.overallRank - now.e.overallRank;
          const directorChanged = (t.directorFinalRank ?? null) !== now.e.directorFinalRank;
          if (d === 0 && !directorChanged) {
            unchanged += 1;
            continue;
          }
          rows.push({
            name: t.prospectName,
            position: t.position,
            then: t.overallRank,
            now: now.e.overallRank,
            directorThen: t.directorFinalRank ?? null,
            directorNow: now.e.directorFinalRank,
            change: d > 0 ? `▲ up ${d}` : d < 0 ? `▼ down ${-d}` : "director rank changed",
          });
        }
        for (const r of entries) {
          if (!thenBy.has(r.p.id)) {
            rows.push({ name: r.p.fullName, position: r.p.position, then: null, now: r.e.overallRank, directorThen: null, directorNow: r.e.directorFinalRank, change: "added since" });
          }
        }
        rows.sort((a, b) => (a.now ?? 999) - (b.now ?? 999));
        comparison = { version: compareVersion, createdAt: snap.createdAt, rows, unchanged };
      } catch (err) {
        comparisonError = err instanceof ScoutingError ? err.message : "Could not load that version";
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/scouting/board/${board.id}`} className="text-sm text-accent-text hover:underline">← {board.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">Board history — {board.name}</h1>
        <p className="text-sm text-ink-muted">
          Current version v{board.version}. Every change keeps its previous value, author, timestamp, and version;
          snapshots are immutable.
        </p>
      </div>

      {comparisonError && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">{comparisonError}</p>
      )}

      {comparison && (
        <Card title={`Version v${comparison.version} (${formatDate(comparison.createdAt)}) compared with current v${board.version}`}>
          {comparison.rows.length === 0 ? (
            <p className="text-sm text-ink-muted">No ranking differences between the two versions.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Prospect</Th>
                  <Th>Pos</Th>
                  <Th right>Rank at v{comparison.version}</Th>
                  <Th right>Rank now</Th>
                  <Th right>Director then → now</Th>
                  <Th>Change</Th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r) => (
                  <tr key={`${r.name}-${r.then}-${r.now}`} className="border-b border-line/50 last:border-0">
                    <Td className="font-medium">{r.name}</Td>
                    <Td>{r.position}</Td>
                    <Td right className="text-ink-secondary">{r.then ?? "—"}</Td>
                    <Td right className="text-ink-secondary">{r.now ?? "—"}</Td>
                    <Td right className="text-ink-secondary">{r.directorThen ?? "—"} → {r.directorNow ?? "—"}</Td>
                    <Td className={r.change.startsWith("▲") ? "text-good" : r.change.startsWith("▼") ? "text-warn" : "text-ink-muted"}>{r.change}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-ink-muted">{comparison.unchanged} prospect(s) unchanged between the two versions.</p>
        </Card>
      )}

      <Card title={`Versions (${versions.length})`}>
        <div className="max-h-96 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th right>Version</Th>
                <Th>Reason</Th>
                <Th>Saved</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                  <Td right className="font-medium">v{v.version}</Td>
                  <Td className="text-ink-secondary">{v.reason ?? "—"}</Td>
                  <Td className="text-ink-secondary">{formatDate(v.createdAt)}</Td>
                  <Td>
                    {v.version === board.version ? (
                      <span className="text-xs text-ink-muted">current</span>
                    ) : (
                      <Link href={`/scouting/board/${board.id}/history?version=${v.version}`} className="text-sm text-accent-text hover:underline">
                        Compare with current →
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Change history (latest ${history.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>When</Th>
                <Th right>Version</Th>
                <Th>Prospect</Th>
                <Th>Field</Th>
                <Th right>Was</Th>
                <Th right>Now</Th>
                <Th>By</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ h, userName, prospectName }) => (
                <tr key={h.id} className="border-b border-line/50 last:border-0">
                  <Td className="text-xs text-ink-muted">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Td>
                  <Td right className="text-ink-secondary">v{h.boardVersion}</Td>
                  <Td>{prospectName ?? "—"}</Td>
                  <Td className="text-ink-secondary">{h.field.replace(/_/g, " ")}</Td>
                  <Td right className="text-ink-secondary">{h.previousRank ?? h.previousValue ?? "—"}</Td>
                  <Td right>{h.newRank ?? h.newValue ?? "—"}</Td>
                  <Td className="text-ink-secondary">{userName ?? "—"}</Td>
                  <Td className="max-w-52 truncate text-ink-muted">{h.reason ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
