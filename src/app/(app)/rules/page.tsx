import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { updateRuleAction } from "@/server/actions/ruleActions";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "League rules" };

export default async function RulesPage() {
  const ctx = await resolveAppContext();
  const db = getDb();

  if (!ctx.team || !ctx.season) {
    return <EmptyState title="No league context" body="Create a team first; its league's rules appear here." />;
  }

  const rules = await db
    .select()
    .from(schema.leagueRules)
    .where(
      and(
        eq(schema.leagueRules.leagueId, ctx.team.leagueId),
        eq(schema.leagueRules.seasonId, ctx.season.id),
        eq(schema.leagueRules.isActive, true),
      ),
    )
    .orderBy(asc(schema.leagueRules.ruleCategory), asc(schema.leagueRules.ruleKey));

  const history = await db
    .select()
    .from(schema.leagueRules)
    .where(
      and(
        eq(schema.leagueRules.leagueId, ctx.team.leagueId),
        eq(schema.leagueRules.seasonId, ctx.season.id),
        eq(schema.leagueRules.isActive, false),
      ),
    )
    .orderBy(desc(schema.leagueRules.ruleVersion));

  const canEdit = ["org_admin", "league_admin"].includes(ctx.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">League rules — {ctx.season.name}</h1>
        <p className="text-sm text-ink-muted">
          Versioned regulatory parameters consumed by the cap engine. Edits create a new version;
          superseded versions are kept for audit.
        </p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Category</Th>
                <Th>Rule</Th>
                <Th>Key</Th>
                <Th right>Value</Th>
                <Th right>Version</Th>
                <Th>Effective</Th>
                {canEdit && <Th>Update</Th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-muted">{r.ruleCategory}</Td>
                  <Td>{r.ruleName}</Td>
                  <Td className="font-mono text-xs text-ink-muted">{r.ruleKey}</Td>
                  <Td right>
                    {r.numericValue !== null
                      ? r.ruleKey.includes("pct") || r.ruleCategory === "roster" || r.ruleKey.includes("slots") || r.ruleKey.includes("games")
                        ? r.numericValue
                        : money(r.numericValue)
                      : r.textValue ?? "—"}
                  </Td>
                  <Td right>v{r.ruleVersion}</Td>
                  <Td className="text-ink-secondary">{r.effectiveDate}</Td>
                  {canEdit && (
                    <Td>
                      <form action={updateRuleAction} className="flex items-center gap-1">
                        <input type="hidden" name="organizationId" value={ctx.org.id} />
                        <input type="hidden" name="ruleId" value={r.id} />
                        <label className="sr-only" htmlFor={`rule-${r.id}`}>New value for {r.ruleName}</label>
                        <input
                          id={`rule-${r.id}`}
                          name="numericValue"
                          type="number"
                          step="any"
                          placeholder="New value"
                          className="w-32 rounded-md border border-line bg-navy-950 px-2 py-1 text-xs"
                        />
                        <button className="rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:text-ink">
                          Save v{r.ruleVersion + 1}
                        </button>
                      </form>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {history.length > 0 && (
        <Card title="Superseded versions (audit)">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Rule</Th>
                <Th right>Value</Th>
                <Th right>Version</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-line/50 last:border-0 text-ink-muted">
                  <Td>{r.ruleName}</Td>
                  <Td right>{r.numericValue !== null ? money(r.numericValue) : r.textValue ?? "—"}</Td>
                  <Td right>v{r.ruleVersion}</Td>
                  <Td className="text-xs">{r.notes ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
