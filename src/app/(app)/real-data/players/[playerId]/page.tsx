import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { getReferencePlayer } from "@/server/services/referenceDataService";
import { Card, Td, Th } from "@/components/ui";
import type { schema } from "@/db/client";
import { PROSPECT_GROUP_LABELS, XG_GROUP_LABELS, signed, topReasons } from "@/lib/models/labels";

export const metadata: Metadata = { title: "Real data · player" };

type Season = typeof schema.extPlayerSeasons.$inferSelect;
type GameLog = typeof schema.extPlayerGameLogs.$inferSelect;
type Prospect = typeof schema.extProspectProjections.$inferSelect;

const dash = "—";
const n = (v: number | null | undefined) => (v === null || v === undefined ? dash : String(v));
const f = (v: number | null | undefined, digits: number) => (v === null || v === undefined ? dash : v.toFixed(digits));
const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? dash : `${(v * 100).toFixed(digits)}%`);
const svPct = (v: number | null | undefined) => (v === null || v === undefined ? dash : v.toFixed(3).replace(/^0/, ""));
const clock = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined) return dash;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Per-60 rate, only when the source reported time on ice. */
const per60 = (value: number | null | undefined, toiSeconds: number | null | undefined) =>
  value === null || value === undefined || !toiSeconds ? dash : ((value * 3600) / toiSeconds).toFixed(2);

