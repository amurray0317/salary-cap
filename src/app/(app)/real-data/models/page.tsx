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

function ScoresTable({ rows, unit }: { rows: Array<[string, Scores | undefined]>; unit: "shots" | "players" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Model</Th>
            <Th right>{unit === "shots" ? "Shots" : "Players"}</Th>
            <Th right>{unit === "shots" ? "Goals" : "Actual 200-GP players"}</Th>
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
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <table className="w-full">
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
  return (
    <div className="space-y-5 text-sm">
      <p className="max-w-4xl text-ink-secondary">
        Probability that an unblocked shot attempt with a goalie in net becomes a goal, from NHL play-by-play:
        distance, angle, shot type, rebound, rush, the play before the shot, strength, score, off-wing, shooter
        position, period and venue. Logistic regression (C = {String(get(sel, "chosen_C") ?? dash)}) with{" "}
        {trees > 0 ? `${trees} boosted trees fitted on top of it` : "no boosted trees (they did not beat the logistic regression on validation)"}.
        Selected on {seasonLabel(String(get<number>(sel, "valid") ?? ""))}; tested on {seasonLabel(test)}, which no fitting or
        selection step saw. Trained {String(card.trained_at ?? dash).slice(0, 10)}.
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
        <p className="mt-1 text-xs text-ink-muted">
          Shots matched to MoneyPuck&rsquo;s shot file: {pc(join?.matched_share_of_ours, 2)} of ours, {pc(join?.matched_share_of_moneypuck, 2)} of
          theirs; goal labels agree on {pc(join?.goal_label_agreement, 2)}. MoneyPuck&rsquo;s published values may have been fitted with this
          season included, which would flatter them; ours never saw it.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
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

      <div>
        <h3 className="mb-1 text-sm font-medium">What it cannot see</h3>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          <li>Passes before the shot (the NHL feed does not record them) — the biggest gap for any public xG model.</li>
          <li>Arena differences in how shot locations are recorded (not corrected).</li>
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
