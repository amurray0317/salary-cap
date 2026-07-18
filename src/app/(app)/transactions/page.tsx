import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();
  const rows = await db
    .select({
      tx: schema.transactions,
      teamName: schema.teams.name,
    })
    .from(schema.transactions)
    .leftJoin(schema.teams, eq(schema.transactions.teamId, schema.teams.id))
    .where(eq(schema.transactions.organizationId, ctx.org.id))
    .orderBy(desc(schema.transactions.transactionDate))
    .limit(200);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Transactions</h1>
        <p className="text-sm text-ink-muted">
          Official transaction log for {ctx.org.name}. Hypothetical moves live inside scenarios.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No transactions" body="Official roster moves and audited changes appear here." />
      ) : (
        <Card>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Team</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tx, teamName }) => (
                <tr key={tx.id} className="border-b border-line/50 last:border-0">
                  <Td className="text-ink-secondary">{formatDate(tx.transactionDate)}</Td>
                  <Td>{tx.transactionType.replace(/_/g, " ")}</Td>
                  <Td className="text-ink-secondary">{teamName ?? "—"}</Td>
                  <Td className="text-ink-secondary">{tx.description ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
