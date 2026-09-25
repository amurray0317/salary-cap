import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { readModelCard } from "@/lib/connectors/rosteriqModels";
import { Card, EmptyState } from "@/components/ui";
import { TeamLogo } from "@/components/NhlImages";
import { MODELS_DIR } from "@/lib/connectors/rosteriqModels";
import { parseCsv } from "@/lib/import/csvParse";
import { nhlSeasonId, seasonStartYear } from "@/lib/season";
import fs from "fs";
import path from "path";

export const metadata: Metadata = { title: "Win drivers" };

interface Scores {
  games: number;
  log_loss: number;
  brier: number;
  accuracy: number;
}
interface Card_ {
  seasons: number[];
  games: number;
  home_win_rate_by_season: Record<string, number>;
  descriptive: Array<{ metric: string; games: number; leader_win_pct: number }>;
  predictive: {
    test_seasons: number[];
    elo_settings: { k: number; home_advantage_elo: number };
    pooled: Record<string, Scores>;
    per_season: Record<string, Record<string, Scores>>;
    vs_home_only_log_loss_diff_ci95: Record<string, number[]>;
    compact_vs_elo_log_loss_diff_ci95: number[];
    single_feature: Array<{ feature: string; log_loss: number; vs_home_only_ci95: number[] }>;
    calibration_compact: Array<{ p_from: number; p_to: number; games: number; predicted: number; actual: number }>;
  };
  running?: Record<string, { predicted?: number; games: number; p_home?: Scores; p_elo?: Scores; p_home_only?: Scores }>;
}

