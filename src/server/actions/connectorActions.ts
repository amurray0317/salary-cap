"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAccess } from "@/server/context";
import { ConnectorError, connectorRequestSchema, runConnectorImport, stageXgBundle } from "@/server/services/connectorService";

export interface ConnectorFormState {
  error?: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Builds the typed connector request from the dataset-specific form fields. */
function requestFromForm(fd: FormData): unknown {
  const dataset = str(fd, "dataset");
  switch (dataset) {
    case "nhl_players":
    case "nhl_player_seasons":
      return { dataset, playerIds: [...new Set(str(fd, "playerIds").split(/[\s,;]+/).filter(Boolean))] };
    case "nhl_game_logs":
      return {
        dataset,
        playerIds: [...new Set(str(fd, "playerIds").split(/[\s,;]+/).filter(Boolean))],
        season: str(fd, "season"),
        gameType: str(fd, "gameType"),
      };
    case "nhl_roster":
      return { dataset, team: str(fd, "team").toUpperCase(), season: str(fd, "season") };
    case "nhl_skater_stats":
    case "nhl_goalie_stats":
    case "nhl_team_stats":
      return { dataset, season: str(fd, "season"), gameType: str(fd, "gameType") };
    case "nhl_draft_picks": {
      const round = str(fd, "round");
      return { dataset, year: Number(str(fd, "year")), round: round === "all" ? "all" : Number(round) };
    }
    case "nhl_draft_rankings":
      return { dataset, year: Number(str(fd, "year")), category: Number(str(fd, "category")) };
    case "moneypuck_skaters":
    case "moneypuck_goalies":
    case "moneypuck_teams":
      return { dataset, season: str(fd, "season"), gameType: str(fd, "gameType"), situations: fd.getAll("situations").map(String) };
    case "ep_players":
      return { dataset, query: str(fd, "query") };
    case "rosteriq_xg_skaters":
    case "rosteriq_xg_goalies":
    case "rosteriq_xg_teams":
      return { dataset, season: str(fd, "season"), gameType: str(fd, "gameType") };
    case "rosteriq_prospects": {
      const y = str(fd, "draftYear");
      return { dataset, draftYear: y === "all" ? "all" : Number(y) };
    }
    case "rosteriq_nhle":
      return { dataset };
    default:
      return { dataset };
  }
}

/**
 * Fetches from a real source and stages a gated import. Requires the same
 * edit_data capability as CSV imports; nothing is committed here — the user
 * is sent to the import preview to approve or discard.
 */
export async function runConnectorAction(_prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const organizationId = str(formData, "organizationId");
  if (!z.string().uuid().safeParse(organizationId).success) return { error: "Invalid organization" };
  const parsed = connectorRequestSchema.safeParse(requestFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const ctx = await requireOrgAccess(organizationId, "edit_data");
  let importId: string;
  try {
    const res = await runConnectorImport({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      request: parsed.data,
      bypassCache: formData.get("bypassCache") === "on",
    });
    importId = res.importId;
  } catch (err) {
    if (err instanceof ConnectorError) return { error: err.message };
    throw err;
  }
  revalidatePath("/imports");
  revalidatePath("/real-data");
  redirect(`/imports/${importId}`);
}

const bundleSchema = z.object({
  organizationId: z.string().uuid(),
  season: z.string().regex(/^\d{4}-\d{2}$/),
  gameType: z.enum(["regular", "playoffs"]),
});

/** Stages skater, goalie and team xG totals for a season as one bundle; nothing is committed. */
export async function stageXgBundleAction(_prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const parsed = bundleSchema.safeParse({
    organizationId: str(formData, "organizationId"),
    season: str(formData, "season"),
    gameType: str(formData, "gameType"),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  const ctx = await requireOrgAccess(parsed.data.organizationId, "edit_data");
  let first: string;
  try {
    const res = await stageXgBundle({ organizationId: ctx.organizationId, userId: ctx.user.id, season: parsed.data.season, gameType: parsed.data.gameType });
    first = res.importIds[0]!;
  } catch (err) {
    if (err instanceof ConnectorError) return { error: err.message };
    throw err;
  }
  revalidatePath("/imports");
  redirect(`/imports/${first}`);
}
