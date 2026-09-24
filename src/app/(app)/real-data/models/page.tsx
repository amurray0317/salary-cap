import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import {
  PROSPECT_MODEL_VERSION,
  XG_MODEL_VERSION,
  parseModelCsv,
  readModelCard,
  readModelFile,
} from "@/lib/connectors/rosteriqModels";
import { CONNECTOR_DEFINITIONS } from "@/lib/import/connectorDefinitions";

export const metadata: Metadata = { title: "Real data · model cards" };

const dash = "—";

interface Scores {
  shots?: number;
  players?: number;
  goals?: number;
  regulars?: number;
  xg?: number;
  expected?: number;
  xg_per_goal?: number;
  log_loss: number;
  auc: number | null;
  brier: number;
}
interface CalRow {
  shots: number;
  goal_rate: number;
  rosteriq: number;
  moneypuck: number | null;
  [k: string]: string | number | null;
}

// metrics.json is written by analytics/ (see analytics/README.md); these
// accessors keep the page tolerant of a missing section instead of crashing.
const get = <T,>(o: unknown, ...path: string[]): T | undefined =>
  path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o) as T | undefined;
const fx = (v: number | null | undefined, d: number) => (v === null || v === undefined ? dash : v.toFixed(d));
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? dash : `${(v * 100).toFixed(d)}%`);

