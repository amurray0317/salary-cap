import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { MODELS_DIR } from "@/lib/connectors/rosteriqModels";
import { parseCsv } from "@/lib/import/csvParse";
import { Card, EmptyState } from "@/components/ui";
import { PlayerPhoto, TeamLogo } from "@/components/NhlImages";

export const metadata: Metadata = { title: "WAR & player impact" };

const DIR = path.join(MODELS_DIR, "rosteriq-war-v0");
type Row = Record<string, string>;

const COLS = [
  { key: "war", label: "WAR", title: "Wins above replacement: goals above replacement ÷ goals per win", digits: 2 },
  { key: "gar", label: "GAR", title: "Goals above replacement (sum of the components)", digits: 1 },
  { key: "ev_off", label: "EV off", title: "5v5 offence: RAPM impact on team xG for per 60 × 5v5 minutes, above replacement (goals)", digits: 1 },
  { key: "ev_def", label: "EV def", title: "5v5 defence: RAPM impact on xG against per 60 × 5v5 minutes, above replacement (goals)", digits: 1 },
  { key: "pp", label: "PP", title: "Power-play offence (5v4 RAPM), above replacement (goals)", digits: 1 },
  { key: "sh", label: "SH", title: "Penalty-kill defence (4v5 RAPM), above replacement (goals)", digits: 1 },
  { key: "penalties", label: "Pens", title: "Penalties drawn minus taken, valued at a power play's net goals", digits: 1 },
  { key: "finishing", label: "Finish", title: "Goals minus individual xG, above replacement (goals)", digits: 1 },
  { key: "toi_all", label: "TOI", title: "Minutes played (all strengths, from shift charts)", digits: 0 },
] as const;

