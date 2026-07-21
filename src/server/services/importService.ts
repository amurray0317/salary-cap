/**
 * CSV import pipeline: upload → field mapping → row-level validation →
 * preview → explicit approval → committed records.
 *
 * State machine on imports.status:
 *   pending            uploaded, awaiting field mapping
 *   awaiting_approval  validated; errors stored in import_errors; nothing committed
 *   committed          valid rows written inside one DB transaction
 *   rejected           discarded by the user; nothing committed
 *
 * Invalid rows are NEVER committed. Approval commits only the rows that
 * validated cleanly, and the approval screen states this explicitly.
 *
 * No "server-only" import (same convention as applyService/reportService):
 * integration tests run this against in-memory PGlite via setDbForTesting.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { parseCsv, CsvParseError } from "@/lib/import/csvParse";
import {
  IMPORT_DEFINITIONS,
  autoMapHeaders,
  parseMoney,
  type ImportType,
} from "@/lib/import/definitions";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

const MAX_ROWS = 2000;
const MAX_BYTES = 1_000_000;

interface RawData {
  headers: string[];
  rows: string[][];
}

export interface RowIssue {
  rowNumber: number; // 1-based data row (header excluded)
  columnName: string | null;
  message: string;
  rawRow: Record<string, string>;
}

export interface ValidationOutcome {
  issues: RowIssue[];
  /** Row numbers (1-based) that are safe to commit. */
  validRowNumbers: number[];
  /** Mapped field values per valid row, keyed by field key. */
  validRecords: Array<{ rowNumber: number; values: Record<string, string> }>;
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export async function createImport(opts: {
  organizationId: string;
  userId: string;
  importType: ImportType;
  fileName: string;
  csvText: string;
}): Promise<{ importId: string; headers: string[]; autoMapping: Record<string, string> }> {
  if (Buffer.byteLength(opts.csvText, "utf8") > MAX_BYTES) {
    throw new ImportError("File is larger than 1 MB");
  }
  let parsed: RawData;
  try {
    const { headers, rows } = parseCsv(opts.csvText, { maxRows: MAX_ROWS });
    parsed = { headers, rows };
  } catch (err) {
    if (err instanceof CsvParseError) throw new ImportError(err.message);
    throw err;
  }
  if (parsed.rows.length === 0) throw new ImportError("File has a header but no data rows");

  const db = getDb();
  const [row] = await db
    .insert(schema.imports)
    .values({
      organizationId: opts.organizationId,
      importType: opts.importType,
      fileName: opts.fileName || "upload.csv",
      status: "pending",
      rowCount: parsed.rows.length,
      rawData: parsed,
      createdBy: opts.userId,
    })
    .returning();
  if (!row) throw new ImportError("Could not create import record");
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "import.create",
    entityType: "import",
    entityId: row.id,
    newValues: { importType: opts.importType, fileName: opts.fileName, rows: parsed.rows.length },
  });
  return {
    importId: row.id,
    headers: parsed.headers,
    autoMapping: autoMapHeaders(opts.importType, parsed.headers),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

async function loadOrgLookups(db: ReturnType<typeof getDb>, organizationId: string) {
  const teams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.organizationId, organizationId));
  const players = await db
    .select({ id: schema.players.id, fullName: schema.players.fullName, currentTeamId: schema.players.currentTeamId })
    .from(schema.players)
    .where(eq(schema.players.organizationId, organizationId));
  const playerIds = players.map((p) => p.id);
  const activeContracts =
    playerIds.length > 0
      ? await db
          .select({ playerId: schema.contracts.playerId })
          .from(schema.contracts)
          .where(and(inArray(schema.contracts.playerId, playerIds), eq(schema.contracts.contractStatus, "active")))
      : [];
  const leagueIds = [...new Set(teams.map((t) => t.leagueId))];
  const seasons =
    leagueIds.length > 0
      ? await db
          .select()
          .from(schema.leagueSeasons)
          .where(inArray(schema.leagueSeasons.leagueId, leagueIds))
          .orderBy(asc(schema.leagueSeasons.sortOrder))
      : [];
  return {
    teamsByAbbr: new Map(teams.map((t) => [t.abbreviation.toUpperCase(), t])),
    playersByName: (() => {
      const m = new Map<string, Array<(typeof players)[number]>>();
      for (const p of players) {
        const list = m.get(p.fullName) ?? [];
        list.push(p);
        m.set(p.fullName, list);
      }
      return m;
    })(),
    activePlayerIds: new Set(activeContracts.map((c) => c.playerId)),
    seasonsByLeague: (() => {
      const m = new Map<string, Map<string, (typeof seasons)[number]>>();
      for (const s of seasons) {
        const inner = m.get(s.leagueId) ?? new Map();
        inner.set(s.name, s);
        m.set(s.leagueId, inner);
      }
      return m;
    })(),
  };
}

