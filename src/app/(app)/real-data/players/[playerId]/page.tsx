import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { getReferencePlayer } from "@/server/services/referenceDataService";
import { Card, Td, Th } from "@/components/ui";
import type { schema } from "@/db/client";

export const metadata: Metadata = { title: "Real data · player" };

type Season = typeof schema.extPlayerSeasons.$inferSelect;

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
