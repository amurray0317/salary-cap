import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { valuatePlayer } from "@/server/services/valuationService";
import { setPlayerStatusAction, terminateContractAction } from "@/server/actions/contractActions";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { formatDate, money, moneyCompact, pct, positionLabel, statusLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Player profile" };

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveAppContext();
  const { id } = await params;
  const db = getDb();

  // Org isolation: only players belonging to the active organization resolve.
  const [player] = await db
    .select()
    .from(schema.players)
    .where(and(eq(schema.players.id, id), eq(schema.players.organizationId, ctx.org.id)))
    .limit(1);
  if (!player) notFound();

  const contracts = await db
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.playerId, player.id))
    .orderBy(asc(schema.contracts.startDate));
  const activeContract = contracts.find((c) => c.contractStatus === "active") ?? null;

  const contractSeasonRows = activeContract
    ? await db
        .select({ cs: schema.contractSeasons, seasonName: schema.leagueSeasons.name, sortOrder: schema.leagueSeasons.sortOrder })
        .from(schema.contractSeasons)
        .innerJoin(schema.leagueSeasons, eq(schema.contractSeasons.seasonId, schema.leagueSeasons.id))
        .where(eq(schema.contractSeasons.contractId, activeContract.id))
        .orderBy(asc(schema.leagueSeasons.sortOrder))
    : [];

  const valuation = ctx.season ? await valuatePlayer(player.id, ctx.season.id) : null;

  const stats = await db
    .select({ st: schema.playerStatistics, seasonName: schema.leagueSeasons.name })
    .from(schema.playerStatistics)
    .innerJoin(schema.leagueSeasons, eq(schema.playerStatistics.seasonId, schema.leagueSeasons.id))
    .where(eq(schema.playerStatistics.playerId, player.id))
    .orderBy(asc(schema.leagueSeasons.sortOrder));

  const canEdit = ["analyst", "cap_analyst", "assistant_gm", "general_manager", "org_admin", "league_admin"].includes(ctx.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{player.fullName}</h1>
          <p className="text-sm text-ink-muted">
            {positionLabel(player.position)} · {statusLabel(player.rosterStatus)} ·{" "}
            {statusLabel(player.freeAgentStatus)}
            {player.injuryStatus ? ` · ⚕ ${player.injuryStatus}` : ""}
          </p>
        </div>
        {canEdit && (
          <form action={setPlayerStatusAction} className="flex items-center gap-2">
            <input type="hidden" name="organizationId" value={ctx.org.id} />
            <input type="hidden" name="playerId" value={player.id} />
            <label className="text-sm text-ink-muted" htmlFor="status-select">Official move:</label>
            <select
              id="status-select"
              name="rosterStatus"
              defaultValue={player.rosterStatus}
              className="rounded-md border border-line bg-navy-900 px-2 py-1.5 text-sm"
            >
              {schema.rosterStatus.enumValues.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:text-ink">
              Apply
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Age" value={valuation?.age !== null && valuation !== null ? String(valuation.age) : "—"} detail={player.dateOfBirth ? `Born ${formatDate(player.dateOfBirth)}` : undefined} />
        <StatTile label="Cap hit" value={valuation?.capHit != null ? moneyCompact(valuation.capHit) : "—"} detail={ctx.season?.name} />
        <StatTile
          label="Est. market value"
          value={valuation?.market ? moneyCompact(valuation.market.estimatedAav) : "—"}
          detail={valuation?.market ? `Range ${moneyCompact(valuation.market.lowEstimate)}–${moneyCompact(valuation.market.highEstimate)} (estimate)` : "No projection available"}
        />
        <StatTile
          label="Expected surplus"
          value={valuation?.surplus != null ? moneyCompact(valuation.surplus) : "—"}
          tone={valuation?.surplus != null ? (valuation.surplus >= 0 ? "good" : "critical") : "default"}
          detail="Performance value − cap hit (estimate)"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bio & status">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[
              ["Shoots/catches", player.shootsCatches ?? "—"],
              ["Height", player.heightCm ? `${player.heightCm} cm` : "—"],
              ["Weight", player.weightKg ? `${player.weightKg} kg` : "—"],
              ["Nationality", player.nationality ?? "—"],
              ["Draft", player.draftYear ? `${player.draftYear} · R${player.draftRound} · #${player.draftOverall}` : "—"],
              ["Pro games", String(player.proGamesPlayed)],
              ["Waiver status", statusLabel(player.waiverStatus)],
              ["Data provenance", player.provenance],
            ].map(([k, v]) => (
              <div key={k as string} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {player.notes && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-secondary">{player.notes}</p>}
        </Card>

        <Card title="Active contract">
          {!activeContract ? (
            <div>
              <p className="text-sm text-ink-muted">No active contract.</p>
              <Link
                href={`/contracts/new?player=${player.id}`}
                className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Add contract
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>Type: <span className="text-ink-secondary">{activeContract.contractType.replace(/_/g, " ")}</span></span>
                <span>AAV: <span className="tabular-nums">{money(activeContract.averageAnnualValue)}</span></span>
                <span>Total: <span className="tabular-nums">{money(activeContract.totalValue)}</span></span>
                <span>{formatDate(activeContract.startDate)} → {formatDate(activeContract.endDate)}</span>
                {activeContract.noTradeClause && <span className="text-warn">NTC</span>}
                {activeContract.noMovementClause && <span className="text-warn">NMC</span>}
                {activeContract.retainedSalaryPercentage > 0 && (
                  <span className="text-ink-muted">{pct(activeContract.retainedSalaryPercentage)} retained by others</span>
                )}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th>Season</Th>
                    <Th right>Cap hit</Th>
                    <Th right>Base salary</Th>
                    <Th right>Bonus</Th>
                    <Th right>Total cash</Th>
                  </tr>
                </thead>
                <tbody>
                  {contractSeasonRows.map(({ cs, seasonName }) => (
                    <tr key={cs.id} className="border-b border-line/50 last:border-0">
                      <Td>{seasonName}</Td>
                      <Td right>{money(cs.capHit)}</Td>
                      <Td right>{money(cs.baseSalary)}</Td>
                      <Td right>{money(cs.performanceBonus)}</Td>
                      <Td right>{money(cs.totalCash)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {canEdit && (
                <form action={terminateContractAction} className="mt-3">
                  <input type="hidden" name="organizationId" value={ctx.org.id} />
                  <input type="hidden" name="contractId" value={activeContract.id} />
                  <button className="text-xs text-critical hover:underline">
                    Terminate contract (audited)
                  </button>
                </form>
              )}
            </>
          )}
        </Card>

        <Card title={`Valuation — ${ctx.season?.name ?? ""} (model ${valuation?.market?.modelVersion ?? "riq-market-v0.1"})`}>
          {!valuation?.market || !valuation.performance ? (
            <p className="text-sm text-ink-muted">
              No projection stored for this player and season, so no estimate can be produced.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Low" value={moneyCompact(valuation.market.lowEstimate)} />
                <StatTile label="Median est. AAV" value={moneyCompact(valuation.market.estimatedAav)} />
                <StatTile label="High" value={moneyCompact(valuation.market.highEstimate)} />
              </div>
              <p>
                Expected term: <strong>{valuation.market.estimatedTermYears} years</strong> · Est. total:{" "}
                <strong className="tabular-nums">{money(valuation.market.estimatedTotalValue)}</strong> · Confidence:{" "}
                <strong>{pct(valuation.market.confidence)}</strong>
              </p>
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-ink-muted">Performance value components</h3>
                <ul className="space-y-1">
                  {valuation.performance.components.map((c) => (
                    <li key={c.label} className="flex justify-between gap-4">
                      <span className="text-ink-secondary">{c.label} <span className="text-xs text-ink-muted">({c.formula})</span></span>
                      <span className="tabular-nums">{money(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-ink-muted">Comparables used</h3>
                {valuation.market.comparablesUsed.length === 0 ? (
                  <p className="text-ink-muted">None found for this position.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {valuation.market.comparablesUsed.map((c) => (
                      <li key={c.id} className="flex justify-between gap-4 text-ink-secondary">
                        <span>{c.playerName} ({c.position}, {c.ageAtSigning}, {c.platformPoints} pts, {c.signingSeason})</span>
                        <span className="tabular-nums">{moneyCompact(c.aav)} × {c.termYears}y</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-ink-muted">Assumptions</h3>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-muted">
                  {valuation.market.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
              <p className="border-t border-line pt-2 text-xs text-ink-muted">
                {valuation.market.disclaimer} Input data date: {valuation.inputDataDate}.
              </p>
            </div>
          )}
        </Card>

        <Card title="Statistics & projections">
          {stats.length === 0 && !valuation?.projection ? (
            <p className="text-sm text-ink-muted">No statistics recorded.</p>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th>Season</Th>
                    <Th right>GP</Th>
                    <Th right>G</Th>
                    <Th right>A</Th>
                    <Th right>P</Th>
                    <Th right>GAR</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(({ st, seasonName }) => (
                    <tr key={st.id} className="border-b border-line/50 last:border-0">
                      <Td>{seasonName} <span className="text-xs text-ink-muted">({st.provenance})</span></Td>
                      <Td right>{st.gamesPlayed}</Td>
                      <Td right>{st.goals}</Td>
                      <Td right>{st.assists}</Td>
                      <Td right>{st.points}</Td>
                      <Td right>{st.goalsAboveReplacement.toFixed(1)}</Td>
                    </tr>
                  ))}
                  {valuation?.projection && (
                    <tr>
                      <Td>{valuation.seasonName} <span className="text-xs text-accent-text">(projected)</span></Td>
                      <Td right>{valuation.projection.projectedGamesPlayed}</Td>
                      <Td right>{Math.round(valuation.projection.projectedGoals)}</Td>
                      <Td right>{Math.round(valuation.projection.projectedAssists)}</Td>
                      <Td right>{Math.round(valuation.projection.projectedPoints)}</Td>
                      <Td right>{valuation.projection.projectedGar.toFixed(1)}</Td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-muted">
                Projection model: {valuation?.projection?.modelVersion ?? "—"} · provenance labels shown per row.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
