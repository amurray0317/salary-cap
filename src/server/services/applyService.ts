/**
 * Applies a scenario's hypothetical transactions to OFFICIAL records.
 *
 * This is the single place where the scenario/official boundary is crossed,
 * and it only runs when a user with the manage_team capability explicitly
 * confirms (see applyScenarioAction). Every change happens inside one
 * database transaction; each applied move also writes an official
 * `transactions` log row and the scenario is marked `applied` (read-only).
 *
 * NOTE: unlike sibling services this module does not import "server-only" —
 * it takes the Db as a parameter so the integration tests can exercise it
 * against an in-memory PGlite. It is only ever called from server actions.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { scenarioPayloadSchema, type ProposedSeason, type ScenarioPayload } from "@/lib/scenario/payloads";

export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyError";
  }
}

export interface AppliedMove {
  label: string;
  kind: ScenarioPayload["kind"];
  summary: string;
}

export interface ApplyResult {
  scenarioId: string;
  appliedCount: number;
  moves: AppliedMove[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface ApplyContext {
  tx: Tx;
  scenario: typeof schema.scenarios.$inferSelect;
  team: typeof schema.teams.$inferSelect;
  seasons: Array<typeof schema.leagueSeasons.$inferSelect>;
  seasonByName: Map<string, typeof schema.leagueSeasons.$inferSelect>;
  userId: string;
  today: string;
}

async function logOfficialTransaction(
  ctx: ApplyContext,
  type: (typeof schema.transactionType.enumValues)[number],
  description: string,
  items: Array<{ playerId?: string | null; contractId?: string | null; itemType: string }>,
  payload: unknown,
): Promise<void> {
  const [row] = await ctx.tx
    .insert(schema.transactions)
    .values({
      organizationId: ctx.scenario.organizationId,
      teamId: ctx.scenario.teamId,
      seasonId: ctx.scenario.baseSeasonId,
      transactionType: type,
      transactionDate: ctx.today,
      description,
      isOfficial: true,
      payload: payload as Record<string, unknown>,
      createdBy: ctx.userId,
    })
    .returning();
  if (row && items.length > 0) {
    await ctx.tx.insert(schema.transactionItems).values(
      items.map((i) => ({
        transactionId: row.id,
        playerId: i.playerId ?? null,
        contractId: i.contractId ?? null,
        itemType: i.itemType,
        details: {},
      })),
    );
  }
}

/** Loads a contract owned by the scenario's team, with its season rows. */
async function loadTeamContract(ctx: ApplyContext, contractId: string) {
  const [contract] = await ctx.tx
    .select()
    .from(schema.contracts)
    .where(
      and(
        eq(schema.contracts.id, contractId),
        eq(schema.contracts.teamId, ctx.scenario.teamId),
        eq(schema.contracts.contractStatus, "active"),
      ),
    )
    .limit(1);
  if (!contract) {
    throw new ApplyError(`Target contract ${contractId.slice(0, 8)}… is not an active contract on this team`);
  }
  const seasonRows = await ctx.tx
    .select()
    .from(schema.contractSeasons)
    .where(eq(schema.contractSeasons.contractId, contract.id));
  const [player] = await ctx.tx
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, contract.playerId))
    .limit(1);
  if (!player) throw new ApplyError("Contract has no player record");
  return { contract, seasonRows, player };
}