type OrgLookups = Awaited<ReturnType<typeof loadOrgLookups>>;

/** Pure(ish) validation over parsed rows + mapping + org lookups. */
export function validateRows(
  importType: ImportType,
  raw: RawData,
  mapping: Record<string, string>,
  lookups: OrgLookups,
): ValidationOutcome {
  const def = IMPORT_DEFINITIONS[importType];
  const headerIndex = new Map(raw.headers.map((h, i) => [h, i]));
  const issues: RowIssue[] = [];
  const validRecords: ValidationOutcome["validRecords"] = [];

  // Mapping completeness: every required field must be mapped to a real header.
  for (const field of def.fields) {
    if (field.required && !(mapping[field.key] !== undefined && headerIndex.has(mapping[field.key]!))) {
      throw new ImportError(`Required field "${field.label}" is not mapped to a CSV column`);
    }
  }

  const rowsWithIssues = new Set<number>();
  const extract = (row: string[], key: string): string => {
    const header = mapping[key];
    if (header === undefined) return "";
    const idx = headerIndex.get(header);
    return idx === undefined ? "" : (row[idx] ?? "");
  };

  const seenPlayerNames = new Map<string, number>(); // players import: duplicate guard

  raw.rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const values: Record<string, string> = {};
    const rawRow: Record<string, string> = {};
    raw.headers.forEach((h, hi) => (rawRow[h] = row[hi] ?? ""));

    for (const field of def.fields) {
      const value = extract(row, field.key);
      values[field.key] = value;
      if (field.required && value === "") {
        issues.push({ rowNumber, columnName: field.key, message: `${field.label} is required`, rawRow });
        rowsWithIssues.add(rowNumber);
        continue;
      }
      const err = field.validate(value);
      if (err) {
        issues.push({ rowNumber, columnName: field.key, message: `${field.label} ${err}`, rawRow });
        rowsWithIssues.add(rowNumber);
      }
    }

    // Referential checks against org data.
    const teamAbbr = values["team_abbreviation"] ?? "";
    const team = teamAbbr === "" ? null : lookups.teamsByAbbr.get(teamAbbr.toUpperCase());
    if (teamAbbr !== "" && !team) {
      issues.push({ rowNumber, columnName: "team_abbreviation", message: `No team "${teamAbbr}" in your organization`, rawRow });
      rowsWithIssues.add(rowNumber);
    }

    if (importType === "players") {
      const name = values["full_name"] ?? "";
      if (name !== "") {
        const firstSeen = seenPlayerNames.get(name);
        if (firstSeen !== undefined) {
          issues.push({ rowNumber, columnName: "full_name", message: `Duplicate of row ${firstSeen} in this file`, rawRow });
          rowsWithIssues.add(rowNumber);
        } else {
          seenPlayerNames.set(name, rowNumber);
          if (lookups.playersByName.has(name)) {
            issues.push({ rowNumber, columnName: "full_name", message: "A player with this exact name already exists in your organization", rawRow });
            rowsWithIssues.add(rowNumber);
          }
        }
      }
    }

    if (importType === "contracts") {
      const playerName = values["player_name"] ?? "";
      if (playerName !== "") {
        const matches = lookups.playersByName.get(playerName) ?? [];
        if (matches.length === 0) {
          issues.push({ rowNumber, columnName: "player_name", message: "No player with this exact name in your organization (import players first)", rawRow });
          rowsWithIssues.add(rowNumber);
        } else if (matches.length > 1) {
          issues.push({ rowNumber, columnName: "player_name", message: "Multiple players share this name; resolve manually", rawRow });
          rowsWithIssues.add(rowNumber);
        } else if (lookups.activePlayerIds.has(matches[0]!.id)) {
          issues.push({ rowNumber, columnName: "player_name", message: "Player already has an active contract", rawRow });
          rowsWithIssues.add(rowNumber);
        }
      }
      if (team) {
        const seasonName = values["season_name"] ?? "";
        const leagueSeasons = lookups.seasonsByLeague.get(team.leagueId);
        if (seasonName !== "" && !leagueSeasons?.has(seasonName)) {
          issues.push({ rowNumber, columnName: "season_name", message: `Season "${seasonName}" does not exist in ${team.name}'s league`, rawRow });
          rowsWithIssues.add(rowNumber);
        }
      }
    }

    if (!rowsWithIssues.has(rowNumber)) {
      validRecords.push({ rowNumber, values });
    }
  });

  // Contracts: group consistency — a group with any bad row is wholly skipped,
  // and duplicate seasons within a group are errors.
  if (importType === "contracts") {
    const byPlayer = new Map<string, Array<{ rowNumber: number; values: Record<string, string> }>>();
    for (const rec of validRecords) {
      const name = rec.values["player_name"]!;
      const list = byPlayer.get(name) ?? [];
      list.push(rec);
      byPlayer.set(name, list);
    }
    const badPlayers = new Set<string>();
    // Any row of this player invalid → whole group skipped.
    for (const issue of issues) {
      const name = issue.rawRow[mapping["player_name"] ?? "player_name"];
      if (name) badPlayers.add(name);
    }
    for (const [name, recs] of byPlayer) {
      const seasonSeen = new Map<string, number>();
      const teamSeen = new Set<string>();
      for (const rec of recs) {
        const season = rec.values["season_name"]!;
        const dup = seasonSeen.get(season);
        if (dup !== undefined) {
          issues.push({
            rowNumber: rec.rowNumber,
            columnName: "season_name",
            message: `Duplicate season ${season} for ${name} (first at row ${dup})`,
            rawRow: rec.values,
          });
          badPlayers.add(name);
        } else {
          seasonSeen.set(season, rec.rowNumber);
        }
        teamSeen.add((rec.values["team_abbreviation"] ?? "").toUpperCase());
      }
      if (teamSeen.size > 1) {
        const first = recs[0]!;
        issues.push({
          rowNumber: first.rowNumber,
          columnName: "team_abbreviation",
          message: `All seasons for ${name} must be on the same team`,
          rawRow: first.values,
        });
        badPlayers.add(name);
      }
    }
    if (badPlayers.size > 0) {
      for (const [name, recs] of byPlayer) {
        if (!badPlayers.has(name)) continue;
        for (const rec of recs) {
          if (!issues.some((x) => x.rowNumber === rec.rowNumber)) {
            issues.push({
              rowNumber: rec.rowNumber,
              columnName: null,
              message: `Skipped: another row in ${name}'s contract group has an error`,
              rawRow: rec.values,
            });
          }
        }
      }
      const stillValid = validRecords.filter((rec) => !badPlayers.has(rec.values["player_name"]!));
      validRecords.length = 0;
      validRecords.push(...stillValid);
    }
  }

  return {
    issues,
    validRowNumbers: validRecords.map((r) => r.rowNumber),
    validRecords,
  };
}

