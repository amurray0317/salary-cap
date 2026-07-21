import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { listProspects, type ProspectListFilters } from "@/server/services/prospectListService";
import { deleteScoutingViewAction, saveScoutingViewAction } from "@/server/actions/scoutingActions";
import { Card, EmptyState, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "NCAA players" };

type Search = ProspectListFilters & { page?: string; cols?: string | string[]; saveAs?: string };

const PAGE_SIZE = 50;

/** Optional columns the user can hide; the player name is always shown. */
const COLUMNS = [
  { key: "pos", label: "Pos" },
  { key: "hand", label: "Hand" },
  { key: "school", label: "School" },
  { key: "conf", label: "Conference" },
  { key: "class", label: "Class" },
  { key: "age", label: "Age" },
  { key: "gp", label: "GP" },
  { key: "g", label: "G" },
  { key: "a", label: "A" },
  { key: "p", label: "P" },
  { key: "ppg", label: "PPG" },
  { key: "spg", label: "S/G" },
  { key: "draft", label: "Draft status" },
] as const;

const SORT_OPTIONS = [
  { value: "ppg", label: "PPG" },
  { value: "p", label: "Points" },
  { value: "g", label: "Goals" },
  { value: "a", label: "Assists" },
  { value: "gp", label: "Games played" },
  { value: "spg", label: "Shots/game" },
  { value: "age", label: "Age" },
  { value: "name", label: "Name" },
];

