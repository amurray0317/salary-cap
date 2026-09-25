import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { getTeamSituations, type SituationsResult } from "@/server/services/situationsService";
import type { TeamSituations } from "@/lib/connectors/nhlSituations";
import { NHL_CREDIT } from "@/lib/connectors/nhl";
import { seasonLabel, seasonStartYear } from "@/lib/season";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Special teams & game states" };

type Fmt = "pct" | "pct0" | "int" | "diff" | "dec2" | "mmss" | "pdo";
interface Col {
  key: string;
  label: string;
  /** Definition shown on hover. */
  title: string;
  get: (t: TeamSituations) => number | null;
  fmt: Fmt;
  /** 1 = higher is better, −1 = lower is better, 0 = neutral (no shading). */
  better: 1 | -1 | 0;
}

const TABS: Array<{ id: string; label: string; blurb: string; cols: Col[] }> = [
  {
    id: "pp",
    label: "Power play",
    blurb: "Man-advantage results. 5v4 rates are per 60 minutes of 5-on-4 time; xGF/60 is our expected-goals model on the same shots.",
    cols: [
      { key: "ppPct", label: "PP%", title: "Power-play goals ÷ opportunities", get: (t) => t.pp.pct, fmt: "pct", better: 1 },
      {
        key: "ppNet",
        label: "Net PP%",
        title: "(PP goals − shorthanded goals allowed) ÷ opportunities",
        get: (t) => t.pp.netPct,
        fmt: "pct",
        better: 1,
      },
      { key: "ppOpp", label: "Opp", title: "Power-play opportunities", get: (t) => t.pp.opportunities, fmt: "int", better: 1 },
      { key: "ppG", label: "PPG", title: "Power-play goals", get: (t) => t.pp.goals, fmt: "int", better: 1 },
      { key: "ppToi", label: "PP TOI/GP", title: "Power-play time per game", get: (t) => t.pp.toiPerGame, fmt: "mmss", better: 0 },
      { key: "pp54", label: "5v4 %", title: "5-on-4 goals ÷ 5-on-4 opportunities", get: (t) => t.pp.pct5v4, fmt: "pct", better: 1 },
      { key: "gf60", label: "5v4 GF/60", title: "Goals per 60 minutes of 5-on-4 play", get: (t) => t.pp.gf60_5v4, fmt: "dec2", better: 1 },
      {
        key: "xgf60",
        label: "5v4 xGF/60",
        title: "RosterIQ expected goals per 60 minutes of 5-on-4 play (chance quality, not finishing)",
        get: (t) => t.pp.xgf60_5v4,
        fmt: "dec2",
        better: 1,
      },
      {
        key: "pp53",
        label: "5v3 %",
        title: "5-on-3 goals ÷ 5-on-3 opportunities (small samples)",
        get: (t) => ratio(t.pp.goals5v3, t.pp.opportunities5v3),
        fmt: "pct0",
        better: 1,
      },
      {
        key: "shga",
        label: "SHGA",
        title: "Shorthanded goals allowed while on the power play",
        get: (t) => t.pp.shGoalsAgainst,
        fmt: "int",
        better: -1,
      },
    ],
  },
  {
    id: "pk",
    label: "Penalty kill",
    blurb: "Shorthanded results. 4v5 rates are per 60 minutes of 4-on-5 time; lower goals and xG against are better.",
    cols: [
      { key: "pkPct", label: "PK%", title: "1 − PP goals allowed ÷ times shorthanded", get: (t) => t.pk.pct, fmt: "pct", better: 1 },
      { key: "pkNet", label: "Net PK%", title: "Penalty kill counting shorthanded goals scored", get: (t) => t.pk.netPct, fmt: "pct", better: 1 },
      {
        key: "tsh",
        label: "TSH",
        title: "Times shorthanded (penalties taken that produced a power play)",
        get: (t) => t.pk.timesShorthanded,
        fmt: "int",
        better: -1,
      },
      { key: "ppga", label: "PPGA", title: "Power-play goals allowed", get: (t) => t.pk.goalsAgainst, fmt: "int", better: -1 },
      { key: "pkToi", label: "PK TOI/GP", title: "Shorthanded time per game", get: (t) => t.pk.toiPerGame, fmt: "mmss", better: -1 },
      { key: "pk45", label: "4v5 %", title: "4-on-5 kill rate", get: (t) => t.pk.pct4v5, fmt: "pct", better: 1 },
      { key: "ga60", label: "4v5 GA/60", title: "Goals allowed per 60 minutes of 4-on-5 play", get: (t) => t.pk.ga60_4v5, fmt: "dec2", better: -1 },
      {
        key: "xga60",
        label: "4v5 xGA/60",
        title: "RosterIQ expected goals allowed per 60 minutes of 4-on-5 play",
        get: (t) => t.pk.xga60_4v5,
        fmt: "dec2",
        better: -1,
      },
      { key: "shgf", label: "SHGF", title: "Shorthanded goals scored", get: (t) => t.pk.shGoalsFor, fmt: "int", better: 1 },
      {
        key: "sti",
        label: "PP%+PK%",
        title: "Special-teams index: PP% + PK% (above 100% beats an average team)",
        get: (t) => t.specialTeamsIndex,
        fmt: "pct",
        better: 1,
      },
    ],
  },
  {
    id: "ev5",
    label: "5 on 5",
    blurb: "Even strength with both goalies in. xG and shot-attempt shares describe territory and chance quality; PDO far from 100 tends to regress.",
    cols: [
      { key: "gfPct", label: "GF%", title: "5v5 goals for ÷ (for + against)", get: (t) => t.ev5.gfPct, fmt: "pct", better: 1 },
      { key: "xgfPct", label: "xGF%", title: "RosterIQ 5v5 expected-goals share", get: (t) => t.ev5.xgfPct, fmt: "pct", better: 1 },
      { key: "cf", label: "SAT%", title: "5v5 shot-attempt share (Corsi)", get: (t) => t.ev5.satPct, fmt: "pct", better: 1 },
      {
        key: "cfClose",
        label: "SAT% close",
        title: "5v5 shot-attempt share with the score close",
        get: (t) => t.ev5.satPctClose,
        fmt: "pct",
        better: 1,
      },
      { key: "xgf60", label: "xGF/60", title: "RosterIQ 5v5 expected goals for per 60", get: (t) => t.ev5.xgf60, fmt: "dec2", better: 1 },
      { key: "xga60", label: "xGA/60", title: "RosterIQ 5v5 expected goals against per 60", get: (t) => t.ev5.xga60, fmt: "dec2", better: -1 },
      { key: "gf60", label: "GF/60", title: "5v5 goals for per 60", get: (t) => t.ev5.gf60, fmt: "dec2", better: 1 },
      { key: "ga60", label: "GA/60", title: "5v5 goals against per 60", get: (t) => t.ev5.ga60, fmt: "dec2", better: -1 },
      { key: "sh", label: "Sh%", title: "5v5 shooting percentage", get: (t) => t.ev5.shootingPct, fmt: "pct", better: 1 },
      { key: "sv", label: "Sv%", title: "5v5 save percentage", get: (t) => t.ev5.savePct, fmt: "pct", better: 1 },
      { key: "pdo", label: "PDO", title: "5v5 Sh% + Sv% (×100); luck-heavy, regresses toward 100", get: (t) => t.ev5.pdo, fmt: "pdo", better: 0 },
      {
        key: "oz",
        label: "OZ start%",
        title: "Share of 5v5 non-neutral faceoffs taken in the offensive zone",
        get: (t) => t.ev5.ozStartPct,
        fmt: "pct",
        better: 0,
      },
      { key: "toi", label: "5v5 TOI/GP", title: "5v5 time per game", get: (t) => t.ev5.toiPerGame, fmt: "mmss", better: 0 },
    ],
  },
  {
    id: "other",
    label: "4v4 · 3v3 · empty net",
    blurb:
      "Rarer states. 3v3 is regular-season overtime. Empty-net goals go into an unattended net; extra-attacker goals come with your own goalie pulled.",
    cols: [
      { key: "gf44", label: "4v4 GF", title: "Goals for at 4-on-4", get: (t) => t.other.gf4v4, fmt: "int", better: 1 },
      { key: "ga44", label: "4v4 GA", title: "Goals against at 4-on-4", get: (t) => t.other.ga4v4, fmt: "int", better: -1 },
      { key: "gf33", label: "3v3 GF", title: "Goals for at 3-on-3 (overtime)", get: (t) => t.other.gf3v3, fmt: "int", better: 1 },
      { key: "ga33", label: "3v3 GA", title: "Goals against at 3-on-3 (overtime)", get: (t) => t.other.ga3v3, fmt: "int", better: -1 },
      {
        key: "ot",
        label: "OT goals ±",
        title: "Overtime goals for minus against (all OT strengths)",
        get: (t) => diff(t.periods.gf[3], t.periods.ga[3]),
        fmt: "diff",
        better: 1,
      },
      { key: "engf", label: "ENG for", title: "Goals scored into the opponent's empty net", get: (t) => t.other.gfEmptyNet, fmt: "int", better: 1 },
      { key: "enga", label: "ENG against", title: "Goals allowed into your empty net", get: (t) => t.other.gaEmptyNet, fmt: "int", better: -1 },
      {
        key: "xaf",
        label: "6v5 GF",
        title: "Goals scored with your goalie pulled for an extra attacker",
        get: (t) => t.other.gfExtraAttacker,
        fmt: "int",
        better: 1,
      },
      {
        key: "xaa",
        label: "6v5 GA",
        title: "Goals allowed while the opponent had an extra attacker",
        get: (t) => t.other.gaExtraAttacker,
        fmt: "int",
        better: -1,
      },
      { key: "ps", label: "PS goals", title: "Penalty-shot goals", get: (t) => t.other.penaltyShotGoals, fmt: "int", better: 1 },
    ],
  },
  {
    id: "so",
    label: "Shootout",
    blurb: "Regular-season shootouts. Small samples: a handful of attempts moves every percentage.",
    cols: [
      { key: "sog", label: "SO GP", title: "Games decided by shootout", get: (t) => t.shootout.games, fmt: "int", better: 0 },
      { key: "sow", label: "W", title: "Shootout wins", get: (t) => t.shootout.wins, fmt: "int", better: 1 },
      { key: "sol", label: "L", title: "Shootout losses", get: (t) => t.shootout.losses, fmt: "int", better: -1 },
      { key: "sowp", label: "Win%", title: "Shootout win percentage", get: (t) => t.shootout.winPct, fmt: "pct0", better: 1 },
      { key: "sogl", label: "Goals", title: "Shootout goals / attempts", get: (t) => t.shootout.goals, fmt: "int", better: 1 },
      { key: "sosh", label: "Att", title: "Shootout attempts", get: (t) => t.shootout.shots, fmt: "int", better: 0 },
      { key: "sop", label: "Sh%", title: "Shootout conversion", get: (t) => t.shootout.shootingPct, fmt: "pct0", better: 1 },
      { key: "sosv", label: "Sv%", title: "Shootout save percentage", get: (t) => t.shootout.savePct, fmt: "pct0", better: 1 },
    ],
  },
  {
    id: "fo",
    label: "Faceoffs",
    blurb: "Faceoff win rates by zone and strength. Offensive-zone wins start possessions near the net; defensive-zone losses do the opposite.",
    cols: [
      { key: "fo", label: "FO%", title: "All faceoffs won", get: (t) => t.faceoffs.pct, fmt: "pct", better: 1 },
      { key: "ozfo", label: "OZ FO%", title: "Offensive-zone faceoffs won", get: (t) => t.faceoffs.ozPct, fmt: "pct", better: 1 },
      { key: "nzfo", label: "NZ FO%", title: "Neutral-zone faceoffs won", get: (t) => t.faceoffs.nzPct, fmt: "pct", better: 1 },
      { key: "dzfo", label: "DZ FO%", title: "Defensive-zone faceoffs won", get: (t) => t.faceoffs.dzPct, fmt: "pct", better: 1 },
      { key: "ozn", label: "OZ draws", title: "Offensive-zone faceoffs taken", get: (t) => t.faceoffs.oz, fmt: "int", better: 1 },
      { key: "dzn", label: "DZ draws", title: "Defensive-zone faceoffs taken", get: (t) => t.faceoffs.dz, fmt: "int", better: -1 },
      { key: "evfo", label: "EV FO%", title: "Even-strength faceoffs won", get: (t) => t.faceoffs.evPct, fmt: "pct", better: 1 },
      { key: "ppfo", label: "PP FO%", title: "Faceoffs won on the power play", get: (t) => t.faceoffs.ppPct, fmt: "pct", better: 1 },
      { key: "shfo", label: "SH FO%", title: "Faceoffs won while shorthanded", get: (t) => t.faceoffs.shPct, fmt: "pct", better: 1 },
    ],
  },
  {
    id: "score",
    label: "Score state",
    blurb: "How results depend on the scoreboard: scoring first, protecting leads, coming back, and goals by period.",
    cols: [
      { key: "sf", label: "Scored 1st W%", title: "Win percentage when scoring first", get: (t) => t.score.firstWinPct, fmt: "pct0", better: 1 },
      { key: "sfg", label: "GP", title: "Games scoring first", get: (t) => t.score.firstGames, fmt: "int", better: 1 },
      {
        key: "tf",
        label: "Trailed 1st W%",
        title: "Win percentage when the opponent scored first",
        get: (t) => t.score.trailFirstWinPct,
        fmt: "pct0",
        better: 1,
      },
      {
        key: "l2",
        label: "Lead after 2 W%",
        title: "Win percentage when leading after two periods",
        get: (t) => t.score.winPctLead2,
        fmt: "pct0",
        better: 1,
      },
      {
        key: "blown",
        label: "Blown 3rd",
        title: "Regulation losses after leading after two periods",
        get: (t) => t.score.lossLead2,
        fmt: "int",
        better: -1,
      },
      {
        key: "t2",
        label: "Trail after 2 W%",
        title: "Win percentage when trailing after two periods",
        get: (t) => t.score.winPctTrail2,
        fmt: "pct0",
        better: 1,
      },
      { key: "cb", label: "3rd comebacks", title: "Wins after trailing after two periods", get: (t) => t.score.winsTrail2, fmt: "int", better: 1 },
      {
        key: "p1",
        label: "P1 ±",
        title: "First-period goal differential",
        get: (t) => diff(t.periods.gf[0], t.periods.ga[0]),
        fmt: "diff",
        better: 1,
      },
      {
        key: "p2",
        label: "P2 ±",
        title: "Second-period goal differential",
        get: (t) => diff(t.periods.gf[1], t.periods.ga[1]),
        fmt: "diff",
        better: 1,
      },
      {
        key: "p3",
        label: "P3 ±",
        title: "Third-period goal differential",
        get: (t) => diff(t.periods.gf[2], t.periods.ga[2]),
        fmt: "diff",
        better: 1,
      },
    ],
  },
  {
    id: "style",
    label: "Pressure & physical",
    blurb:
      "Event rates per 60 minutes (all strengths). Hits, takeaways and giveaways are recorded by each arena's scorers and are known to vary by rink; compare with care.",
    cols: [
      { key: "hits", label: "Hits/60", title: "Hits delivered per 60", get: (t) => t.physical.hits60, fmt: "dec2", better: 0 },
      { key: "take", label: "Takeaways/60", title: "Takeaways per 60", get: (t) => t.physical.takeaways60, fmt: "dec2", better: 1 },
      { key: "give", label: "Giveaways/60", title: "Giveaways per 60", get: (t) => t.physical.giveaways60, fmt: "dec2", better: -1 },
      { key: "blk", label: "Blocks/60", title: "Opponent shots blocked per 60", get: (t) => t.physical.blocks60, fmt: "dec2", better: 0 },
      {
        key: "ratio",
        label: "Take/Give",
        title: "Takeaways ÷ giveaways",
        get: (t) => ratio(t.physical.takeaways60, t.physical.giveaways60),
        fmt: "dec2",
        better: 1,
      },
    ],
  },
];