function CareerTable({ rows, goalie }: { rows: Season[]; goalie: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Season</Th>
            <Th>Type</Th>
            <Th>League</Th>
            <Th>Team</Th>
            <Th right>GP</Th>
            {goalie ? (
              <>
                <Th right>W</Th>
                <Th right>L</Th>
                <Th right>OTL</Th>
                <Th right>SA</Th>
                <Th right>GA</Th>
                <Th right>SV%</Th>
                <Th right>GAA</Th>
                <Th right>SO</Th>
                <Th right>TOI</Th>
              </>
            ) : (
              <>
                <Th right>G</Th>
                <Th right>A</Th>
                <Th right>P</Th>
                <Th right>+/-</Th>
                <Th right>PIM</Th>
                <Th right>PPP</Th>
                <Th right>SOG</Th>
                <Th right>TOI/GP</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-line/50 last:border-0 ${r.league === "NHL" ? "" : "text-ink-secondary"}`}>
              <Td className="whitespace-nowrap">{r.season}</Td>
              <Td>{r.gameType === "regular" ? "Reg" : "PO"}</Td>
              <Td>{r.league ?? dash}</Td>
              <Td className="max-w-48 truncate">{r.teamName ?? dash}</Td>
              <Td right>{n(r.gamesPlayed)}</Td>
              {goalie ? (
                <>
                  <Td right>{n(r.wins)}</Td>
                  <Td right>{n(r.losses)}</Td>
                  <Td right>{n(r.otLosses)}</Td>
                  <Td right>{n(r.shotsAgainst)}</Td>
                  <Td right>{n(r.goalsAgainst)}</Td>
                  <Td right>{svPct(r.savePct)}</Td>
                  <Td right>{f(r.goalsAgainstAverage, 2)}</Td>
                  <Td right>{n(r.shutouts)}</Td>
                  <Td right>{r.toiSeconds === null ? dash : clock(r.toiSeconds)}</Td>
                </>
              ) : (
                <>
                  <Td right>{n(r.goals)}</Td>
                  <Td right>{n(r.assists)}</Td>
                  <Td right>{n(r.points)}</Td>
                  <Td right>{n(r.plusMinus)}</Td>
                  <Td right>{n(r.penaltyMinutes)}</Td>
                  <Td right>{n(r.powerPlayPoints)}</Td>
                  <Td right>{n(r.shots)}</Td>
                  <Td right>{clock(r.toiPerGameSeconds)}</Td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoneyPuckTable({ rows, goalie }: { rows: Season[]; goalie: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Season</Th>
            <Th>Type</Th>
            <Th>Team</Th>
            <Th>Situation</Th>
            <Th right>GP</Th>
            <Th right>TOI (min)</Th>
            {goalie ? (
              <>
                <Th right>SA</Th>
                <Th right>GA</Th>
                <Th right>xGA</Th>
                <Th right>GSAx*</Th>
                <Th right>GSAx/60*</Th>
              </>
            ) : (
              <>
                <Th right>G</Th>
                <Th right>P</Th>
                <Th right>ixG</Th>
                <Th right>G − ixG*</Th>
                <Th right>ixG/60*</Th>
                <Th right>P/60*</Th>
                <Th right>On-ice xG%</Th>
                <Th right>On-ice CF%</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gsax = r.xGoals !== null && r.goalsAgainst !== null ? r.xGoals - r.goalsAgainst : null;
            const finishing = r.goals !== null && r.xGoals !== null ? r.goals - r.xGoals : null;
            return (
              <tr key={r.id} className="border-b border-line/50 last:border-0">
                <Td className="whitespace-nowrap">{r.season}</Td>
                <Td>{r.gameType === "regular" ? "Reg" : "PO"}</Td>
                <Td>{r.teamName ?? dash}</Td>
                <Td>{r.situation}</Td>
                <Td right>{n(r.gamesPlayed)}</Td>
                <Td right>{r.toiSeconds === null ? dash : (r.toiSeconds / 60).toFixed(1)}</Td>
                {goalie ? (
                  <>
                    <Td right>{n(r.shotsAgainst)}</Td>
                    <Td right>{n(r.goalsAgainst)}</Td>
                    <Td right>{f(r.xGoals, 2)}</Td>
                    <Td right>{f(gsax, 2)}</Td>
                    <Td right>{per60(gsax, r.toiSeconds)}</Td>
                  </>
                ) : (
                  <>
                    <Td right>{n(r.goals)}</Td>
                    <Td right>{n(r.points)}</Td>
                    <Td right>{f(r.xGoals, 2)}</Td>
                    <Td right>{f(finishing, 2)}</Td>
                    <Td right>{per60(r.xGoals, r.toiSeconds)}</Td>
                    <Td right>{per60(r.points, r.toiSeconds)}</Td>
                    <Td right>{pct(r.onIceXGoalsPct, 0)}</Td>
                    <Td right>{pct(r.onIceCorsiPct, 0)}</Td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">
        * Derived in RosterIQ from MoneyPuck&rsquo;s reported values (GSAx = xGA − GA; per-60 = value × 3600 ÷ reported
        ice time in seconds). MoneyPuck reports percentages rounded to two decimals. Data: MoneyPuck.com.
      </p>
    </div>
  );
}

/** RosterIQ xG season totals with the biggest reasons ixG differs from a league-average attempt. */
function RosterIqXgTable({ rows, goalie }: { rows: Season[]; goalie: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>Season</Th>
            <Th>Type</Th>
            <Th>Situation</Th>
            <Th>Team</Th>
            {goalie ? (
              <>
                <Th right>Attempts faced</Th>
                <Th right>GA</Th>
                <Th right>xGA</Th>
                <Th right>GSAx</Th>
              </>
            ) : (
              <>
                <Th right>Attempts</Th>
                <Th right>G</Th>
                <Th right>ixG</Th>
                <Th right>G − ixG</Th>
                <Th right>Baseline</Th>
                <Th>Biggest reasons (goals)</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = r.metrics as Record<string, number>;
            const reasons = topReasons(
              Object.fromEntries(Object.keys(XG_GROUP_LABELS).map((g) => [g, m[`xg_from_${g}`]])) as Record<keyof typeof XG_GROUP_LABELS, number>,
              XG_GROUP_LABELS,
            );
            return (
              <tr key={r.id} className="border-b border-line/50 last:border-0">
                <Td className="whitespace-nowrap">{r.season}</Td>
                <Td>{r.gameType === "regular" ? "Reg" : "PO"}</Td>
                <Td>{r.situation}</Td>
                <Td>{r.teamName ?? dash}</Td>
                {goalie ? (
                  <>
                    <Td right>{n(m.unblocked_shots_against)}</Td>
                    <Td right>{n(r.goalsAgainst)}</Td>
                    <Td right>{f(r.xGoals, 2)}</Td>
                    <Td right>{f(m.gsax, 2)}</Td>
                  </>
                ) : (
                  <>
                    <Td right>{n(m.unblocked_attempts)}</Td>
                    <Td right>{n(m.goals_non_empty_net)}</Td>
                    <Td right>{f(r.xGoals, 2)}</Td>
                    <Td right>{f(m.goals_minus_xg, 2)}</Td>
                    <Td right>{f(m.baseline_xg, 2)}</Td>
                    <Td className="text-xs text-ink-secondary">
                      {reasons.map((x) => `${x.label} ${signed(x.value)}`).join(" · ")}
                    </Td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">
        {goalie
          ? "Unblocked attempts faced with the goalie in net; situation is from the goalie's team's side. GSAx = xGA − GA."
          : "Unblocked attempts with a goalie in net (empty-net attempts are not modelled). Baseline = xG if every attempt were a league-average one; ixG = baseline + the reasons, which add up exactly."}{" "}
        Each season is scored by a model that never saw it. Descriptive, not a forecast. See the model card for accuracy against MoneyPuck.
      </p>
    </div>
  );
}

function ProspectCard({ p }: { p: Prospect }) {
  const contrib = p.contributions as Record<string, number>;
  const reasons = topReasons(contrib as Record<keyof typeof PROSPECT_GROUP_LABELS, number>, PROSPECT_GROUP_LABELS, 7);
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="text-2xl font-semibold">{(p.pNhlRegular * 100).toFixed(0)}%</span>{" "}
        <span className="text-ink-secondary">
          chance of 200+ NHL games in the seven seasons after the {p.draftYear} draft (a typical drafted skater:{" "}
          {(p.baselineP * 100).toFixed(0)}%). Drafted {p.overallPick} overall by {p.draftedBy ?? dash}.
        </span>
      </p>
      {p.pByPick !== null && (
        <p className="text-ink-secondary">
          From draft slot alone: <span className="font-medium">{(p.pByPick * 100).toFixed(0)}%</span>.{" "}
          {Math.abs(p.pNhlRegular - p.pByPick) < 0.05
            ? "The production profile and the draft slot roughly agree."
            : p.pNhlRegular > p.pByPick
              ? "The production profile looks stronger than where he was picked."
              : "The production profile looks weaker than where he was picked."}{" "}
          <span className="text-xs text-ink-muted">(On past drafts, draft slot alone predicted better than this model; the gap is a prompt to look closer, not a verdict.)</span>
        </p>
      )}
      <table className="w-full max-w-lg">
        <tbody>
          {reasons.map((r) => (
            <tr key={r.key} className="border-b border-line/50 last:border-0">
              <Td>{r.label}</Td>
              <Td right className={r.value >= 0 ? "text-good" : "text-critical"}>{signed(r.value * 100, 1)} pts</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted">
        Draft year: {p.d0League ?? dash} · {n(p.d0GamesPlayed)} GP · {n(p.d0Points)} P
        {p.d0NhlePpg !== null ? ` · ${p.d0NhlePpg.toFixed(2)} NHLe P/GP` : " · no NHLe factor for this league"} · age {f(p.ageAtDraft, 1)} at the draft.
      </p>
      <p className="text-xs text-ink-muted">
        {p.labelMature
          ? `Outcome: ${p.nhlGp7 ?? 0} NHL games in the seven seasons after the draft (${p.nhlRegular ? "became" : "did not become"} a 200-game player). This projection is out-of-sample: the model was trained without the ${p.draftYear} draft.`
          : `Outcome not known yet (${p.nhlGpToDate ?? 0} NHL games so far).`}{" "}
        Uses draft-time information only, not where the player was picked. Points are percentage points and add up exactly to the gap from a typical drafted skater.
      </p>
    </div>
  );
}

const sum = (rows: GameLog[], pick: (g: GameLog) => number | null) => {
  let total = 0;
  let seen = 0;
  for (const g of rows) {
    const v = pick(g);
    if (v !== null) {
      total += v;
      seen += 1;
    }
  }
  return seen === 0 ? null : total;
};

/** Totals derived from the imported per-game rows (never from estimates). */
function GameLogSummary({ label, rows, goalie }: { label: string; rows: GameLog[]; goalie: boolean }) {
  const withToi = rows.filter((g) => g.toiSeconds !== null);
  const avgToi = withToi.length ? sum(withToi, (g) => g.toiSeconds)! / withToi.length : null;
  if (goalie) {
    const sa = sum(rows, (g) => g.shotsAgainst);
    const ga = sum(rows, (g) => g.goalsAgainst);
    const sv = sa && ga !== null ? (sa - ga) / sa : null;
    const dec = (d: string) => rows.filter((g) => g.decision === d).length;
    return (
      <span>
        <span className="text-ink-muted">{label}:</span> {rows.length} GP · {dec("W")}-{dec("L")}-{dec("O")} · SV% {svPct(sv)} · GA/60{" "}
        {per60(sum(withToi, (g) => g.goalsAgainst), sum(withToi, (g) => g.toiSeconds))}
      </span>
    );
  }
  const pts = sum(rows, (g) => g.points);
  return (
    <span>
      <span className="text-ink-muted">{label}:</span> {rows.length} GP · {n(sum(rows, (g) => g.goals))} G · {n(pts)} P · avg TOI {clock(avgToi)} · P/60{" "}
      {per60(sum(withToi, (g) => g.points), sum(withToi, (g) => g.toiSeconds))}
    </span>
  );
}

function GameLogTable({ rows, goalie }: { rows: GameLog[]; goalie: boolean }) {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-navy-900">
          <tr className="border-b border-line">
            <Th>Date</Th>
            <Th>Opp</Th>
            {goalie ? (
              <>
                <Th>Dec</Th>
                <Th right>GS</Th>
                <Th right>SA</Th>
                <Th right>GA</Th>
                <Th right>SV%</Th>
              </>
            ) : (
              <>
                <Th right>G</Th>
                <Th right>A</Th>
                <Th right>P</Th>
                <Th right>+/-</Th>
                <Th right>SOG</Th>
                <Th right>PPP</Th>
                <Th right>Shifts</Th>
              </>
            )}
            <Th right>TOI</Th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((g) => (
            <tr key={g.id} className="border-b border-line/50 last:border-0">
              <Td className="whitespace-nowrap">{g.gameDate}</Td>
              <Td>{g.homeRoad === "R" ? "@" : "vs"} {g.opponentAbbrev ?? dash}</Td>
              {goalie ? (
                <>
                  <Td>{g.decision ?? dash}</Td>
                  <Td right>{n(g.gamesStarted)}</Td>
                  <Td right>{n(g.shotsAgainst)}</Td>
                  <Td right>{n(g.goalsAgainst)}</Td>
                  <Td right>{svPct(g.savePct)}</Td>
                </>
              ) : (
                <>
                  <Td right>{n(g.goals)}</Td>
                  <Td right>{n(g.assists)}</Td>
                  <Td right>{n(g.points)}</Td>
                  <Td right>{n(g.plusMinus)}</Td>
                  <Td right>{n(g.shots)}</Td>
                  <Td right>{n(g.powerPlayPoints)}</Td>
                  <Td right>{n(g.shifts)}</Td>
                </>
              )}
              <Td right>{clock(g.toiSeconds)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RealDataPlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const ctx = await resolveAppContext();
  const { playerId } = await params;
  if (!/^\d{1,10}$/.test(playerId)) notFound();
  const data = await getReferencePlayer(ctx.org.id, playerId);
  if (!data) notFound();

  const bio = data.bios.find((b) => b.source === "nhl") ?? data.bios[0] ?? null;
  const name = bio?.fullName ?? data.seasons.find((s) => s.playerName)?.playerName ?? playerId;
  const goalie = (bio?.position ?? data.seasons.find((s) => s.position)?.position) === "G";
  const career = data.seasons.filter((s) => s.source === "nhl_career");
  const league = data.seasons.filter((s) => s.source === "nhl_stats");
  const mp = data.seasons.filter((s) => s.source === "moneypuck");
  const rxg = data.seasons.filter((s) => s.source === (goalie ? "rosteriq_xg_goalies" : "rosteriq_xg"));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/real-data/players" className="text-sm text-accent-text hover:underline">← Players & stats</Link>
        <h1 className="mt-1 text-xl font-semibold">
          {name} <span className="font-mono text-sm font-normal text-ink-muted">NHL id {playerId}</span>
        </h1>
        {bio && (
          <p className="text-sm text-ink-secondary">
            {[
              bio.position,
              bio.shootsCatches && `${goalie ? "Catches" : "Shoots"} ${bio.shootsCatches}`,
              bio.dateOfBirth && `Born ${bio.dateOfBirth}`,
              [bio.birthCity, bio.birthCountry].filter(Boolean).join(", "),
              bio.heightCm && `${bio.heightCm} cm`,
              bio.weightKg && `${bio.weightKg} kg`,
              bio.currentTeamAbbrev && `Current team ${bio.currentTeamAbbrev}`,
              bio.isActive === false && "Inactive",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {bio?.draftYear ? (
          <p className="text-sm text-ink-muted">
            Drafted {bio.draftYear} · round {bio.draftRound ?? dash}, pick {bio.draftPickInRound ?? dash} ({bio.draftOverall ?? dash} overall) by{" "}
            {bio.draftTeamAbbrev ?? dash}
          </p>
        ) : bio && bio.source === "nhl" && bio.isActive !== null ? (
          <p className="text-sm text-ink-muted">No NHL draft record in the source.</p>
        ) : null}
      </div>

      {career.length > 0 && (
        <Card title={`Career by season — NHL API (${career.length} lines)`}>
          <CareerTable rows={career} goalie={goalie} />
          <p className="mt-2 text-xs text-ink-muted">
            Non-NHL lines are dimmed. TOI appears only where the NHL reports it; — means not reported (never estimated).
          </p>
        </Card>
      )}

      {league.length > 0 && (
        <Card title="NHL league season summaries — NHL API">
          <CareerTable rows={league} goalie={goalie} />
        </Card>
      )}

      {mp.length > 0 && (
        <Card title="MoneyPuck season summaries — Data: MoneyPuck.com">
          <MoneyPuckTable rows={mp} goalie={goalie} />
        </Card>
      )}

      {rxg.length > 0 && (
        <Card title={`RosterIQ expected goals — ${goalie ? "xGA and GSAx" : "ixG and why"} (model output)`}>
          <RosterIqXgTable rows={rxg} goalie={goalie} />
        </Card>
      )}

      {data.prospect && (
        <Card title="RosterIQ prospect projection (model output)">
          <ProspectCard p={data.prospect} />
        </Card>
      )}

      {(() => {
        const groups = new Map<string, GameLog[]>();
        for (const g of data.gameLogs) {
          const key = `${g.season}|${g.gameType}`;
          groups.set(key, [...(groups.get(key) ?? []), g]);
        }
        return [...groups.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([key, rows]) => {
            const [season, type] = key.split("|");
            const g = rows.some((r) => r.shotsAgainst !== null);
            return (
              <Card key={key} title={`Game log ${season} ${type === "regular" ? "regular season" : "playoffs"} — NHL API (${rows.length} games)`}>
                <div className="mb-3 space-y-1 text-sm">
                  <div><GameLogSummary label="Season" rows={rows} goalie={g} /></div>
                  {rows.length > 10 && (
                    <div><GameLogSummary label="Last 10" rows={rows.slice(-10)} goalie={g} /></div>
                  )}
                </div>
                <GameLogTable rows={rows} goalie={g} />
                <p className="mt-2 text-xs text-ink-muted">
                  Summary lines are derived in RosterIQ from these per-game rows (per-60 uses only games with reported TOI;
                  goalie record is W-L-O with O = OT/SO loss; relief appearances have no decision). Data: NHL.com.
                </p>
              </Card>
            );
          });
      })()}

      {data.roster.length > 0 && (
        <Card title="Roster history (imported seasons)">
          <ul className="text-sm">
            {data.roster.map((r) => (
              <li key={r.id}>
                {r.season} · {r.teamAbbrev} · #{r.sweaterNumber ?? dash} · {r.position ?? dash}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Data sources & provenance">
        <ul className="space-y-2 text-sm">
          {data.sources.map((s) => (
            <li key={s.id}>
              <span className="font-medium">{s.name}</span>
              <span className="text-ink-muted">
                {" "}
                · effective {s.effectiveSeason ?? dash} · retrieved {s.retrievedAt?.toISOString().slice(0, 16).replace("T", " ") ?? dash} UTC ·{" "}
                {s.credit}
              </span>
              {s.importId && (
                <Link href={`/imports/${s.importId}`} className="ml-2 text-accent-text hover:underline">
                  import
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
