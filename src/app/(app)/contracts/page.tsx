import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { resolveAppContext } from "@/server/appContext";
import { Card, EmptyState, Td, Th } from "@/components/ui";
import { formatDate, money, statusLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const ctx = await resolveAppContext();
  const db = getDb();

  const rows = await db
    .select({
      contract: schema.contracts,
      playerName: schema.players.fullName,
      position: schema.players.position,
      teamAbbr: schema.teams.abbreviation,
    })
    .from(schema.contracts)
    .innerJoin(schema.players, eq(schema.contracts.playerId, schema.players.id))
    .innerJoin(schema.teams, eq(schema.contracts.teamId, schema.teams.id))
    .where(eq(schema.contracts.organizationId, ctx.org.id))
    .orderBy(desc(schema.contracts.averageAnnualValue))
    .limit(300);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Contracts</h1>
        <Link href="/contracts/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Add contract
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No contracts"
          body="Add a player contract with its per-season salary schedule."
          cta={{ href: "/contracts/new", label: "Add contract" }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Player</Th>
                  <Th>Team</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th right>AAV</Th>
                  <Th right>Total</Th>
                  <Th>Term</Th>
                  <Th>Clauses</Th>
                  <Th>Verified</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ contract, playerName, position, teamAbbr }) => (
                  <tr key={contract.id} className="border-b border-line/50 last:border-0 hover:bg-navy-850">
                    <Td>
                      <Link href={`/players/${contract.playerId}`} className="font-medium hover:text-accent-text">
                        {playerName}
                      </Link>{" "}
                      <span className="text-xs text-ink-muted">{position}</span>
                    </Td>
                    <Td className="text-ink-secondary">{teamAbbr}</Td>
                    <Td className="text-ink-secondary">{contract.contractType.replace(/_/g, " ")}</Td>
                    <Td className="text-ink-secondary">{statusLabel(contract.contractStatus)}</Td>
                    <Td right>{money(contract.averageAnnualValue)}</Td>
                    <Td right>{money(contract.totalValue)}</Td>
                    <Td className="text-ink-secondary">
                      {formatDate(contract.startDate)} – {formatDate(contract.endDate)}
                    </Td>
                    <Td className="text-ink-secondary">
                      {[contract.noMovementClause && "NMC", contract.noTradeClause && "NTC"].filter(Boolean).join(", ") || "—"}
                    </Td>
                    <Td className="text-ink-secondary">{contract.verificationStatus}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