const MODEL_LABEL: Record<string, string> = {
  home_only: "Home ice only",
  points_pct: "Points percentage",
  elo: "Elo rating",
  compact: "RosterIQ compact",
  full: "RosterIQ, every feature",
};
const FEATURE_LABEL: Record<string, string> = {
  xgf_pct_5v5: "5v5 expected-goals share",
  xgf_pct: "Expected-goals share (all situations)",
  xgf_pg: "Expected goals for per game",
  xga_pg: "Expected goals against per game",
  gf_pct: "Goal share",
  pts_pct: "Points percentage",
  st_net_pg: "Special-teams goal differential per game",
  pen_diff_pg: "Penalty differential per game",
  goalie_sax_rate: "Starting goalie: saves above expected rate",
  fo_pct: "Faceoff percentage",
  sh_pct: "Shooting percentage",
  sv_pct: "Save percentage",
  rest: "Days of rest",
  b2b: "Second night of a back-to-back",
};
const seasonLabel = (id: number | string) => {
  const y = Math.floor(Number(id) / 10000);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const signed = (v: number) => (v > 0 ? `+${v.toFixed(3)}` : v.toFixed(3).replace("-", "−"));
const ci = (c: number[]) => `${signed(c[1]!)} [${signed(c[0]!)}, ${signed(c[2]!)}]`;
/** An interval that excludes 0 on the good side (lower log loss) is a real improvement. */
const better = (c: number[]) => c[2]! < 0;

export default async function WinDriversPage() {
  await resolveAppContext();
  const card = readModelCard("rosteriq-games-v0") as unknown as Card_ | null;
  if (!card) {
    return (
      <EmptyState
        title="Win drivers not built yet"
        body="Run the games pipeline (analytics/README.md, step 9) to build the game tables and the evaluation."
      />
    );
  }
  const p = card.predictive;
  const runningSeason = nhlSeasonId(seasonStartYear());
  const models = ["home_only", "points_pct", "elo", "compact", "full"].filter((m) => p.pooled[m]);
  const span = `${seasonLabel(card.seasons[0]!)} to ${seasonLabel(card.seasons[card.seasons.length - 1]!)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1>Win drivers &amp; model check</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {card.games.toLocaleString()} NHL regular-season games, {span}, from NHL play-by-play and RosterIQ expected goals. Two different questions,
          kept apart: what goes with winning inside a game, and what predicts a win before puck drop.
        </p>
      </div>

      <Card title="1. Inside the game: how often the team that won a stat won the game">
        <p className="mb-4 max-w-3xl text-sm text-ink-muted">
          Descriptive, not predictive: these are known only after the game, so they explain results and cannot be used to pick one. Games where the
          stat was tied are left out. The line marks 50%, a coin flip.
        </p>
        <div className="space-y-1.5">
          {card.descriptive.map((d) => {
            const off = (d.leader_win_pct - 0.5) * 100; // points above/below a coin flip
            const w = Math.min(Math.abs(off) * 2, 50); // 25 points = half the track
            return (
              <div
                key={d.metric}
                className="grid grid-cols-[minmax(0,8.5rem)_1fr_3.5rem] items-center gap-2 text-sm sm:grid-cols-[minmax(0,15rem)_1fr_4.5rem] sm:gap-3"
                title={`${d.metric}: ${pct(d.leader_win_pct)} of ${d.games.toLocaleString()} games`}
              >
                <span className="truncate text-ink-secondary">{d.metric}</span>
                <span className="relative h-5">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-strong" aria-hidden />
                  <span
                    className="absolute inset-y-0.5 rounded-sm bg-ice"
                    style={off >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                    aria-hidden
                  />
                </span>
                <span className="text-right font-semibold tabular-nums">{pct(d.leader_win_pct)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Hits and blocked shots point the other way because trailing teams chase the game and leading teams defend: they follow the score rather than
          drive it.
        </p>
      </Card>

      <Card title="2. Before puck drop: which information predicts the winner">
        <p className="mb-3 max-w-3xl text-sm text-ink-muted">
          Walk-forward test: each season from {seasonLabel(p.test_seasons[0]!)} on is predicted by a model trained only on earlier seasons, using only
          what was known before each game (season-to-date rates, the starting goalie, rest, home ice). Lower log loss is better; 0.693 is a coin flip.
          Home teams won{" "}
          {Object.entries(card.home_win_rate_by_season)
            .map(([s, v]) => `${pct(v)} in ${seasonLabel(s)}`)
            .join(", ")}
          .
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-secondary">
                <th className="py-2 font-semibold">Model</th>
                <th className="py-2 text-right font-semibold">Log loss</th>
                <th className="py-2 text-right font-semibold">Brier</th>
                <th className="py-2 text-right font-semibold">Picked winner</th>
                <th className="py-2 text-right font-semibold">vs home ice only (log loss, 95%)</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const c = p.vs_home_only_log_loss_diff_ci95[m];
                return (
                  <tr key={m} className="border-t border-line/60">
                    <td className="py-2 font-medium">{MODEL_LABEL[m] ?? m}</td>
                    <td className="py-2 text-right tabular-nums">{p.pooled[m]!.log_loss.toFixed(4)}</td>
                    <td className="py-2 text-right tabular-nums">{p.pooled[m]!.brier.toFixed(4)}</td>
                    <td className="py-2 text-right tabular-nums">{pct(p.pooled[m]!.accuracy)}</td>
                    <td className={`py-2 text-right tabular-nums ${c && better(c) ? "font-semibold text-good" : "text-ink-secondary"}`}>
                      {c ? ci(c) : "baseline"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {p.pooled.home_only!.games.toLocaleString()} test games. Green = the whole 95% interval is below zero (a real improvement). Compact model vs
          Elo: {ci(p.compact_vs_elo_log_loss_diff_ci95)}. Elo: K {p.elo_settings.k}, home edge {p.elo_settings.home_advantage_elo} points, tuned on
          the first season only.
        </p>

        <h3 className="mt-6 text-sm font-bold">One piece of information at a time (plus home ice)</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-secondary">
                <th className="py-2 font-semibold">Pre-game information</th>
                <th className="py-2 text-right font-semibold">Log loss</th>
                <th className="py-2 text-right font-semibold">vs home ice only (95%)</th>
              </tr>
            </thead>
            <tbody>
              {p.single_feature.map((f) => (
                <tr key={f.feature} className="border-t border-line/60">
                  <td className="py-1.5">{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.log_loss.toFixed(4)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${better(f.vs_home_only_ci95) ? "font-semibold text-good" : "text-ink-secondary"}`}>
                    {ci(f.vs_home_only_ci95)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-sm font-bold">Are the compact model&apos;s probabilities honest? (calibration)</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-secondary">
                <th className="py-2 font-semibold">Predicted home win</th>
                <th className="py-2 text-right font-semibold">Games</th>
                <th className="py-2 text-right font-semibold">Predicted</th>
                <th className="py-2 text-right font-semibold">Actual</th>
              </tr>
            </thead>
            <tbody>
              {p.calibration_compact.map((b) => (
                <tr key={b.p_from} className="border-t border-line/60">
                  <td className="py-1.5 tabular-nums">
                    {pct(b.p_from, 0)} – {pct(b.p_to, 0)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{b.games}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(b.predicted)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(b.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RunningTab season={runningSeason} running={card.running?.[runningSeason]} />

      <Card title="What this can and cannot do">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-secondary">
          <li>
            Single NHL games are close to coin flips: published research puts the ceiling for picking winners near 62% (Weissbock &amp; Inkpen), and
            this model is evaluated on probability quality (log loss), not on picking.
          </li>
          <li>
            Betting markets price this same public information, usually well. Beating them consistently is not something any model here claims; the
            fair test is closing-line value against real prices, which needs an odds feed this project does not have.
          </li>
          <li>
            Team expected goals come from the RosterIQ xG model, which was fitted on these seasons&apos; shots (it never sees results). The backtest
            uses the actual starting goalie; the live probabilities are made at 10:00 UTC with the expected starter, which moved probabilities by
            0.009 on average when checked.
          </li>
          <li>
            The compact model is slightly overconfident at the extremes (see the calibration table); treat 70%+ and 30%− as a little less certain.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/** The season's frozen pre-game probabilities (written by the nightly job), latest game day first. */
function RunningTab({
  season,
  running,
}: {
  season: string;
  running?: { predicted?: number; games: number; p_home?: Scores; p_elo?: Scores; p_home_only?: Scores };
}) {
  let rows: Array<Record<string, string>> = [];
  try {
    const { headers, rows: raw } = parseCsv(fs.readFileSync(path.join(MODELS_DIR, "rosteriq-games-v0", `predictions_${season}.csv`), "utf8"), {
      maxRows: 5000,
    });
    rows = raw.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  } catch {
    rows = [];
  }
  const label = seasonLabel(season);
  const latest = rows.reduce((d, r) => (r.date! > d ? r.date! : d), "");
  const day = rows.filter((r) => r.date === latest);
  return (
    <Card title={`3. The ${label} running tab`}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Starts on opening night (October 6, 2026). Every morning at 10:00 UTC, before any puck drop, the nightly job writes each game&apos;s
          home-win probability here and never changes it; after the final it is scored against home ice and Elo.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            {rows.length} games predicted before puck drop{running?.games ? `, ${running.games} scored` : ""}.
            {running?.p_home && running.p_elo && running.p_home_only
              ? ` Log loss so far: RosterIQ ${running.p_home.log_loss.toFixed(4)}, Elo ${running.p_elo.log_loss.toFixed(4)}, home ice ${running.p_home_only.log_loss.toFixed(4)}.`
              : ""}
          </p>
          <h3 className="text-sm font-bold">{latest}</h3>
          <ul className="mt-2 divide-y divide-line/60 text-sm">
            {day.map((r) => {
              const ph = Number(r.p_home);
              return (
                <li key={r.game_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2">
                    <TeamLogo team={r.away!} size={22} /> {r.away} <span className="text-ink-muted">at</span> <TeamLogo team={r.home!} size={22} />{" "}
                    {r.home}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{pct(ph)}</span> <span className="text-ink-muted">home · Elo {pct(Number(r.p_elo))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