async function getOwnedImport(importId: string, organizationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.imports)
    .where(and(eq(schema.imports.id, importId), eq(schema.imports.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ImportError("Import not found in this organization");
  return row;
}

/**
 * Applies a field mapping, validates every row, persists row-level errors to
 * import_errors, and moves the import to awaiting_approval. Re-runnable while
 * not yet committed/rejected (re-mapping replaces prior errors).
 */
export async function validateImport(opts: {
  importId: string;
  organizationId: string;
  userId: string;
  mapping: Record<string, string>;
}): Promise<{ validCount: number; errorCount: number }> {
  const db = getDb();
  const row = await getOwnedImport(opts.importId, opts.organizationId);
  if (row.status === "committed" || row.status === "rejected") {
    throw new ImportError(`Import is already ${row.status}`);
  }
  const raw = row.rawData as RawData;
  const lookups = await loadOrgLookups(db, opts.organizationId);
  const outcome = validateRows(row.importType as ImportType, raw, opts.mapping, lookups);

  await db.transaction(async (tx) => {
    await tx.delete(schema.importErrors).where(eq(schema.importErrors.importId, row.id));
    if (outcome.issues.length > 0) {
      await tx.insert(schema.importErrors).values(
        outcome.issues.map((i) => ({
          importId: row.id,
          rowNumber: i.rowNumber,
          columnName: i.columnName,
          message: i.message,
          rawRow: i.rawRow,
        })),
      );
    }
    await tx
      .update(schema.imports)
      .set({ mapping: opts.mapping, status: "awaiting_approval" })
      .where(eq(schema.imports.id, row.id));
  });
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "import.validate",
    entityType: "import",
    entityId: row.id,
    newValues: { valid: outcome.validRecords.length, errors: outcome.issues.length },
  });
  return { validCount: outcome.validRecords.length, errorCount: outcome.issues.length };
}

