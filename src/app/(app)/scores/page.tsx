import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { zoneName } from "@/lib/timezone";
import { getScoreboard } from "@/server/services/scoresService";
import type { ScoreGame } from "@/lib/connectors/nhlScores";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState } from "@/components/ui";
import { TeamLogo } from "@/components/NhlImages";

export const metadata: Metadata = { title: "Scores" };
export const dynamic = "force-dynamic";

const STATUS: Record<ScoreGame["status"], string> = {
  scheduled: "",
  pregame: "Pregame",
  live: "",
  intermission: "Intermission",
  final: "Final",
  postponed: "Postponed",
  suspended: "Suspended",
  cancelled: "Cancelled",
};
const TYPE: Record<ScoreGame["gameType"], string> = { preseason: "Preseason", regular: "", playoffs: "Playoffs", other: "" };

/** Puck drop in the viewer's time zone (Preferences → Time zone). */
function startTime(iso: string, timeZone: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
}

function GameCard({ g, timeZone }: { g: ScoreGame; timeZone: string }) {
  const inPlay = g.status === "live" || g.status === "intermission";
  const showScore = inPlay || g.status === "final";
  const lead = (a: number | null, b: number | null) => showScore && a !== null && b !== null && a > b;
  const statusText =
    g.status === "live"
      ? `${g.period ?? ""} ${g.clock ?? ""}`.trim()
      : g.status === "intermission"
        ? `${g.period ?? ""} intermission`.trim()
        : g.status === "final"
          ? `Final${g.finishedIn ? `/${g.finishedIn}` : ""}`
          : g.status === "scheduled"
            ? startTime(g.startTimeUTC, timeZone)
            : STATUS[g.status];
  return (
    <section className={`rounded-lg border bg-surface ${inPlay ? "border-ice" : "border-line"}`}>
      <header className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs">
        <span className={inPlay ? "font-semibold text-ice" : "text-ink-muted"}>
          {inPlay && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ice align-middle" aria-hidden />}
          {statusText}
        </span>
        <span className="text-ink-muted">{[TYPE[g.gameType], g.venue].filter(Boolean).join(" · ")}</span>
      </header>
      <div className="px-3 py-2">
        {([g.away, g.home] as const).map((t, i) => {
          const other = i === 0 ? g.home : g.away;
          return (
            <div key={t.abbrev} className="flex items-center justify-between py-0.5">
              <span className={`text-sm ${lead(t.score, other.score) ? "font-semibold" : ""}`}>
                <span className="inline-flex items-center gap-2">
                  <TeamLogo team={t.abbrev} size={26} />
                  <span className="w-9 font-mono text-xs text-ink-muted">{t.abbrev}</span>
                  {t.name}
                </span>
              </span>
              <span className="flex items-baseline gap-3 tabular-nums">
                {showScore && t.shots !== null && <span className="text-xs text-ink-muted">{t.shots} SOG</span>}
                <span className={`w-6 text-right text-lg ${lead(t.score, other.score) ? "font-semibold" : ""}`}>{showScore ? (t.score ?? "–") : ""}</span>
              </span>
            </div>
          );
        })}
      </div>
      {g.goals.length > 0 && (
        <details className="border-t border-line px-3 py-1.5 text-xs" open={inPlay}>
          <summary className="cursor-pointer text-ink-muted">Scoring ({g.goals.length})</summary>
          <ol className="mt-1 space-y-0.5">
            {g.goals.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-16 shrink-0 tabular-nums text-ink-muted">
                  {x.period} {x.time}
                </span>
                <span className="w-9 shrink-0 font-mono text-ink-muted">{x.team}</span>
                <span className="text-ink">
                  {x.scorer}
                  {x.scorerTotal !== null && <span className="text-ink-muted"> ({x.scorerTotal})</span>}
                  {x.assists.length > 0 && <span className="text-ink-muted"> · {x.assists.join(", ")}</span>}
                  {(x.strength && x.strength !== "ev") || x.emptyNet ? (
                    <span className="ml-1 rounded bg-track px-1 text-[10px] uppercase text-ink-secondary">{[x.strength !== "ev" ? x.strength : "", x.emptyNet ? "en" : ""].filter(Boolean).join(" ")}</span>
                  ) : null}
                </span>
                {x.awayScore !== null && x.homeScore !== null && (
                  <span className="ml-auto tabular-nums text-ink-muted">
                    {x.awayScore}–{x.homeScore}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export default async function ScoresPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await resolveAppContext();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : "now";
  let board;
  let error: string | null = null;
  try {
    board = await getScoreboard(date);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const active = !!board?.games.some((g) => g.status === "live" || g.status === "intermission" || g.status === "pregame") && date === "now";
  const order: ScoreGame["status"][] = ["live", "intermission", "pregame", "scheduled", "final", "postponed", "suspended", "cancelled"];
  const games = board ? [...board.games].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.startTimeUTC.localeCompare(b.startTimeUTC)) : [];
  const nav = "rounded px-2 py-1 bg-subtle text-ink-secondary hover:text-ink";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Scores</h1>
          <p className="text-sm text-ink-muted">NHL scoreboard from the public NHL API. Puck drops in {zoneName(ctx.timeZone)}
            {ctx.user.preferences.timeZone === "auto" ? " (this device)" : ""}. Other leagues appear as their data sources are connected.
          </p>
        </div>
        <AutoRefresh active={active} seconds={30} />
      </div>
      {board && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {board.prevDate && (
            <Link href={`/scores?date=${board.prevDate}`} className={nav}>
              ← {board.prevDate}
            </Link>
          )}
          <span className="rounded bg-accent-soft px-2 py-1 font-medium text-accent-text">{board.date}</span>
          {board.nextDate && (
            <Link href={`/scores?date=${board.nextDate}`} className={nav}>
              {board.nextDate} →
            </Link>
          )}
          {date !== "now" && (
            <Link href="/scores" className={nav}>
              Today
            </Link>
          )}
        </div>
      )}
      {error ? (
        <EmptyState title="Scores unavailable" body={`The NHL API could not be reached: ${error}`} />
      ) : games.length === 0 ? (
        <EmptyState title="No NHL games on this date" body="Use the arrows to move to the previous or next game day." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {games.map((g) => (
            <GameCard key={g.id} g={g} timeZone={ctx.timeZone} />
          ))}
        </div>
      )}
    </div>
  );
}