/** Creates a player + contract + season rows for an incoming signing/trade. */
async function createIncomingContract(
  ctx: ApplyContext,
  opts: {
    playerName: string;
    position: string;
    isTwoWay: boolean;
    retainedByOthersPct: number;
    seasons: ProposedSeason[];
    provenanceLabel: string;
  },
): Promise<{ playerId: string; contractId: string }> {
  const covered = opts.seasons
    .map((ps) => ({ ps, season: ctx.seasonByName.get(ps.seasonName) }))
    .filter((x): x is { ps: ProposedSeason; season: (typeof ctx.seasons)[number] } => x.season !== undefined)
    .sort((a, b) => a.season.sortOrder - b.season.sortOrder);
  if (covered.length === 0) {
    throw new ApplyError(`"${opts.playerName}": none of the proposed seasons exist in this league`);
  }

  // Reuse an existing free-agent record with the same name in this org, if any.
  const [existing] = await ctx.tx
    .select()
    .from(schema.players)
    .where(
      and(
        eq(schema.players.organizationId, ctx.scenario.organizationId),
        eq(schema.players.fullName, opts.playerName),
        eq(schema.players.rosterStatus, "non_roster"),
      ),
    )
    .limit(1);

  let playerId: string;
  if (existing) {
    playerId = existing.id;
    await ctx.tx
      .update(schema.players)
      .set({
        currentTeamId: ctx.scenario.teamId,
        rosterStatus: "pro_active",
        freeAgentStatus: "under_contract",
        updatedAt: new Date(),
      })
      .where(eq(schema.players.id, existing.id));
  } else {
    const [created] = await ctx.tx
      .insert(schema.players)
      .values({
        organizationId: ctx.scenario.organizationId,
        fullName: opts.playerName,
        position: opts.position,
        currentTeamId: ctx.scenario.teamId,
        rosterStatus: "pro_active",
        freeAgentStatus: "under_contract",
        provenance: "user_entered",
        notes: `Created by applying scenario "${ctx.scenario.name}" (${opts.provenanceLabel}).`,
      })
      .returning();
    if (!created) throw new ApplyError("Could not create player record");
    playerId = created.id;
  }

  const totalCapHit = covered.reduce((s, x) => s + x.ps.capHit, 0);
  const totalCash = covered.reduce((s, x) => s + (x.ps.baseSalary ?? x.ps.capHit) + (x.ps.performanceBonus ?? 0), 0);
  const first = covered[0]!;
  const last = covered[covered.length - 1]!;

  const [contract] = await ctx.tx
    .insert(schema.contracts)
    .values({
      organizationId: ctx.scenario.organizationId,
      playerId,
      teamId: ctx.scenario.teamId,
      leagueId: ctx.team.leagueId,
      contractType: opts.isTwoWay ? "two_way" : "standard",
      contractStatus: "active",
      signedDate: ctx.today,
      startDate: first.season.startDate,
      endDate: last.season.endDate,
      totalValue: totalCash,
      averageAnnualValue: Math.round(totalCapHit / covered.length),
      guaranteedValue: totalCash,
      retainedSalaryPercentage: opts.retainedByOthersPct,
      provenance: "user_entered",
      createdBy: ctx.userId,
    })
    .returning();
  if (!contract) throw new ApplyError("Could not create contract record");

  await ctx.tx.insert(schema.contractSeasons).values(
    covered.map(({ ps, season }) => ({
      contractId: contract.id,
      seasonId: season.id,
      baseSalary: ps.baseSalary ?? ps.capHit,
      performanceBonus: ps.performanceBonus ?? 0,
      totalCash: (ps.baseSalary ?? ps.capHit) + (ps.performanceBonus ?? 0),
      capHit: ps.capHit,
    })),
  );

  return { playerId, contractId: contract.id };
}