function ScoresTable({ rows, unit, outcome = "Actual 200-GP players" }: { rows: Array<[string, Scores | undefined]>; unit: "shots" | "players"; outcome?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Model</Th>
            <Th right>{unit === "shots" ? "Shots" : "Players"}</Th>
            <Th right>{unit === "shots" ? "Goals" : outcome}</Th>
            <Th right>{unit === "shots" ? "Predicted goals" : "Predicted"}</Th>
            <Th right>Log loss ↓</Th>
            <Th right>AUC ↑</Th>
            <Th right>Brier ↓</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, s]) => (
            <tr key={label} className="border-b border-line/50 last:border-0">
              <Td>{label}</Td>
              <Td right>{s ? (s.shots ?? s.players ?? dash) : dash}</Td>
              <Td right>{s ? (s.goals ?? s.regulars ?? dash) : dash}</Td>
              <Td right>{s ? fx(s.xg ?? s.expected, 1) : dash}</Td>
              <Td right className="font-medium">{fx(s?.log_loss, 4)}</Td>
              <Td right>{fx(s?.auc, 3)}</Td>
              <Td right>{fx(s?.brier, 4)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationTable({ title, rows, keyName }: { title: string; rows: CalRow[] | undefined; keyName: string }) {
  if (!rows?.length) return null;
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <table className="w-full min-w-[22rem]">
        <thead>
          <tr className="border-b border-line">
            <Th>{keyName.replace(/_/g, " ")}</Th>
            <Th right>Shots</Th>
            <Th right>Actual</Th>
            <Th right>RosterIQ</Th>
            <Th right>MoneyPuck</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[keyName])} className="border-b border-line/50 last:border-0">
              <Td>{String(r[keyName])}</Td>
              <Td right>{r.shots}</Td>
              <Td right>{pc(r.goal_rate)}</Td>
              <Td right>{pc(r.rosteriq)}</Td>
              <Td right>{pc(r.moneypuck)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const seasonLabel = (id: string | number) => {
  const start = Math.floor(Number(id) / 10000);
  return `${start}-${String(start + 1).slice(2)}`;
};

function XgCard({ card }: { card: Record<string, unknown> }) {
  const matched = get<Record<string, Scores>>(card, "test", "matched_shots");
  const join = get<Record<string, number>>(card, "test", "join");
  const cal = get<Record<string, CalRow[]>>(card, "test", "calibration");
  const rec = get<Record<string, Record<string, unknown>>>(card, "reconciliation") ?? {};
  const sel = get<Record<string, unknown>>(card, "selection");
  const test = String(get<number>(card, "test_season") ?? "");
  const trees = Number(get<number>(sel, "gbm_trees") ?? 0);
  const halfLife = get<number | null>(sel, "half_life");
  const boot = get<Record<string, number[] | number | string>>(card, "test", "bootstrap_vs_moneypuck");
  const inSeason = get<Record<string, { through?: string; games?: number; drift?: { rows: Array<{ bin: string; shots: number; goals: number; xg: number; z: number }>; threshold_abs_z: number } }>>(card, "in_season") ?? {};
  return (
    <div className="space-y-5 text-sm">
      <p className="max-w-4xl text-ink-secondary">
        Probability that an unblocked shot attempt with a goalie in net becomes a goal, from NHL play-by-play:
        distance, angle, shot type, rebound, rush, the play before the shot, strength, score, off-wing, shooter
        position, period and venue. Logistic regression (C = {String(get(sel, "chosen_C") ?? dash)}) with{" "}
        {trees > 0 ? `${trees} boosted trees fitted on top of it` : "no boosted trees (they did not beat the logistic regression on validation)"}.
        {halfLife ? ` Training seasons are weighted toward the season being scored (half-life ${halfLife} season${halfLife === 1 ? "" : "s"}), because the NHL's event recording changes from year to year.` : ""}{" "}
        Selected on {seasonLabel(String(get<number>(sel, "valid") ?? ""))}; tested on {seasonLabel(test)}. Trained {String(card.trained_at ?? dash).slice(0, 10)}.
      </p>
      <p className="max-w-4xl text-xs text-ink-muted">
        Honesty note: {seasonLabel(test)} was looked at once with an earlier version (which showed the rush flag drifting and a
        5% over-prediction). The two changes that followed — a tighter rush definition and recency weighting — are justified
        on every season and the weighting was chosen on {seasonLabel(String(get<number>(sel, "valid") ?? ""))}, but {seasonLabel(test)} is
        no longer strictly untouched. The first clean test is the 2026-27 season, scored as it is played.
      </p>

      <div>
        <h3 className="mb-1 text-sm font-medium">Accuracy on {seasonLabel(test)} (same shots for every model)</h3>
        <ScoresTable
          unit="shots"
          rows={[
            ["League-average rate (no model)", matched?.constant_rate],
            ["RosterIQ — logistic regression only", matched?.rosteriq_lr_only],
            ["RosterIQ xG (logistic regression + trees)", matched?.rosteriq],
            ["MoneyPuck xGoal (Data: MoneyPuck.com)", matched?.moneypuck],
          ]}
        />
        {boot && Array.isArray(boot.log_loss_diff_ci95) && Array.isArray(boot.auc_diff_ci95) && (
          <p className="mt-1 text-xs text-ink-secondary">
            RosterIQ − MoneyPuck, paired bootstrap over {String(boot.games)} games (95% interval): log loss{" "}
            {fx((boot.log_loss_diff_ci95 as number[])[1], 4)} [{fx((boot.log_loss_diff_ci95 as number[])[0], 4)}, {fx((boot.log_loss_diff_ci95 as number[])[2], 4)}],
            AUC {fx((boot.auc_diff_ci95 as number[])[1], 4)} [{fx((boot.auc_diff_ci95 as number[])[0], 4)}, {fx((boot.auc_diff_ci95 as number[])[2], 4)}].
            {(boot.log_loss_diff_ci95 as number[])[2]! < 0 ? " RosterIQ's shot-level accuracy is better beyond noise on this season." : " The difference is within noise on this season."}
          </p>
        )}
        <p className="mt-1 text-xs text-ink-muted">
          Shots matched to MoneyPuck&rsquo;s shot file: {pc(join?.matched_share_of_ours, 2)} of ours,{" "}
          {pc(join?.matched_share_of_moneypuck_goalie_in_net ?? join?.matched_share_of_moneypuck, 2)} of theirs with a goalie in net; goal labels agree on {pc(join?.goal_label_agreement, 2)}. MoneyPuck&rsquo;s published values may have been fitted with this
          season included, which would flatter them; our test model was not trained on it.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CalibrationTable title="By distance (ft)" rows={cal?.distance} keyName="distance_ft" />
        <CalibrationTable title="By shot type" rows={cal?.shot_type} keyName="shot_type" />
        <CalibrationTable title="By strength (shooter v defenders)" rows={cal?.strength} keyName="strength" />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">Every season against MoneyPuck (each season scored by a model that never saw it)</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>Season</Th>
              <Th right>Goals</Th>
              <Th right>RosterIQ xG</Th>
              <Th right>MoneyPuck xG</Th>
              <Th right>Team xGF r</Th>
              <Th right>Player ixG r (≥5 ixG)</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(rec).map(([s, r]) => (
              <tr key={s} className="border-b border-line/50 last:border-0">
                <Td>{seasonLabel(s)}</Td>
                <Td right>{String(get(r, "season_xg", "goals") ?? dash)}</Td>
                <Td right>{fx(get<number>(r, "season_xg", "rosteriq"), 1)}</Td>
                <Td right>{fx(get<number>(r, "season_xg", "moneypuck"), 1)}</Td>
                <Td right>{fx(get<number>(r, "team_xgf_correlation"), 3)}</Td>
                <Td right>{fx(get<number>(r, "player_ixg_correlation_min5"), 3)} <span className="text-ink-muted">({String(get(r, "players_min5") ?? dash)})</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.entries(inSeason).map(([sid, v]) => (
        <div key={sid}>
          <h3 className="mb-1 text-sm font-medium">
            {seasonLabel(sid)} in progress — production model, data through {v.through ?? dash} ({v.games ?? 0} games)
          </h3>
          <table className="w-full max-w-2xl">
            <thead>
              <tr className="border-b border-line">
                <Th>Distance</Th>
                <Th right>Attempts</Th>
                <Th right>Goals</Th>
                <Th right>xG</Th>
                <Th right>z = (G − xG) / √xG</Th>
              </tr>
            </thead>
            <tbody>
              {(v.drift?.rows ?? []).map((r) => (
                <tr key={r.bin} className="border-b border-line/50 last:border-0">
                  <Td>{r.bin}</Td>
                  <Td right>{r.shots}</Td>
                  <Td right>{r.goals}</Td>
                  <Td right>{fx(r.xg, 1)}</Td>
                  <Td right className={Math.abs(r.z) > (v.drift?.threshold_abs_z ?? 4) ? "font-medium text-critical" : ""}>{fx(r.z, 2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-muted">Drift is flagged when |z| exceeds {v.drift?.threshold_abs_z ?? 4}; the nightly run then fails and GitHub emails the owner.</p>
        </div>
      ))}

      <div>
        <h3 className="mb-1 text-sm font-medium">What it cannot see</h3>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          <li>Passes before the shot (the NHL feed does not record them) — the biggest gap for any public xG model.</li>
          <li>Arena differences in how shot locations are recorded (not corrected), and season-to-season changes in what the NHL logs (weighted for, not removed).</li>
          <li>Blocked shots (not modelled, same as MoneyPuck). Empty-net attempts are counted, not modelled.</li>
          <li>Who is shooting: xG is shot quality, not finishing talent. It describes the chances a player got — it is not a forecast.</li>
        </ul>
      </div>
    </div>
  );
}

const BOOT_LABELS: Record<string, string> = {
  stats: "Stats only",
  stats_lr_only: "Stats only (regression only)",
  stats_pick: "Stats + draft position",
  stats_pick_lr_only: "Stats + draft position (regression only)",
};

function BootstrapTable({ boot }: { boot?: Record<string, { auc_diff_ci95: number[]; log_loss_diff_ci95: number[] }> }) {
  if (!boot) return null;
  const ci = (v: number[], d = 3) => `${v[1]! >= 0 ? "+" : ""}${v[1]!.toFixed(d)} [${v[0]!.toFixed(d)}, ${v[2]!.toFixed(d)}]`;
  const verdict = (auc: number[], ll: number[]) =>
    auc[0]! > 0 && ll[2]! < 0 ? "better" : auc[2]! < 0 && ll[0]! > 0 ? "worse" : "no detectable difference";
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">Compared with draft position alone (paired bootstrap, 95% intervals)</h3>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Model</Th>
            <Th>Players</Th>
            <Th right>AUC difference</Th>
            <Th right>Log-loss difference (− is better)</Th>
            <Th>Verdict</Th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(boot).map(([k, v]) => {
            const [subset, name] = k.split(":");
            return (
              <tr key={k} className="border-b border-line/50 last:border-0">
                <Td>{BOOT_LABELS[name!] ?? name}</Td>
                <Td>{subset === "all" ? "All test picks" : "After round 1"}</Td>
                <Td right>{ci(v.auc_diff_ci95)}</Td>
                <Td right>{ci(v.log_loss_diff_ci95, 4)}</Td>
                <Td>{verdict(v.auc_diff_ci95, v.log_loss_diff_ci95)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CssBenchmark({ css }: { css?: Record<string, unknown> }) {
  if (!css) return null;
  const t = get<Record<string, Scores>>(css, "test");
  const late = get<Record<string, Scores>>(css, "test_rounds_2_plus");
  const boot = get<Record<string, { auc_diff_ci95: number[]; log_loss_diff_ci95: number[] }>>(css, "bootstrap_vs_central_scouting") ?? {};
  const link = get<Record<string, number>>(css, "linking");
  const ci = (v?: number[], d = 3) => (v ? `${v[1]! >= 0 ? "+" : ""}${v[1]!.toFixed(d)} [${v[0]!.toFixed(d)}, ${v[2]!.toFixed(d)}]` : dash);
  const tests = get<number[]>(css, "test_drafts") ?? [];
  const range = tests.length ? `${tests[0]}–${tests[tests.length - 1]}` : dash;
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <h3 className="text-sm font-medium">Before the draft: against NHL Central Scouting&rsquo;s final rank ({range} drafts)</h3>
      <p className="text-xs text-ink-secondary">
        Draft position does not exist before the draft, so the fair pre-draft baseline is Central Scouting&rsquo;s final ranking
        (North American and International lists). Same players; every model trained on earlier drafts only; the stats model&rsquo;s
        input to the combined model is out-of-fold. {String(get(link, "linked_full_name") ?? 0)} + {String(get(link, "linked_last_name") ?? 0)} +{" "}
        {String(get(link, "linked_similar_name") ?? 0)} drafted skaters linked to their ranking by name and exact birth date
        (last line: transliterations such as Voynov / Voinov, each reviewed); {pc(get<number>(css, "test_share_with_final_rank"))} of test players had a final rank.
      </p>
      <ScoresTable
        unit="players"
        rows={[
          ["Central Scouting final rank only", t?.central_scouting_only],
          ["RosterIQ stats only", t?.stats_only],
          ["RosterIQ stats + Central Scouting rank", t?.stats_plus_central_scouting],
          ["(Draft position — not available before the draft)", t?.draft_position_only_reference],
        ]}
      />
      <ScoresTable
        unit="players"
        rows={[
          ["After round 1: Central Scouting only", late?.central_scouting_only],
          ["After round 1: RosterIQ stats only", late?.stats_only],
          ["After round 1: stats + Central Scouting", late?.stats_plus_central_scouting],
        ]}
      />
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Compared with Central Scouting only (paired bootstrap, 95%)</Th>
            <Th right>AUC difference</Th>
            <Th right>Log-loss difference (− is better)</Th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Stats + Central Scouting, all picks", boot["all:stats_plus_css"]],
            ["Stats + Central Scouting, after round 1", boot["rounds_2_plus:stats_plus_css"]],
            ["Stats only, all picks", boot["all:stats"]],
          ].map(([label, v]) => (
            <tr key={label as string} className="border-b border-line/50 last:border-0">
              <Td>{label as string}</Td>
              <Td right>{ci((v as { auc_diff_ci95: number[] } | undefined)?.auc_diff_ci95)}</Td>
              <Td right>{ci((v as { log_loss_diff_ci95: number[] } | undefined)?.log_loss_diff_ci95, 4)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted">
        Reading: before the draft, the stats add information on top of Central Scouting&rsquo;s rank (both intervals exclude
        zero), most after round 1; on their own they are about as good as Central Scouting. Caveats: outcomes exist only for
        drafted players, so ranked players who went undrafted are not in this test; one window of four drafts; every model
        predicts more 200-game players than occurred.
      </p>
    </div>
  );
}

/** "(5, 10]" → "Picks 6–10". */
const pickRange = (bin: string) => {
  const m = /^\((\d+), (\d+)\]$/.exec(bin);
  return m ? `Picks ${Number(m[1]) + 1}–${m[2]}` : bin;
};
type Boot = { auc_diff_ci95: number[]; log_loss_diff_ci95: number[] };
const ciText = (v?: number[], d = 3) => (v ? `${v[1]! >= 0 ? "+" : ""}${v[1]!.toFixed(d)} [${v[0]!.toFixed(d)}, ${v[2]!.toFixed(d)}]` : dash);

function V2Research({ v2 }: { v2?: Record<string, unknown> }) {
  if (!v2) return null;
  const tiers = get<Record<string, string | number>>(v2, "tiers") ?? {};
  const test = get<Record<string, Record<string, Record<string, Scores>>>>(v2, "test") ?? {};
  const boot = get<Record<string, Record<string, Record<string, Boot>>>>(v2, "bootstrap") ?? {};
  const pop = get<Record<string, unknown>>(v2, "population") ?? {};
  const summary = get<Record<string, number | string[]>>(pop, "summary") ?? {};
  const recall = get<Record<string, number>>(pop, "linker_recall_on_known_drafted") ?? {};
  const bias = get<Record<string, Record<string, unknown>>>(pop, "drafted_only_bias") ?? {};
  const rates = get<Array<Record<string, number | string>>>(v2, "base_rates_by_pick") ?? [];
  const drafts = get<number[]>(v2, "test_drafts") ?? [];
  const range = drafts.length ? `${drafts[0]}–${drafts[drafts.length - 1]}` : dash;
  const bootRows: Array<[string, Boot | undefined, Boot | undefined]> = [
    ["January (midterm list): stats + midterm vs midterm only", boot.nhl_regular?.vs_css_midterm?.["all:stats_plus_css_midterm"], boot.top_lineup?.vs_css_midterm?.["all:stats_plus_css_midterm"]],
    ["  … after round 1", boot.nhl_regular?.vs_css_midterm?.["rounds_2_plus:stats_plus_css_midterm"], boot.top_lineup?.vs_css_midterm?.["rounds_2_plus:stats_plus_css_midterm"]],
    ["April (final list): stats + final vs final only", boot.nhl_regular?.vs_css_final?.["all:stats_plus_css_final"], boot.top_lineup?.vs_css_final?.["all:stats_plus_css_final"]],
    ["  … after round 1", boot.nhl_regular?.vs_css_final?.["rounds_2_plus:stats_plus_css_final"], boot.top_lineup?.vs_css_final?.["rounds_2_plus:stats_plus_css_final"]],
    ["Stats only vs draft position (actual draft order)", boot.nhl_regular?.vs_draft_position?.["all:stats_only"], boot.top_lineup?.vs_draft_position?.["all:stats_only"]],
  ];
  const biasRow = (key: string, model: string, sub: string) => get<Scores>(bias, key, model, sub);
  return (
    <div className="space-y-3 rounded-md border border-ice/40 bg-accent-soft/40 p-3">
      <h3 className="text-sm font-medium">
        Prospect model v2 — research results <span className="ml-1 rounded bg-track px-1.5 text-[10px] uppercase tracking-wide text-ink-secondary">not yet in the projections</span>
      </h3>
      <div className="grid gap-3 text-xs text-ink-secondary lg:grid-cols-2">
        <p>
          <span className="font-medium text-ink">Two tiers.</span> NHL regular: {String(tiers.regular ?? dash)}. Top of lineup: {String(tiers.top_lineup ?? dash)}.
          P(top) = P(regular) × P(top | regular), so it can never exceed P(regular).
        </p>
        <p>
          <span className="font-medium text-ink">Why the second tier.</span> The 200-game bar stops separating the top of the draft (see the table): almost every
          top-5 pick becomes a regular, fewer become top-of-lineup players.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>Draft slot (2005–2019 drafts)</Th>
              <Th right>Skaters</Th>
              <Th right>Became regulars</Th>
              <Th right>Became top of lineup</Th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={String(r.pick_bin)} className="border-b border-line/50 last:border-0">
                <Td>{pickRange(String(r.pick_bin))}</Td>
                <Td right>{String(r.players)}</Td>
                <Td right>{pc(r.regular as number, 0)}</Td>
                <Td right>{pc(r.top_lineup as number, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">NHL regular · {range} drafts</h4>
          <ScoresTable
            unit="players"
            outcome="Actual regulars"
            rows={[
              ["Central Scouting midterm only", test.nhl_regular?.all?.css_midterm_only],
              ["Stats + midterm (January)", test.nhl_regular?.all?.stats_plus_css_midterm],
              ["Central Scouting final only", test.nhl_regular?.all?.css_final_only],
              ["Stats + final (April)", test.nhl_regular?.all?.stats_plus_css_final],
              ["Stats only", test.nhl_regular?.all?.stats_only],
              ["(Draft position — after the draft)", test.nhl_regular?.all?.draft_position_only],
            ]}
          />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Top of lineup · {range} drafts</h4>
          <ScoresTable
            unit="players"
            outcome="Actual top-of-lineup"
            rows={[
              ["Central Scouting midterm only", test.top_lineup?.all?.css_midterm_only],
              ["Stats + midterm (January)", test.top_lineup?.all?.stats_plus_css_midterm],
              ["Central Scouting final only", test.top_lineup?.all?.css_final_only],
              ["Stats + final (April)", test.top_lineup?.all?.stats_plus_css_final],
              ["Stats only", test.top_lineup?.all?.stats_only],
              ["(Draft position — after the draft)", test.top_lineup?.all?.draft_position_only],
            ]}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>Paired bootstrap, 95% (same players)</Th>
              <Th right>Regular: AUC diff</Th>
              <Th right>Regular: log-loss diff</Th>
              <Th right>Top: AUC diff</Th>
              <Th right>Top: log-loss diff</Th>
            </tr>
          </thead>
          <tbody>
            {bootRows.map(([label, a, b]) => (
              <tr key={label} className="border-b border-line/50 last:border-0">
                <Td className="whitespace-pre">{label}</Td>
                <Td right>{ciText(a?.auc_diff_ci95)}</Td>
                <Td right>{ciText(a?.log_loss_diff_ci95, 4)}</Td>
                <Td right>{ciText(b?.auc_diff_ci95)}</Td>
                <Td right>{ciText(b?.log_loss_diff_ci95, 4)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">Everyone Central Scouting ranked, not only drafted players</h4>
        <p className="text-xs text-ink-secondary">
          {String(summary.ranked_players ?? dash)} ranked skaters ({String(get<number[]>(pop, "years")?.join("–") ?? dash)}), linked to NHL ids by name + exact birth date
          ({pc(recall.recall, 1)} of ranked players known to be drafted were found; the rest, nickname spellings, are filled from the draft records).{" "}
          {String(summary.never_drafted ?? dash)} were never drafted; {String(summary.regulars_never_drafted ?? dash)} of them became NHL regulars (
          {(summary.never_drafted_regular_examples as string[] | undefined)?.join(", ") ?? dash}). A model that has only seen drafted players therefore
          overstates the chances of the many ranked players who will not be picked. Same Central Scouting inputs (list, rank, age, size, position), two
          training sets, scored on every ranked player in the test years:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Outcome · list</Th>
                <Th>Trained on</Th>
                <Th right>Predicted / actual (all ranked)</Th>
                <Th right>Log loss ↓</Th>
                <Th right>Predicted / actual (not drafted that year)</Th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(bias).flatMap((key) =>
                (["trained_on_drafted_only", "trained_on_all_ranked"] as const).map((m) => {
                  const a = biasRow(key, m, "all_ranked");
                  const u = biasRow(key, m, "not_drafted_that_year");
                  const [lab, col] = key.split(":");
                  return (
                    <tr key={`${key}-${m}`} className="border-b border-line/50 last:border-0">
                      <Td>{m === "trained_on_drafted_only" ? `${lab === "nhl_regular" ? "Regular" : "Top of lineup"} · ${col === "css_final" ? "final" : "midterm"}` : ""}</Td>
                      <Td>{m === "trained_on_drafted_only" ? "Drafted players only" : "Everyone ranked"}</Td>
                      <Td right>
                        {fx(a?.expected, 1)} / {a?.regulars ?? dash}
                      </Td>
                      <Td right className="font-medium">{fx(a?.log_loss, 4)}</Td>
                      <Td right>
                        {fx(u?.expected, 1)} / {u?.regulars ?? dash}
                      </Td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Reading: before the draft, stats + Central Scouting beats Central Scouting alone for NHL regulars, and the gain is largest in January, when only the
        midterm list exists. For top-of-lineup players the gains point the same way but the intervals reach zero ({String(get<number>(v2, "test_top_lineup") ?? dash)} such
        players in the test drafts). Scoring the whole ranked population needs a model trained on the whole ranked population. Caveats: draft-year stats
        exist only for drafted players (the NHL feed has no pages for others), so the population test uses Central Scouting inputs only; one window of four
        drafts; the 2016–2019 drafts produced fewer regulars than every model expected, even after scaling for shortened seasons.
      </p>
    </div>
  );
}

function ProspectCardView({ card }: { card: Record<string, unknown> }) {
  const res = get<Record<string, Record<string, Scores>>>(card, "results");
  const drafts = get<Record<string, number[]>>(card, "drafts");
  const links = get<Record<string, Record<string, number>>>(card, "links") ?? {};
  const linked = Object.values(links).reduce((a, v) => a + (v.linked ?? 0), 0);
  const unresolved = Object.values(links).reduce((a, v) => a + (v.unresolved ?? 0), 0);
  const nh = get<Record<string, unknown>>(card, "nhle");
  const range = (ys?: number[]) => (ys?.length ? `${ys[0]}–${ys[ys.length - 1]}` : dash);
  let factors: Array<Record<string, string>> = [];
  try {
    factors = parseModelCsv(readModelFile("nhle").text, CONNECTOR_DEFINITIONS.rosteriq_nhle.fields.map((f) => f.key));
  } catch {
    factors = [];
  }
  const topLeagues = [...factors].sort((a, b) => Number(b.pairs) - Number(a.pairs)).slice(0, 25);
  return (
    <div className="space-y-5 text-sm">
      <p className="max-w-4xl text-ink-secondary">
        {String(card.outcome ?? "")}. Features are what was known at the draft: draft-year and prior-season production
        translated with RosterIQ NHLe, goals share, age, size, position, league group and games played — not draft position.
        Trained on drafts {range(drafts?.train)}, selected on {range(drafts?.valid)}, tested on {range(drafts?.test)} (never used for
        fitting or selection). {linked} draft picks linked to NHL player ids ({unresolved} unresolved, never guessed).
      </p>
      <div>
        <h3 className="mb-1 text-sm font-medium">Accuracy on the {range(drafts?.test)} drafts</h3>
        <ScoresTable
          unit="players"
          rows={[
            ["Base rate (no model)", res?.baselines?.constant_rate],
            ["Draft position only", res?.baselines?.draft_position_only],
            ["RosterIQ prospects (stats, no draft position)", res?.stats?.test],
            ["RosterIQ + draft position", res?.stats_pick?.test],
          ]}
        />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium">Picks after round 1 only (where teams most often miss)</h3>
        <ScoresTable
          unit="players"
          rows={[
            ["Draft position only", res?.baselines?.draft_position_only_rounds_2_plus],
            ["RosterIQ prospects (stats, no draft position)", res?.stats?.test_rounds_2_plus],
            ["RosterIQ + draft position", res?.stats_pick?.test_rounds_2_plus],
          ]}
        />
        <p className="mt-1 text-xs text-ink-muted">
          If &ldquo;RosterIQ + draft position&rdquo; beats &ldquo;draft position only&rdquo;, the stats carry information teams&rsquo; picks did not fully price in.
        </p>
      </div>
      <BootstrapTable boot={get<Record<string, { auc_diff_ci95: number[]; log_loss_diff_ci95: number[] }>>(card, "results", "bootstrap_vs_draft_position")} />
      <CssBenchmark css={get<Record<string, unknown>>(card, "benchmark_css")} />
      <V2Research v2={get<Record<string, unknown>>(card, "v2_research")} />
      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-medium">League equivalency (NHLe), most-connected leagues</h3>
          {topLeagues.length === 0 ? (
            <p className="text-ink-muted">No league factor file.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>League</Th>
                  <Th right>NHL points per point</Th>
                  <Th right>±1 SE</Th>
                  <Th right>Pairs</Th>
                </tr>
              </thead>
              <tbody>
                {topLeagues.map((f) => {
                  const m = Number(f.multiplier);
                  const se = Number(f.standard_error);
                  return (
                    <tr key={f.league} className="border-b border-line/50 last:border-0">
                      <Td>{f.league}</Td>
                      <Td right>{m.toFixed(3)}</Td>
                      <Td right className="text-ink-muted">{`${(m * Math.exp(-se)).toFixed(3)}–${(m * Math.exp(se)).toFixed(3)}`}</Td>
                      <Td right>{f.pairs}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-1 text-xs text-ink-muted">
            {String(get(nh, "leagues_estimated") ?? dash)} leagues have a factor; {(get<string[]>(nh, "leagues_without_factor") ?? []).length} have too little connected data and get none.
          </p>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">What it cannot see</h3>
          <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
            <li>Anything scouts see that is not in the numbers: skating, hockey sense, injuries, character, deployment.</li>
            <li>Opportunity: NHL games also depend on team depth, injuries and the shortened 2019-20 and 2020-21 seasons.</li>
            <li>NHLe is estimated from players who changed leagues; players promoted after unusually good seasons make lower leagues look a little harder than they are.</li>
            <li>Goalies are not modelled. Recent drafts have no outcome yet — their projections are forecasts, not results.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default async function ModelCardsPage() {
  await resolveAppContext();
  const xg = readModelCard(XG_MODEL_VERSION);
  const pr = readModelCard(PROSPECT_MODEL_VERSION);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Model cards</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          How the RosterIQ models were built and how accurate they are on data they never saw, benchmarked against a
          public standard. Built offline from public NHL data (analytics/, see its README); only season totals and
          per-player projections are imported into the app.
        </p>
      </div>
      <Card title={`Expected goals — ${XG_MODEL_VERSION}`}>
        {xg ? <XgCard card={xg} /> : <EmptyState title="No xG model card" body={`models/${XG_MODEL_VERSION}/metrics.json is not present.`} />}
      </Card>
      <Card title={`Prospects — ${PROSPECT_MODEL_VERSION}`}>
        {pr ? <ProspectCardView card={pr} /> : <EmptyState title="No prospect model card" body={`models/${PROSPECT_MODEL_VERSION}/metrics.json is not present.`} />}
      </Card>
    </div>
  );
}