export default async function NcaaPlayersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const db = getDb();

  const rows = await listProspects(ctx.org.id, sp);

  const conferences = await db.select().from(schema.conferences).orderBy(asc(schema.conferences.name));
  const schools = await db.select().from(schema.schools).orderBy(asc(schema.schools.name));
  const savedViews = await db
    .select()
    .from(schema.savedViews)
    .where(
      and(
        eq(schema.savedViews.organizationId, ctx.org.id),
        eq(schema.savedViews.userId, ctx.user.id),
        eq(schema.savedViews.viewKey, "ncaa_players"),
      ),
    )
    .orderBy(asc(schema.savedViews.name));

  const colsParam = Array.isArray(sp.cols) ? sp.cols : sp.cols ? sp.cols.split(",") : null;
  const visible = new Set(colsParam ?? COLUMNS.map((c) => c.key));
  const show = (key: string) => visible.has(key);

  const page = Math.max(1, Number(sp.page) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Current filter state as a querystring (drives export, saved views, paging).
  const filterEntries = Object.entries(sp)
    .filter(([k, v]) => v && k !== "page" && k !== "saveAs")
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v] as [string, string]);
  const filterQuery = new URLSearchParams(filterEntries).toString();
  const pageHref = (n: number) => `/scouting/players?${filterQuery}${filterQuery ? "&" : ""}page=${n}`;

  const selectCls =
    "rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm text-ink-secondary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">NCAA players</h1>
        <div className="flex items-center gap-3">
          <a
            href={`/api/export/prospects${filterQuery ? `?${filterQuery}` : ""}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
          >
            Export CSV (filtered)
          </a>
          <p className="text-xs text-ink-muted">Latest-season stats; per-60 not computed without TOI</p>
        </div>
      </div>

      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">Saved views:</span>
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs">
              <Link
                href={`/scouting/players?${(v.filters as { query?: string }).query ?? ""}`}
                className="text-accent-text hover:underline"
              >
                {v.name}
              </Link>
              <form action={deleteScoutingViewAction} className="inline">
                <input type="hidden" name="organizationId" value={ctx.org.id} />
                <input type="hidden" name="viewId" value={v.id} />
                <button aria-label={`Delete saved view ${v.name}`} className="text-ink-muted hover:text-critical">×</button>
              </form>
            </span>
          ))}
        </div>
      )}

      <form method="get" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name…" className={`${selectCls} w-40`} />
          <select name="pos" defaultValue={sp.pos ?? ""} className={selectCls}>
            <option value="">All positions</option>
            {["C", "LW", "RW", "D", "G"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select name="conf" defaultValue={sp.conf ?? ""} className={selectCls}>
            <option value="">All conferences</option>
            {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="school" defaultValue={sp.school ?? ""} className={selectCls}>
            <option value="">All schools</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="class" defaultValue={sp.class ?? ""} className={selectCls}>
            <option value="">All classes</option>
            {["freshman", "sophomore", "junior", "senior", "graduate"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select name="hand" defaultValue={sp.hand ?? ""} className={selectCls}>
            <option value="">Any hand</option>
            <option value="L">L</option>
            <option value="R">R</option>
          </select>
          <select name="draft" defaultValue={sp.draft ?? ""} className={selectCls}>
            <option value="">Any draft status</option>
            <option value="drafted">Drafted only</option>
            <option value="undrafted">Undrafted only</option>
            <option value="cfa">CFA eligible only</option>
          </select>
          <input name="maxAge" defaultValue={sp.maxAge ?? ""} placeholder="Max age" inputMode="numeric" className={`${selectCls} w-24`} />
          <input name="minPpg" defaultValue={sp.minPpg ?? ""} placeholder="Min PPG" inputMode="decimal" className={`${selectCls} w-24`} />
          <input name="minGp" defaultValue={sp.minGp ?? ""} placeholder="Min GP" inputMode="numeric" className={`${selectCls} w-24`} />
          <select name="sort" defaultValue={sp.sort ?? "ppg"} className={selectCls}>
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
          </select>
          <select name="dir" defaultValue={sp.dir ?? "desc"} className={selectCls}>
            <option value="desc">High → low</option>
            <option value="asc">Low → high</option>
          </select>
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Apply</button>
          <Link href="/scouting/players" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
            Reset
          </Link>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">Columns…</summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-ink-secondary">
                <input type="checkbox" name="cols" value={c.key} defaultChecked={show(c.key)} className="accent-[var(--color-accent,theme(colors.blue.500))]" />
                {c.label}
              </label>
            ))}
          </div>
        </details>
      </form>

      <form action={saveScoutingViewAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="organizationId" value={ctx.org.id} />
        <input type="hidden" name="viewKey" value="ncaa_players" />
        <input type="hidden" name="filters" value={filterQuery} />
        <input name="name" placeholder="Save current filters as…" maxLength={80} required className={`${selectCls} w-56`} />
        <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">Save view</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No prospects match" body="Adjust the filters, or import NCAA players under Data imports." cta={{ href: "/imports", label: "Data imports" }} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Player</Th>
                  {show("pos") && <Th>Pos</Th>}
                  {show("hand") && <Th>Hand</Th>}
                  {show("school") && <Th>School</Th>}
                  {show("conf") && <Th>Conference</Th>}
                  {show("class") && <Th>Class</Th>}
                  {show("age") && <Th right>Age</Th>}
                  {show("gp") && <Th right>GP</Th>}
                  {show("g") && <Th right>G</Th>}
                  {show("a") && <Th right>A</Th>}
                  {show("p") && <Th right>P</Th>}
                  {show("ppg") && <Th right>PPG</Th>}
                  {show("spg") && <Th right>S/G</Th>}
                  {show("draft") && <Th>Draft status</Th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.p.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td>
                      <Link href={`/scouting/players/${r.p.id}`} className="font-medium hover:text-accent-text">{r.p.fullName}</Link>
                    </Td>
                    {show("pos") && <Td>{r.p.position}</Td>}
                    {show("hand") && <Td className="text-ink-secondary">{r.p.shootsCatches ?? "—"}</Td>}
                    {show("school") && <Td className="max-w-44 truncate text-ink-secondary">{r.schoolName ?? "—"}</Td>}
                    {show("conf") && <Td className="max-w-44 truncate text-ink-secondary">{r.conferenceName ?? "—"}</Td>}
                    {show("class") && <Td className="text-ink-secondary">{r.p.classYear}</Td>}
                    {show("age") && <Td right>{r.age ?? "—"}</Td>}
                    {show("gp") && <Td right>{r.season?.gamesPlayed ?? "—"}</Td>}
                    {show("g") && <Td right>{r.season?.goals ?? "—"}</Td>}
                    {show("a") && <Td right>{r.season?.assists ?? "—"}</Td>}
                    {show("p") && <Td right>{r.derived?.points ?? "—"}</Td>}
                    {show("ppg") && <Td right>{r.derived?.ppg?.toFixed(2) ?? "—"}</Td>}
                    {show("spg") && <Td right>{r.derived?.shotsPerGame?.toFixed(1) ?? "—"}</Td>}
                    {show("draft") && (
                      <Td className="text-ink-secondary">
                        {r.p.nhlDraftStatus === "drafted"
                          ? `R${r.p.draftRound ?? "?"} ${r.p.draftYear ?? ""} · ${r.p.nhlRightsHolder ?? "rights held"}`
                          : r.p.collegeFreeAgentStatus === "eligible"
                            ? "Undrafted · CFA eligible"
                            : "Undrafted"}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
            <span>
              {rows.length} prospects · page {page} of {pageCount}
            </span>
            <span className="flex gap-2">
              {page > 1 && <Link href={pageHref(page - 1)} className="text-accent-text hover:underline">← Prev</Link>}
              {page < pageCount && <Link href={pageHref(page + 1)} className="text-accent-text hover:underline">Next →</Link>}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