async function applyOne(ctx: ApplyContext, label: string, payload: ScenarioPayload): Promise<AppliedMove> {
  switch (payload.kind) {
    case "sign_free_agent": {
      const { playerId, contractId } = await createIncomingContract(ctx, {
        playerName: payload.playerName,
        position: payload.position,
        isTwoWay: payload.isTwoWay,
        retainedByOthersPct: 0,
        seasons: payload.seasons,
        provenanceLabel: "free-agent signing",
      });
      await logOfficialTransaction(ctx, "sign_free_agent", `Signed ${payload.playerName} (${payload.position})`, [
        { playerId, contractId, itemType: "player_in" },
      ], payload);
      return { label, kind: payload.kind, summary: `Signed ${payload.playerName}` };
    }

    case "trade_in": {
      const { playerId, contractId } = await createIncomingContract(ctx, {
        playerName: payload.playerName,
        position: payload.position,
        isTwoWay: false,
        retainedByOthersPct: payload.retainedByOthersPct,
        seasons: payload.seasons,
        provenanceLabel: "trade acquisition",
      });
      await logOfficialTransaction(ctx, "trade", `Acquired ${payload.playerName}${payload.tradePartner ? ` from ${payload.tradePartner}` : ""}`, [
        { playerId, contractId, itemType: "player_in" },
      ], payload);
      return { label, kind: payload.kind, summary: `Acquired ${payload.playerName}` };
    }

    case "trade_out": {
      const { contract, seasonRows, player } = await loadTeamContract(ctx, payload.contractId);
      // Retained salary follows the departed player season by season.
      if (payload.retainedPct > 0) {
        const leagueSeasonIds = new Set(ctx.seasons.map((s) => s.id));
        const retainedRows = seasonRows
          .filter((r) => leagueSeasonIds.has(r.seasonId))
          .map((r) => ({
            organizationId: ctx.scenario.organizationId,
            teamId: ctx.scenario.teamId,
            seasonId: r.seasonId,
            obligationType: "retained",
            playerName: player.fullName,
            playerId: player.id,
            amount: Math.round(r.capHit * payload.retainedPct),
            notes: `${(payload.retainedPct * 100).toFixed(0)}% retained in trade (scenario "${ctx.scenario.name}")`,
          }));
        if (retainedRows.length > 0) await ctx.tx.insert(schema.capObligations).values(retainedRows);
      }
      await ctx.tx
        .update(schema.contracts)
        .set({ contractStatus: "traded", updatedAt: new Date() })
        .where(eq(schema.contracts.id, contract.id));
      await ctx.tx
        .update(schema.players)
        .set({ currentTeamId: null, rosterStatus: "non_roster", updatedAt: new Date() })
        .where(eq(schema.players.id, player.id));
      await logOfficialTransaction(ctx, "trade", `Traded ${player.fullName}${payload.tradePartner ? ` to ${payload.tradePartner}` : ""}${payload.retainedPct > 0 ? ` (${(payload.retainedPct * 100).toFixed(0)}% retained)` : ""}`, [
        { playerId: player.id, contractId: contract.id, itemType: "player_out" },
      ], payload);
      return { label, kind: payload.kind, summary: `Traded ${player.fullName}` };
    }

    case "call_up":
    case "send_down":
    case "ir_placement": {
      const { contract, player } = await loadTeamContract(ctx, payload.contractId);
      const status =
        payload.kind === "call_up"
          ? "pro_active"
          : payload.kind === "send_down"
            ? "minor"
            : payload.longTerm
              ? "ltir"
              : "injured_reserve";
      await ctx.tx
        .update(schema.players)
        .set({ rosterStatus: status, updatedAt: new Date() })
        .where(eq(schema.players.id, player.id));
      const txType = payload.kind === "call_up" ? "call_up" : payload.kind === "send_down" ? "send_down" : (payload.longTerm ? "ltir_placement" : "ir_placement");
      await logOfficialTransaction(ctx, txType, `${player.fullName}: ${status.replace(/_/g, " ")}`, [
        { playerId: player.id, contractId: contract.id, itemType: "assignment" },
      ], payload);
      return { label, kind: payload.kind, summary: `${player.fullName} → ${status.replace(/_/g, " ")}` };
    }

    case "extension": {
      const { contract, seasonRows, player } = await loadTeamContract(ctx, payload.contractId);
      const existingSeasonIds = new Set(seasonRows.map((r) => r.seasonId));
      const added = payload.seasons
        .map((ps) => ({ ps, season: ctx.seasonByName.get(ps.seasonName) }))
        .filter(
          (x): x is { ps: ProposedSeason; season: (typeof ctx.seasons)[number] } =>
            x.season !== undefined && !existingSeasonIds.has(x.season.id),
        )
        .sort((a, b) => a.season.sortOrder - b.season.sortOrder);
      if (added.length === 0) {
        throw new ApplyError(`Extension for ${player.fullName} adds no new seasons inside the projection window`);
      }
      await ctx.tx.insert(schema.contractSeasons).values(
        added.map(({ ps, season }) => ({
          contractId: contract.id,
          seasonId: season.id,
          baseSalary: ps.baseSalary ?? ps.capHit,
          performanceBonus: ps.performanceBonus ?? 0,
          totalCash: (ps.baseSalary ?? ps.capHit) + (ps.performanceBonus ?? 0),
          capHit: ps.capHit,
        })),
      );
      const addedTotals = added.map(({ ps }) => ({
        capHit: ps.capHit,
        totalCash: (ps.baseSalary ?? ps.capHit) + (ps.performanceBonus ?? 0),
      }));
      const existingTotals = seasonRows.map((r) => ({ capHit: r.capHit, totalCash: r.totalCash }));
      const allRows = [...existingTotals, ...addedTotals];
      const totalCapHit = allRows.reduce((s, r) => s + r.capHit, 0);
      const totalCash = allRows.reduce((s, r) => s + r.totalCash, 0);
      const lastSeason = added[added.length - 1]!.season;
      await ctx.tx
        .update(schema.contracts)
        .set({
          endDate: lastSeason.endDate > contract.endDate ? lastSeason.endDate : contract.endDate,
          totalValue: totalCash,
          averageAnnualValue: Math.round(totalCapHit / allRows.length),
          updatedAt: new Date(),
        })
        .where(eq(schema.contracts.id, contract.id));
      await logOfficialTransaction(ctx, "extension", `Extended ${player.fullName} (${added.length} season${added.length > 1 ? "s" : ""})`, [
        { playerId: player.id, contractId: contract.id, itemType: "extension" },
      ], payload);
      return { label, kind: payload.kind, summary: `Extended ${player.fullName}` };
    }

    case "buyout": {
      const { contract, seasonRows, player } = await loadTeamContract(ctx, payload.contractId);
      const leagueSeasonIds = new Set(ctx.seasons.map((s) => s.id));
      const deadRows = seasonRows
        .filter((r) => leagueSeasonIds.has(r.seasonId))
        .map((r) => ({
          organizationId: ctx.scenario.organizationId,
          teamId: ctx.scenario.teamId,
          seasonId: r.seasonId,
          obligationType: "buyout",
          playerName: player.fullName,
          playerId: player.id,
          amount: Math.round(r.capHit * payload.deadCapFraction),
          notes: `Simplified buyout (fraction ${payload.deadCapFraction.toFixed(2)}) from scenario "${ctx.scenario.name}"`,
        }));
      if (deadRows.length > 0) await ctx.tx.insert(schema.capObligations).values(deadRows);
      await ctx.tx
        .update(schema.contracts)
        .set({ contractStatus: "bought_out", updatedAt: new Date() })
        .where(eq(schema.contracts.id, contract.id));
      await ctx.tx
        .update(schema.players)
        .set({ currentTeamId: null, rosterStatus: "non_roster", freeAgentStatus: "ufa", updatedAt: new Date() })
        .where(eq(schema.players.id, player.id));
      await logOfficialTransaction(ctx, "buyout", `Bought out ${player.fullName}`, [
        { playerId: player.id, contractId: contract.id, itemType: "player_out" },
      ], payload);
      return { label, kind: payload.kind, summary: `Bought out ${player.fullName}` };
    }
  }
}