function seasons(): string[] {
  try {
    return fs
      .readdirSync(DIR)
      .map((f) => f.match(/^war_(\d{8})\.csv$/)?.[1])
      .filter((s): s is string => !!s)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
const label = (id: string) => `${id.slice(0, 4)}-${id.slice(6)}`;

export default async function WarPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; pos?: string; team?: string; sort?: string; kind?: string }>;
}) {
  await resolveAppContext();
  const sp = await searchParams;
  const all = seasons();
  if (all.length === 0) return <EmptyState title="WAR not built yet" body="Run the WAR pipeline (analytics/README.md, step 10)." />;
  const season = sp.season && all.includes(sp.season) ? sp.season : all[0]!;
  const card = JSON.parse(fs.readFileSync(path.join(DIR, "metrics.json"), "utf8")) as {
    seasons: Record<
      string,
      {
        goals_per_win: number;
        penalty_value_goals: number;
        goalie_replacement_gsax_per_xg: number;
        split_half_reliability_ev5: Record<string, { r_full_spearman_brown: number }>;
        shots_matched_to_stints: { strength_agreement: number };
      }
    >;
  };
  const c = card.seasons[season];
  const { headers, rows: raw } = parseCsv(fs.readFileSync(path.join(DIR, `war_${season}.csv`), "utf8"), { maxRows: 5000 });
  const rows: Row[] = raw.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  const kind = sp.kind === "goalie" ? "goalie" : "skater";
  const sortKey = kind === "skater" && COLS.some((x) => x.key === sp.sort) ? sp.sort! : "war";
  let list = rows.filter((r) => r.kind === kind);
  if (kind === "skater" && (sp.pos === "F" || sp.pos === "D")) list = list.filter((r) => r.pos === sp.pos);
  if (sp.team) list = list.filter((r) => r.team === sp.team);
  list = list.sort((a, b) => Number(b[sortKey]) - Number(a[sortKey])).slice(0, 150);
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  const href = (p: Record<string, string>) =>
    `/analytics/war?${new URLSearchParams({ season, kind, ...(sp.pos ? { pos: sp.pos } : {}), ...(sp.team ? { team: sp.team } : {}), ...p })}`;
  const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? "—" : Number(v).toFixed(d));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>WAR &amp; player impact</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Wins above replacement for every NHL skater and goalie, built from NHL shift charts and RosterIQ expected goals: 5v5 offence and defence
            and special teams by regularised adjusted plus-minus (RAPM), plus penalties, finishing and goaltending.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/analytics/war">
          <select name="season" defaultValue={season} aria-label="Season" className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm">
            {all.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <select name="kind" defaultValue={kind} aria-label="Players" className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm">
            <option value="skater">Skaters</option>
            <option value="goalie">Goalies</option>
          </select>
          {kind === "skater" && (
            <select
              name="pos"
              defaultValue={sp.pos ?? ""}
              aria-label="Position"
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
            >
              <option value="">F and D</option>
              <option value="F">Forwards</option>
              <option value="D">Defence</option>
            </select>
          )}
          <select
            name="team"
            defaultValue={sp.team ?? ""}
            aria-label="Team"
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">Show</button>
        </form>
      </div>

      <Card title={`${kind === "skater" ? "Skaters" : "Goalies"} — ${label(season)} regular season`}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-secondary">
                <th className="py-2 font-semibold">#</th>
                <th className="py-2 font-semibold">Player</th>
                {kind === "skater"
                  ? COLS.map((x) => (
                      <th key={x.key} title={x.title} className="py-2 text-right font-semibold">
                        <Link href={href({ sort: x.key })} className={`hover:text-accent-text ${sortKey === x.key ? "text-accent-text" : ""}`}>
                          {x.label}
                          {sortKey === x.key ? " ↓" : ""}
                        </Link>
                      </th>
                    ))
                  : ["WAR", "GAR", "GSAx", "xG faced", "Goals allowed"].map((h) => (
                      <th key={h} className="py-2 text-right font-semibold">
                        {h}
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.player_id} className="border-t border-line/50">
                  <td className="py-1.5 text-ink-muted">{i + 1}</td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <PlayerPhoto playerId={r.player_id} name={r.name ?? ""} size={26} />
                      <Link href={`/real-data/players/${r.player_id}`} className="font-medium hover:text-accent-text">
                        {r.name}
                      </Link>
                      {r.team && <TeamLogo team={r.team} size={16} />}
                      <span className="text-xs text-ink-muted">{r.pos}</span>
                    </span>
                  </td>
                  {kind === "skater"
                    ? COLS.map((x) => (
                        <td key={x.key} className={`py-1.5 text-right tabular-nums ${x.key === "war" ? "font-semibold" : ""}`}>
                          {num(r[x.key], x.digits)}
                        </td>
                      ))
                    : (["war", "gar", "gsax", "xg_faced", "ga"] as const).map((k, j) => (
                        <td key={k} className={`py-1.5 text-right tabular-nums ${j === 0 ? "font-semibold" : ""}`}>
                          {num(r[k], j < 2 ? 2 : 1)}
                        </td>
                      ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          {kind === "skater"
            ? "Skaters with 200+ 5v5 minutes; top 150 shown. Hover a column for its definition; click to sort."
            : "Every goalie; GSAx = xG faced − goals allowed."}{" "}
          Goals per win: {c?.goals_per_win.toFixed(2)} (team records, 2021-22 to 2025-26). A power-play-drawing minor is worth{" "}
          {c?.penalty_value_goals.toFixed(3)} goals.
        </p>
      </Card>

      <Card title="How much to trust it">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-secondary">
          <li>
            Offence is the most repeatable part: 5v5 offence estimates correlate {c?.split_half_reliability_ev5.off?.r_full_spearman_brown.toFixed(2)}{" "}
            between halves of the season, defence {c?.split_half_reliability_ev5.def?.r_full_spearman_brown.toFixed(2)}. From 2024-25 to 2025-26,
            total WAR correlated 0.49 and 5v5 defence 0.36 for skaters with 500+ minutes both years: one season of WAR is a strong hint, not a
            verdict.
          </li>
          <li>
            Goaltending barely repeats year to year (goals saved above expected per shot: 0.07 between the two seasons for 47 goalies), so a
            goalie&apos;s WAR is mostly this season&apos;s story. Goalie WAR also leans on the replacement level: goalies outside the top 64 by shots
            faced allowed {c ? `${Math.abs(c.goalie_replacement_gsax_per_xg * 100).toFixed(1)}%` : "several percent"} more than expected this season,
            a small group, which puts starters&apos; totals above skaters&apos;. Compare goalies with goalies.
          </li>
          <li>
            Shift charts put the right number of skaters on the ice for{" "}
            {c ? `${(c.shots_matched_to_stints.strength_agreement * 100).toFixed(1)}%` : "about 99%"} of shots. The NHL did not publish shift charts
            for some games (57 in 2024-25), which are left out.
          </li>
          <li>
            Built like Evolving-Hockey&apos;s WAR (RAPM components, replacement level, goals per win) but on expected goals, without a box-score stage
            or zone-start adjustment, so totals run smaller (the best players near 4 WAR) and the order is what to read.
          </li>
        </ul>
      </Card>
    </div>
  );
}
