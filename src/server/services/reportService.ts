/**
 * Shareable read-only reports.
 *
 * Generating a share link SNAPSHOTS the report content into `reports` +
 * `report_sections` at generation time. The public /share/[token] route
 * renders only the stored snapshot — never live data — so a link can be
 * handed to an agent, league office, or board member without exposing
 * anything beyond what the sharer saw, and revoking the token kills access.
 *
 * No "server-only" import (same convention as applyService/capService):
 * integration tests run this against in-memory PGlite via setDbForTesting.
 */
import { randomBytes } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getTeamCapReport } from "./capService";
import { MODEL_DISCLAIMER } from "@/lib/valuation/models";

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export interface ShareLinkResult {
  reportId: string;
  shareToken: string;
}

/**
 * Generates a frozen roster/cap report for a team + season and mints a share
 * token. Caller must already be authorized for the organization.
 */
export async function generateRosterShareReport(opts: {
  organizationId: string;
  teamId: string;
  seasonId: string;
  userId: string;
}): Promise<ShareLinkResult> {
  const db = getDb();
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, opts.teamId), eq(schema.teams.organizationId, opts.organizationId)))
    .limit(1);
  if (!team) throw new ReportError("Team not found in this organization");

  const report = await getTeamCapReport(team.id);
  const seasonIdx = report.seasons.findIndex((s) => s.id === opts.seasonId);
  const current = seasonIdx >= 0 ? report.results[seasonIdx] : undefined;
  if (!current) throw new ReportError("Season not found for this team's league");

  const shareToken = randomBytes(24).toString("base64url");
  const generatedAt = new Date();

  const reportId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.reports)
      .values({
        organizationId: opts.organizationId,
        reportType: "roster_cap",
        title: `${team.name} — ${current.season.name} roster & cap report`,
        parameters: { teamId: team.id, seasonId: opts.seasonId, teamName: team.name, seasonName: current.season.name },
        modelVersions: {
          rules: current.appliedRules.map((r) => ({ key: r.key, version: r.version, effectiveDate: r.effectiveDate })),
        },
        generatedBy: opts.userId,
        generatedAt,
        shareToken,
      })
      .returning();
    if (!row) throw new ReportError("Could not create report");

    const sections: Array<{ sectionType: string; title: string; content: unknown }> = [
      {
        sectionType: "summary",
        title: `Cap summary — ${current.season.name}`,
        content: { totals: current.totals, counts: current.counts, calculatedAt: current.calculatedAt },
      },
      {
        sectionType: "line_items",
        title: "Cap charges by line",
        content: {
          rows: current.lineItems.map((l) => ({
            label: l.label,
            category: l.category,
            amount: l.amount,
            formula: l.formula,
          })),
        },
      },
      {
        sectionType: "commitments",
        title: "Future commitments by season",
        content: {
          rows: report.results.map((r) => ({
            season: r.season.name,
            capUpperLimit: r.totals.capUpperLimit,
            totalCapCharge: r.totals.totalCapCharge,
            capSpace: r.totals.capSpace,
            contractSlots: r.counts.contractSlots,
          })),
        },
      },
      {
        sectionType: "compliance",
        title: "Compliance",
        content: {
          items: [...current.violations, ...current.warnings].map((v) => ({
            severity: v.severity,
            message: v.message,
            ruleKey: v.ruleKey,
            ruleVersion: v.ruleVersion ?? null,
          })),
        },
      },
      {
        sectionType: "disclaimer",
        title: "About this report",
        content: {
          text: `Generated ${generatedAt.toISOString()} from records stored in RosterIQ at that time. This is a frozen snapshot; it does not update. ${MODEL_DISCLAIMER}`,
        },
      },
    ];
    await tx.insert(schema.reportSections).values(
      sections.map((s, i) => ({
        reportId: row.id,
        sortOrder: i,
        sectionType: s.sectionType,
        title: s.title,
        content: s.content as Record<string, unknown>,
      })),
    );
    await tx.insert(schema.auditLogs).values({
      organizationId: opts.organizationId,
      userId: opts.userId,
      action: "report.share_create",
      entityType: "report",
      entityId: row.id,
      newValues: { reportType: "roster_cap", teamId: team.id, seasonId: opts.seasonId },
    });
    return row.id;
  });

  return { reportId, shareToken };
}

export interface SharedReportView {
  report: typeof schema.reports.$inferSelect;
  sections: Array<typeof schema.reportSections.$inferSelect>;
}

/** Resolves a share token to its frozen report, or null (revoked/unknown). */
export async function getSharedReport(token: string): Promise<SharedReportView | null> {
  if (!token || token.length > 64) return null;
  const db = getDb();
  const [report] = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.shareToken, token))
    .limit(1);
  if (!report) return null;
  const sections = await db
    .select()
    .from(schema.reportSections)
    .where(eq(schema.reportSections.reportId, report.id))
    .orderBy(asc(schema.reportSections.sortOrder));
  return { report, sections };
}

/** Revokes a share link (token cleared; snapshot kept for the org's records). */
export async function revokeShareReport(opts: {
  reportId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const db = getDb();
  const [report] = await db
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.id, opts.reportId), eq(schema.reports.organizationId, opts.organizationId)))
    .limit(1);
  if (!report) throw new ReportError("Report not found in this organization");
  await db.update(schema.reports).set({ shareToken: null }).where(eq(schema.reports.id, report.id));
  await db.insert(schema.auditLogs).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    action: "report.share_revoke",
    entityType: "report",
    entityId: report.id,
    previousValues: { hadShareToken: true },
  });
}