/**
 * Applies every enabled transaction of the scenario to official data, in
 * order, inside one DB transaction. Throws ApplyError (rolling back
 * everything) if the scenario is not applyable or any payload is invalid.
 */
export async function applyScenario(
  db: Db,
  opts: { scenarioId: string; organizationId: string; userId: string },
): Promise<ApplyResult> {
  const [scenario] = await db
    .select()
    .from(schema.scenarios)
    .where(
      and(eq(schema.scenarios.id, opts.scenarioId), eq(schema.scenarios.organizationId, opts.organizationId)),
    )
    .limit(1);
  if (!scenario) throw new ApplyError("Scenario not found in this organization");
  if (scenario.status === "applied") throw new ApplyError("Scenario has already been applied");
  if (scenario.status === "archived") throw new ApplyError("Archived scenarios cannot be applied");

  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, scenario.teamId)).limit(1);
  if (!team) throw new ApplyError("Scenario team not found");

  const seasons = await db
    .select()
    .from(schema.leagueSeasons)
    .where(eq(schema.leagueSeasons.leagueId, team.leagueId))
    .orderBy(asc(schema.leagueSeasons.sortOrder), asc(schema.leagueSeasons.startDate));

  const txRows = await db
    .select()
    .from(schema.scenarioTransactions)
    .where(eq(schema.scenarioTransactions.scenarioId, scenario.id))
    .orderBy(asc(schema.scenarioTransactions.sortOrder), asc(schema.scenarioTransactions.createdAt));

  const enabled = txRows.filter((t) => t.isEnabled);
  if (enabled.length === 0) throw new ApplyError("Scenario has no enabled transactions to apply");

  const parsed = enabled.map((row) => {
    const result = scenarioPayloadSchema.safeParse(row.payload);
    if (!result.success) {
      throw new ApplyError(`Transaction "${row.label}" has an invalid payload and cannot be applied`);
    }
    return { label: row.label, payload: result.data };
  });

  const today = new Date().toISOString().slice(0, 10);

  const moves = await db.transaction(async (tx) => {
    const ctx: ApplyContext = {
      tx,
      scenario,
      team,
      seasons,
      seasonByName: new Map(seasons.map((s) => [s.name, s])),
      userId: opts.userId,
      today,
    };
    const applied: AppliedMove[] = [];
    for (const { label, payload } of parsed) {
      applied.push(await applyOne(ctx, label, payload));
    }
    await tx
      .update(schema.scenarios)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(schema.scenarios.id, scenario.id));
    await tx.insert(schema.auditLogs).values({
      organizationId: scenario.organizationId,
      userId: opts.userId,
      action: "scenario.apply",
      entityType: "scenario",
      entityId: scenario.id,
      previousValues: { status: scenario.status },
      newValues: { status: "applied", moves: applied.map((m) => m.summary) },
      reason: "Scenario explicitly applied to official roster",
    });
    return applied;
  });

  return { scenarioId: scenario.id, appliedCount: moves.length, moves };
}