function ratio(a: number | null, b: number | null) {
  return a === null || b === null || b === 0 ? null : a / b;
}
function diff(a: number | null | undefined, b: number | null | undefined) {
  return a == null || b == null ? null : a - b;
}

function fmt(v: number | null, f: Fmt): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (f) {
    case "pct":
      return `${(v * 100).toFixed(1)}`;
    case "pct0":
      return `${Math.round(v * 100)}`;
    case "int":
      return String(Math.round(v));
    case "diff":
      return v > 0 ? `+${Math.round(v)}` : v < 0 ? `−${Math.abs(Math.round(v))}` : "0";
    case "dec2":
      return v.toFixed(2);
    case "pdo":
      return (v * 100).toFixed(1);
    case "mmss": {
      const s = Math.round(v);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }
}

/** Background tint by league rank: green for the best third, red for the worst third. */
function tint(v: number | null, sorted: number[], better: 1 | -1 | 0): React.CSSProperties | undefined {
  if (better === 0 || v === null || sorted.length < 3) return undefined;
  const rank = sorted.findIndex((x) => x === v) / (sorted.length - 1); // 0 = lowest
  const q = better === 1 ? rank : 1 - rank; // 1 = best
  const strength = Math.abs(q - 0.5) * 2; // 0 middle → 1 extremes
  if (strength < 0.34) return undefined;
  const a = (0.06 + 0.2 * (strength - 0.34)).toFixed(3);
  return { background: q > 0.5 ? `rgba(21,128,61,${a})` : `rgba(185,28,28,${a})` };
}

