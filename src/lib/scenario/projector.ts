/**
 * Scenario projector.
 *
 * Takes the official multi-season CapInputs plus an ordered list of validated
 * scenario transactions, and returns NEW CapInputs with the hypothetical
 * moves overlaid. Official inputs are never mutated — scenarios are always an
 * overlay until explicitly applied.
 */
import type { CapInput, EngineContractSeason, EngineObligation } from "../engine/types";
import type { ScenarioPayload } from "./payloads";

export interface SeasonInputs {
  /** Ordered by season (earliest first). Key = season name (e.g. "2025-26"). */
  seasons: CapInput[];
}

export interface ProjectionNote {
  transactionLabel: string;
  message: string;
  level: "info" | "warning";
}

export interface ProjectionResult {
  seasons: CapInput[];
  notes: ProjectionNote[];
}

function cloneInput(input: CapInput): CapInput {
  return {
    ...input,
    contractSeasons: input.contractSeasons.map((c) => ({ ...c })),
    obligations: input.obligations.map((o) => ({ ...o })),
  };
}

let hypotheticalCounter = 0;
function nextHypotheticalId(prefix: string): string {
  hypotheticalCounter += 1;
  return `hypo-${prefix}-${hypotheticalCounter}`;
}

/**
 * Applies scenario transactions in order. Each transaction affects the season
 * it names (proposed seasons) or all seasons where the target contract exists
 * (trades, assignments).
 */
