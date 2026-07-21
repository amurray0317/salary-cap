/**
 * Assembles CapInputs from persisted records and runs the cap engine.
 * All reads are org-scoped through requireOrgAccess before this service is
 * called (see server actions); functions here take an already-authorized ctx.
 *
 * No "server-only" import: this module is only referenced from server code,
 * and integration tests exercise it against in-memory PGlite via
 * setDbForTesting (the "server-only" marker throws under vitest).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { calculateCap } from "@/lib/engine/capEngine";
import type {
  CapInput,
  CapResult,
  EngineContractSeason,
  EngineRosterStatus,
  RuleSet,
} from "@/lib/engine/types";

export interface SeasonInfo {
  id: string;
  name: string;
  sortOrder: number;
  isCurrent: boolean;
}

export interface TeamCapContext {
  team: { id: string; name: string; abbreviation: string; leagueId: string; organizationId: string };
  seasons: SeasonInfo[];
  inputs: CapInput[]; // aligned with seasons
}

export async function loadRuleSet(leagueId: string, seasonId: string): Promise<RuleSet> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.leagueRules)
    .where(
      and(
        eq(schema.leagueRules.leagueId, leagueId),
        eq(schema.leagueRules.seasonId, seasonId),
        eq(schema.leagueRules.isActive, true),
      ),
    );
  const set: RuleSet = new Map();
  for (const r of rows) {
    set.set(r.ruleKey, {
      key: r.ruleKey,
      name: r.ruleName,
      category: r.ruleCategory,
      numericValue: r.numericValue,
      textValue: r.textValue,
      version: r.ruleVersion,
      effectiveDate: r.effectiveDate,
    });
  }
  return set;
}

/**
 * Builds one CapInput per league season for a team from official records:
 * active contracts' season rows, player roster statuses, and cap obligations.
 */
export async function buildTeamCapInputs(teamId: string): Promise<TeamCapContext> {
  const db = getDb();
  const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).limit(1);
  const team = teamRows[0];
  if (!team) throw new Error("Team not found");

  const seasons = await db
    .select()
    .from(schema.leagueSeasons)
    .where(eq(schema.leagueSeasons.leagueId, team.leagueId))
    .orderBy(asc(schema.leagueSeasons.sortOrder), asc(schema.leagueSeasons.startDate));

  const contracts = await db
    .select({
      contract: schema.contracts,
      player: schema.players,
    })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .where(and(eq(schema.contracts.teamId, teamId), eq(schema.contracts.contractStatus, "active")));

  const contractIds = contracts.map((c) => c.contract.id);
  const seasonRows =
    contractIds.length > 0
      ? await db
          .select()
          .from(schema.contractSeasons)
          .where(inArray(schema.contractSeasons.contractId, contractIds))
      : [];

  const obligations = await db
    .select()
    .from(schema.capObligations)
    .where(eq(schema.capObligations.teamId, teamId));

  const byContract = new Map(contracts.map((c) => [c.contract.id, c]));
  const inputs: CapInput[] = [];

  for (const season of seasons) {
    const rules = await loadRuleSet(team.leagueId, season.id);
    const contractSeasons: EngineContractSeason[] = [];

    for (const cs of seasonRows) {
      if (cs.seasonId !== season.id) continue;
      const owner = byContract.get(cs.contractId);
      if (!owner) continue;
      contractSeasons.push({
        contractId: cs.contractId,
        playerId: owner.player.id,
        playerName: owner.player.fullName,
        position: owner.player.position,
        capHit: cs.capHit,
        baseSalary: cs.baseSalary,
        totalCash: cs.totalCash,
        performanceBonus: cs.performanceBonus,
        minorLeagueSalary: cs.minorLeagueSalary,
        isTwoWay: owner.contract.contractType === "two_way",
        retainedByOthersPct: owner.contract.retainedSalaryPercentage,
        rosterStatus: owner.player.rosterStatus as EngineRosterStatus,
      });
    }

    inputs.push({
      season: { id: season.id, name: season.name },
      team: { id: team.id, name: team.name },
      rules,
      contractSeasons,
      obligations: obligations
        .filter((o) => o.seasonId === season.id)
        .map((o) => ({
          obligationType: o.obligationType as "retained" | "buyout" | "termination" | "recapture",
          playerName: o.playerName,
          amount: o.amount,
        })),
    });
  }

  return {
    team: {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      leagueId: team.leagueId,
      organizationId: team.organizationId,
    },
    seasons: seasons.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      isCurrent: s.isCurrent,
    })),
    inputs,
  };
}

export interface TeamCapReport {
  team: TeamCapContext["team"];
  seasons: SeasonInfo[];
  results: CapResult[];
}

export async function getTeamCapReport(teamId: string): Promise<TeamCapReport> {
  const ctx = await buildTeamCapInputs(teamId);
  return {
    team: ctx.team,
    seasons: ctx.seasons,
    results: ctx.inputs.map((input) => calculateCap(input)),
  };
}