function seasonsList(now: Date) {
  const latest = seasonStartYear(now);
  return Array.from({ length: latest - 2009 }, (_, i) => seasonLabel(latest - i));
}

export default async function SituationsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; type?: string; tab?: string; sort?: string; dir?: string }>;
}) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const seasons = seasonsList(new Date());
  const gameType = sp.type === "playoffs" ? "playoffs" : "regular";
  const tab = TABS.find((t) => t.id === sp.tab) ?? TABS[0]!;
  let season = sp.season && seasons.includes(sp.season) ? sp.season : seasons[0]!;

  let data: SituationsResult | null = null;
  let error: string | null = null;
  let fellBack = false;
  try {
    data = await getTeamSituations(season, gameType);
    // Before opening night the new season has no games: show the last one, and say so.
    if (data.teams.length === 0 && !sp.season && seasons[1]) {
      season = seasons[1];
      data = await getTeamSituations(season, gameType);
      fellBack = true;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const sortCol = tab.cols.find((c) => c.key === sp.sort) ?? tab.cols.find((c) => c.better !== 0) ?? tab.cols[0]!;
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sortCol.better === -1 ? "asc" : "desc";
  const teams = [...(data?.teams ?? [])].sort((a, b) => {
    const x = sortCol.get(a);
    const y = sortCol.get(b);
    if (x === null) return 1;
    if (y === null) return -1;
    return dir === "asc" ? x - y : y - x;
  });
  const sortedValues = new Map(
    tab.cols.map((c) => [
      c.key,
      teams
        .map(c.get)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b),
    ]),
  );
  const myTeam = ctx.team?.abbreviation;
  const href = (p: Partial<{ season: string; type: string; tab: string; sort: string; dir: string }>) => {
    const q = new URLSearchParams({ season, type: gameType, tab: tab.id, ...p });
    return `/games/situations?${q.toString()}`;
  };
  const avg = (c: Col) => {
    const v = sortedValues.get(c.key)!;
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Special teams &amp; game states</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Every NHL team by game state: power play, penalty kill, 5-on-5, 4-on-4, 3-on-3 overtime, empty net, shootout, faceoffs and score state.
            Official league numbers{data?.hasXg ? ", with RosterIQ expected goals for chance quality" : ""}.
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/games/situations">
          <input type="hidden" name="tab" value={tab.id} />
          <select name="season" defaultValue={season} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm" aria-label="Season">
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={gameType} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm" aria-label="Games">
            <option value="regular">Regular season</option>
            <option value="playoffs">Playoffs</option>
          </select>
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">Show</button>
        </form>
      </div>

      <nav aria-label="Game states" className="flex gap-1 overflow-x-auto rounded-xl bg-surface p-1 shadow-sm ring-1 ring-line">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ tab: t.id, sort: "", dir: "" })}
            aria-current={t.id === tab.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${t.id === tab.id ? "bg-linear-to-r from-accent to-accent-2 text-white shadow" : "text-ink-secondary hover:bg-subtle"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {fellBack && (
        <p className="rounded-md border border-ice/30 bg-accent-soft px-3 py-2 text-sm text-ink-secondary">
          The {seasons[0]} regular season has not started yet, so this shows {season}. It switches over automatically after opening night.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          Could not load NHL data: {error}
        </p>
      )}

      {data && (
        <Card title={`${tab.label} — ${season} ${gameType === "playoffs" ? "playoffs" : "regular season"}`}>
          <p className="mb-3 text-sm text-ink-muted">{tab.blurb}</p>
          {teams.length === 0 ? (
            <p className="text-sm text-ink-muted">No games in this selection yet.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 rounded-l-md bg-subtle px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                      #
                    </th>
                    <th className="sticky left-7 z-10 bg-subtle px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                      Team
                    </th>
                    <th className="bg-subtle px-2.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">GP</th>
                    {tab.cols.map((c) => {
                      const active = c.key === sortCol.key;
                      const next = active && dir === "desc" ? "asc" : active ? "desc" : c.better === -1 ? "asc" : "desc";
                      return (
                        <th
                          key={c.key}
                          title={c.title}
                          className="bg-subtle px-2.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-secondary last:rounded-r-md"
                        >
                          <Link
                            href={href({ sort: c.key, dir: next })}
                            className={`whitespace-nowrap hover:text-accent-text ${active ? "text-accent-text" : ""}`}
                          >
                            {c.label}
                            {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t, i) => {
                    const mine = t.team === myTeam;
                    return (
                      <tr key={t.teamId} className={mine ? "font-semibold" : ""}>
                        <td className={`sticky left-0 border-b border-line/50 bg-surface px-2.5 py-1 text-ink-muted ${mine ? "bg-accent-soft" : ""}`}>
                          {i + 1}
                        </td>
                        <td
                          className={`sticky left-7 whitespace-nowrap border-b border-line/50 bg-surface px-2.5 py-1 ${mine ? "bg-accent-soft" : ""}`}
                          title={t.name}
                        >
                          <span className="font-semibold">{t.team}</span>
                          <span className="ml-2 hidden text-ink-muted xl:inline">{t.name}</span>
                        </td>
                        <td className="border-b border-line/50 px-2.5 py-1 text-right text-ink-muted">{t.gp}</td>
                        {tab.cols.map((c) => {
                          const v = c.get(t);
                          return (
                            <td
                              key={c.key}
                              className="border-b border-line/50 px-2.5 py-1 text-right tabular-nums"
                              style={tint(v, sortedValues.get(c.key)!, c.better)}
                            >
                              {fmt(v, c.fmt)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-ink-secondary">
                    <td className="px-2.5 py-2" />
                    <td className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wider">Team average</td>
                    <td className="px-2.5 py-2" />
                    {tab.cols.map((c) => (
                      <td key={c.key} className="px-2.5 py-2 text-right font-semibold tabular-nums">
                        {fmt(avg(c), c.fmt)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            Percentages shown ×100. Green and red mark the league&apos;s best and worst thirds. Hover a column for its definition; click to sort.
            Power-play report goals (PPG, 5v4 %) count goals during a penalty; per-60 rates count goals by who was on the ice, so the two can differ
            by a goal or two.{" "}
            {data.hasXg
              ? "xG columns use the RosterIQ model (see Analytics lab → Models). "
              : "xG columns appear for seasons the RosterIQ model has scored (2021-22 on). "}
            {NHL_CREDIT}. Fetched {new Date(data.fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC.
          </p>
        </Card>
      )}
    </div>
  );
}