export function projectScenario(
  base: SeasonInputs,
  transactions: Array<{ label: string; payload: ScenarioPayload }>,
): ProjectionResult {
  const seasons = base.seasons.map(cloneInput);
  const notes: ProjectionNote[] = [];
  const bySeasonName = new Map(seasons.map((s) => [s.season.name, s]));

  const findContractSeasons = (contractId: string): EngineContractSeason[] =>
    seasons.flatMap((s) => s.contractSeasons.filter((c) => c.contractId === contractId));

  for (const tx of transactions) {
    const p = tx.payload;
    switch (p.kind) {
      case "sign_free_agent": {
        const id = nextHypotheticalId("sign");
        for (const ps of p.seasons) {
          const season = bySeasonName.get(ps.seasonName);
          if (!season) {
            notes.push({
              transactionLabel: tx.label,
              message: `Season ${ps.seasonName} is outside the projection window; that year of the proposed contract was ignored.`,
              level: "warning",
            });
            continue;
          }
          season.contractSeasons.push({
            contractId: id,
            playerId: null,
            playerName: p.playerName,
            position: p.position,
            capHit: ps.capHit,
            baseSalary: ps.baseSalary ?? ps.capHit,
            totalCash: (ps.baseSalary ?? ps.capHit) + (ps.performanceBonus ?? 0),
            performanceBonus: ps.performanceBonus ?? 0,
            minorLeagueSalary: null,
            isTwoWay: p.isTwoWay,
            retainedByOthersPct: 0,
            rosterStatus: "pro_active",
            isHypothetical: true,
          });
        }
        break;
      }

      case "trade_in": {
        const id = nextHypotheticalId("tradein");
        for (const ps of p.seasons) {
          const season = bySeasonName.get(ps.seasonName);
          if (!season) continue;
          season.contractSeasons.push({
            contractId: id,
            playerId: null,
            playerName: p.playerName,
            position: p.position,
            capHit: ps.capHit,
            baseSalary: ps.baseSalary ?? ps.capHit,
            totalCash: ps.baseSalary ?? ps.capHit,
            performanceBonus: ps.performanceBonus ?? 0,
            minorLeagueSalary: null,
            isTwoWay: false,
            retainedByOthersPct: p.retainedByOthersPct,
            rosterStatus: "pro_active",
            isHypothetical: true,
          });
        }
        break;
      }

      case "trade_out": {
        const matches = findContractSeasons(p.contractId);
        if (matches.length === 0) {
          notes.push({
            transactionLabel: tx.label,
            message: "The traded contract was not found in the projection window; the trade had no cap effect.",
            level: "warning",
          });
          break;
        }
        const playerName = matches[0]?.playerName ?? "Traded player";
        for (const season of seasons) {
          const idx = season.contractSeasons.findIndex((c) => c.contractId === p.contractId);
          if (idx === -1) continue;
          const departing = season.contractSeasons[idx];
          if (!departing) continue;
          season.contractSeasons.splice(idx, 1);
          if (p.retainedPct > 0) {
            const retained: EngineObligation = {
              obligationType: "retained",
              playerName,
              amount: Math.round(departing.capHit * p.retainedPct),
              isHypothetical: true,
            };
            season.obligations.push(retained);
          }
        }
        break;
      }

      case "call_up":
      case "send_down": {
        const target = p.kind === "call_up" ? "pro_active" : "minor";
        const matches = findContractSeasons(p.contractId);
        if (matches.length === 0) {
          notes.push({
            transactionLabel: tx.label,
            message: "Assignment target contract not found in the projection window.",
            level: "warning",
          });
          break;
        }
        // Assignment affects the first (current) season only; future seasons
        // keep their official status assumption.
        const first = seasons.find((s) =>
          s.contractSeasons.some((c) => c.contractId === p.contractId),
        );
        const cs = first?.contractSeasons.find((c) => c.contractId === p.contractId);
        if (cs) {
          cs.rosterStatus = target;
          cs.isHypothetical = true;
        }
        break;
      }

      case "ir_placement": {
        const first = seasons.find((s) =>
          s.contractSeasons.some((c) => c.contractId === p.contractId),
        );
        const cs = first?.contractSeasons.find((c) => c.contractId === p.contractId);
        if (!cs) {
          notes.push({
            transactionLabel: tx.label,
            message: "IR target contract not found in the projection window.",
            level: "warning",
          });
          break;
        }
        cs.rosterStatus = p.longTerm ? "ltir" : "injured_reserve";
        cs.isHypothetical = true;
        break;
      }

      case "extension": {
        const existing = findContractSeasons(p.contractId);
        const template = existing[0];
        if (!template) {
          notes.push({
            transactionLabel: tx.label,
            message: "Extension target contract not found; extension ignored.",
            level: "warning",
          });
          break;
        }
        for (const ps of p.seasons) {
          const season = bySeasonName.get(ps.seasonName);
          if (!season) {
            notes.push({
              transactionLabel: tx.label,
              message: `Extension season ${ps.seasonName} is outside the projection window.`,
              level: "info",
            });
            continue;
          }
          const already = season.contractSeasons.find((c) => c.contractId === p.contractId);
          if (already) {
            notes.push({
              transactionLabel: tx.label,
              message: `${template.playerName} already has a contract season in ${ps.seasonName}; extension year skipped.`,
              level: "warning",
            });
            continue;
          }
          season.contractSeasons.push({
            ...template,
            capHit: ps.capHit,
            baseSalary: ps.baseSalary ?? ps.capHit,
            totalCash: ps.baseSalary ?? ps.capHit,
            performanceBonus: ps.performanceBonus ?? 0,
            rosterStatus: "pro_active",
            isHypothetical: true,
          });
        }
        break;
      }

      case "buyout": {
        const playerSeasons = findContractSeasons(p.contractId);
        if (playerSeasons.length === 0) {
          notes.push({
            transactionLabel: tx.label,
            message: "Buyout target contract not found; buyout ignored.",
            level: "warning",
          });
          break;
        }
        const playerName = playerSeasons[0]?.playerName ?? "Bought-out player";
        for (const season of seasons) {
          const idx = season.contractSeasons.findIndex((c) => c.contractId === p.contractId);
          if (idx === -1) continue;
          const bought = season.contractSeasons[idx];
          if (!bought) continue;
          season.contractSeasons.splice(idx, 1);
          season.obligations.push({
            obligationType: "buyout",
            playerName,
            amount: Math.round(bought.capHit * p.deadCapFraction),
            isHypothetical: true,
          });
        }
        notes.push({
          transactionLabel: tx.label,
          message:
            "Simplified buyout model: dead cap = remaining cap hit × fraction in each remaining season (no spread years).",
          level: "info",
        });
        break;
      }
    }
  }

  return { seasons, notes };
}