/* ------------------------------------------------------------------ */
/* Commit / reject                                                     */
/* ------------------------------------------------------------------ */

/**
 * Explicit approval: commits ONLY the rows that validate cleanly, inside one
 * DB transaction. Validation re-runs server-side from stored data — the page
 * state is never trusted.
 */
export async function commitImport(opts: {
  importId: string;
  organizationId: string;
  userId: string;
}): Promise<{ committedCount: number; skippedCount: number }> {
  const db = getDb();
  const row = await getOwnedImport(opts.importId, opts.organizationId);
  if (row.status !== "awaiting_approval") {
    throw new ImportError(`Import must be awaiting approval to commit (current status: ${row.status})`);
  }
  const raw = row.rawData as RawData;
  const mapping = row.mapping as Record<string, string>;
  const lookups = await loadOrgLookups(db, opts.organizationId);
  const outcome = validateRows(row.importType as ImportType, raw, mapping, lookups);

  const committedCount = await db.transaction(async (tx) => {
    let committed = 0;

    if (row.importType === "players") {
      for (const rec of outcome.validRecords) {
        const v = rec.values;
        const team = v.team_abbreviation ? lookups.teamsByAbbr.get(v.team_abbreviation.toUpperCase()) : null;
        await tx.insert(schema.players).values({
          organizationId: opts.organizationId,
          fullName: v.full_name!,
          position: v.position!,
          dateOfBirth: v.date_of_birth || null,
          shootsCatches: v.shoots_catches || null,
          nationality: v.nationality || null,
          currentTeamId: team?.id ?? null,
          rosterStatus: (v.roster_status || (team ? "pro_active" : "non_roster")) as (typeof schema.rosterStatus.enumValues)[number],
          freeAgentStatus: (v.free_agent_status || (team ? "under_contract" : "ufa")) as (typeof schema.freeAgentStatus.enumValues)[number],
          provenance: "user_entered",
          notes: `Imported from ${row.fileName}`,
        });
        committed += 1;
      }
    } else if (row.importType === "contracts") {
      const byPlayer = new Map<string, typeof outcome.validRecords>();
      for (const rec of outcome.validRecords) {
        const list = byPlayer.get(rec.values.player_name!) ?? [];
        list.push(rec);
        byPlayer.set(rec.values.player_name!, list);
      }
      for (const [playerName, recs] of byPlayer) {
        const player = lookups.playersByName.get(playerName)![0]!;
        const team = lookups.teamsByAbbr.get(recs[0]!.values.team_abbreviation!.toUpperCase())!;
        const leagueSeasons = lookups.seasonsByLeague.get(team.leagueId)!;
        const seasonRows = recs
          .map((rec) => ({
            season: leagueSeasons.get(rec.values.season_name!)!,
            capHit: parseMoney(rec.values.cap_hit!),
            baseSalary: rec.values.base_salary ? parseMoney(rec.values.base_salary) : parseMoney(rec.values.cap_hit!),
            performanceBonus: rec.values.performance_bonus ? parseMoney(rec.values.performance_bonus) : 0,
          }))
          .sort((a, b) => a.season.sortOrder - b.season.sortOrder);
        const first = seasonRows[0]!;
        const last = seasonRows[seasonRows.length - 1]!;
        const totalCapHit = seasonRows.reduce((s, r) => s + r.capHit, 0);
        const totalCash = seasonRows.reduce((s, r) => s + r.baseSalary + r.performanceBonus, 0);
        const contractType = (recs[0]!.values.contract_type || "one_way") as (typeof schema.contractType.enumValues)[number];

        const [contract] = await tx
          .insert(schema.contracts)
          .values({
            organizationId: opts.organizationId,
            playerId: player.id,
            teamId: team.id,
            leagueId: team.leagueId,
            contractType,
            contractStatus: "active",
            startDate: first.season.startDate,
            endDate: last.season.endDate,
            totalValue: totalCash,
            averageAnnualValue: Math.round(totalCapHit / seasonRows.length),
            guaranteedValue: totalCash,
            provenance: "user_entered",
            createdBy: opts.userId,
          })
          .returning();
        if (!contract) throw new ImportError("Contract insert failed");
        await tx.insert(schema.contractSeasons).values(
          seasonRows.map((r) => ({
            contractId: contract.id,
            seasonId: r.season.id,
            baseSalary: r.baseSalary,
            performanceBonus: r.performanceBonus,
            totalCash: r.baseSalary + r.performanceBonus,
            capHit: r.capHit,
          })),
        );
        await tx
          .update(schema.players)
          .set({
            currentTeamId: team.id,
            freeAgentStatus: "under_contract",
            rosterStatus: player.currentTeamId ? undefined : "pro_active",
            updatedAt: new Date(),
          })
          .where(eq(schema.players.id, player.id));
        committed += recs.length;
      }
    }

    await tx
      .update(schema.imports)
      .set({ status: "committed", committedCount: committed })
      .where(eq(schema.imports.id, row.id));
    return committed;
  });

  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "import.commit",
    entityType: "import",
    entityId: row.id,
    newValues: { committedCount, skipped: raw.rows.length - outcome.validRecords.length },
  });
  return { committedCount, skippedCount: raw.rows.length - outcome.validRecords.length };
}

export async function rejectImport(opts: {
  importId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const db = getDb();
  const row = await getOwnedImport(opts.importId, opts.organizationId);
  if (row.status === "committed") throw new ImportError("Committed imports cannot be rejected");
  await db.update(schema.imports).set({ status: "rejected" }).where(eq(schema.imports.id, row.id));
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "import.reject",
    entityType: "import",
    entityId: row.id,
  });
}

/** Everything the import detail page needs, recomputing the live preview. */
export async function getImportDetail(importId: string, organizationId: string) {
  const db = getDb();
  const row = await getOwnedImport(importId, organizationId);
  const raw = row.rawData as RawData;
  const errors = await db
    .select()
    .from(schema.importErrors)
    .where(eq(schema.importErrors.importId, row.id))
    .orderBy(asc(schema.importErrors.rowNumber));
  let preview: ValidationOutcome | null = null;
  if (row.status === "awaiting_approval") {
    const lookups = await loadOrgLookups(db, organizationId);
    preview = validateRows(row.importType as ImportType, raw, row.mapping as Record<string, string>, lookups);
  }
  return { row, raw, errors, preview };
}
