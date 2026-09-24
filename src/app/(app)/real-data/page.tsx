import Link from "next/link";
import type { Metadata } from "next";
import { resolveAppContext } from "@/server/appContext";
import { roleHasCapability } from "@/lib/auth/roles";
import { runConnectorAction, stageXgBundleAction } from "@/server/actions/connectorActions";
import { connectorStatus } from "@/server/services/connectorService";
import { listDataSources, referenceSummary } from "@/server/services/referenceDataService";
import { ConnectorForm, type ConnectorField } from "@/components/ConnectorForms";
import { Card, StatTile, Td, Th } from "@/components/ui";
import { RANKING_CATEGORIES } from "@/lib/connectors/nhl";
import { MONEYPUCK_SITUATIONS } from "@/lib/connectors/moneypuck";
import { formatDate } from "@/lib/format";
import { PROSPECT_MODEL_VERSION, XG_MODEL_VERSION, readModelCard } from "@/lib/connectors/rosteriqModels";

export const metadata: Metadata = { title: "Real data connectors" };

function seasonOptions(now: Date, count = 12): Array<{ value: string; label: string }> {
  // A season "YYYY-YY" starts in October; before October the latest one is last year's.
  const latestStart = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = latestStart - i;
    const label = `${start}-${String(start + 1).slice(2)}`;
    return { value: label, label };
  });
}

function yearOptions(latest: number, earliest: number) {
  return Array.from({ length: latest - earliest + 1 }, (_, i) => {
    const y = String(latest - i);
    return { value: y, label: y };
  });
}

export default async function RealDataPage() {
  const ctx = await resolveAppContext();
  const canImport = roleHasCapability(ctx.role, "edit_data");
  const status = connectorStatus();
  const [summary, sources] = await Promise.all([referenceSummary(ctx.org.id), listDataSources(ctx.org.id, 25)]);

  const now = new Date();
  const seasons = seasonOptions(now);
  const latestDraft = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const gameType: ConnectorField = {
    name: "gameType",
    label: "Game type",
    type: "select",
    options: [
      { value: "regular", label: "Regular season" },
      { value: "playoffs", label: "Playoffs" },
    ],
  };
  const season: ConnectorField = { name: "season", label: "Season", type: "select", options: seasons };
  const situations: ConnectorField = {
    name: "situations",
    label: "Situations (one row per player per situation)",
    type: "checkboxes",
    options: MONEYPUCK_SITUATIONS.map((s) => ({ value: s, label: s })),
    defaultValues: ["all"],
  };
  const common = { action: runConnectorAction, organizationId: ctx.org.id, disabled: !canImport };

  // Model imports offer exactly the seasons / drafts the model card covers.
  const xgCard = readModelCard(XG_MODEL_VERSION);
  const prospectCard = readModelCard(PROSPECT_MODEL_VERSION);
  const inSeason = (xgCard?.in_season as Record<string, { through?: string; games?: number }> | undefined) ?? {};
  const xgSeasons = ((xgCard?.scored_seasons as number[] | undefined) ?? (xgCard?.seasons as number[] | undefined) ?? [])
    .slice()
    .sort((a, b) => b - a)
    .map((id) => {
      const start = Math.floor(id / 10000);
      const label = `${start}-${String(start + 1).slice(2)}`;
      return { value: label, label };
    });
  const draftYears = ((prospectCard?.drafts as { all?: number[] } | undefined)?.all ?? []).slice().sort((a, b) => b - a);
  const files = status.rosteriq_models.files;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Real data connectors</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          Pull real NHL, NHL Central Scouting, MoneyPuck, and EliteProspects data on demand. Every fetch is
          rate-limited and cached per organization, then staged as a gated import: you review a preview
          with its source, URL, retrieval time, and effective season, and nothing is written until you
          approve it. The fictional demo data is unaffected.
        </p>
        {!canImport && (
          <p className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            Your role ({ctx.role.replace(/_/g, " ")}) can browse imported data but cannot run connectors.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Players" value={String(summary.players)} detail="bios" />
        <StatTile label="Season lines" value={String(summary.seasons)} detail="NHL + MoneyPuck" />
        <StatTile label="Team seasons" value={String(summary.teams)} />
        <StatTile label="Draft picks" value={String(summary.picks)} />
        <StatTile label="CSS rankings" value={String(summary.rankings)} />
      </div>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">NHL API <span className="text-xs font-normal text-ink-muted">api-web.nhle.com · api.nhle.com</span></h2>
        <p className="text-xs text-ink-muted">{status.nhl_api.credit}. {status.nhl_api.terms}</p>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Players — bios or career seasons">
            <ConnectorForm
              {...common}
              dataset="nhl_players"
              submitLabel="Fetch bios → preview"
              fields={[{ name: "playerIds", label: "NHL player ids (up to 25)", type: "textarea", placeholder: "8478402, 8484144", hint: "The 7-digit id in nhl.com player URLs." }]}
            />
            <div className="my-4 border-t border-line" />
            <ConnectorForm
              {...common}
              dataset="nhl_player_seasons"
              submitLabel="Fetch career seasons → preview"
              fields={[{ name: "playerIds", label: "NHL player ids (up to 25)", type: "textarea", placeholder: "8478402", hint: "Every league and team stint in the player's career; TOI only where the NHL reports it." }]}
            />
          </Card>
          <Card title="Player game logs">
            <ConnectorForm
              {...common}
              dataset="nhl_game_logs"
              submitLabel="Fetch game logs → preview"
              fields={[
                { name: "playerIds", label: "NHL player ids (up to 10)", type: "textarea", placeholder: "8478402", hint: "One row per game, with per-game TOI as the NHL reports it." },
                season,
                gameType,
              ]}
            />
          </Card>
          <Card title="Team roster">
            <ConnectorForm
              {...common}
              dataset="nhl_roster"
              submitLabel="Fetch roster → preview"
              fields={[
                { name: "team", label: "Team tri-code", type: "text", placeholder: "CHI" },
                season,
              ]}
            />
          </Card>
          <Card title="League season stats">
            <ConnectorForm
              {...common}
              dataset="nhl_skater_stats"
              submitLabel="Fetch skater summary → preview"
              fields={[season, gameType]}
            />
            <div className="my-4 border-t border-line" />
            <ConnectorForm {...common} dataset="nhl_goalie_stats" submitLabel="Fetch goalie summary → preview" fields={[season, gameType]} />
            <div className="my-4 border-t border-line" />
            <ConnectorForm {...common} dataset="nhl_team_stats" submitLabel="Fetch team summary → preview" fields={[season, gameType]} />
            <div className="my-4 border-t border-line" />
            <ConnectorForm
              {...common}
              dataset="nhl_standings"
              submitLabel="Fetch standings → preview"
              fields={[{ name: "date", label: "As of", type: "text", defaultValue: "now", placeholder: "now or YYYY-MM-DD", hint: "Each import replaces the previous standings for that season." }]}
            />
          </Card>
          <Card title="Draft history & NHL Central Scouting rankings">
            <ConnectorForm
              {...common}
              dataset="nhl_draft_rankings"
              submitLabel="Fetch Central Scouting rankings → preview"
              fields={[
                { name: "year", label: "Draft year", type: "select", options: yearOptions(latestDraft, 2008) },
                { name: "category", label: "Category", type: "select", options: RANKING_CATEGORIES.map((c) => ({ value: String(c.id), label: c.label })) },
              ]}
            />
            <div className="my-4 border-t border-line" />
            <ConnectorForm
              {...common}
              dataset="nhl_draft_picks"
              submitLabel="Fetch draft picks → preview"
              fields={[
                { name: "year", label: "Draft year", type: "select", options: yearOptions(latestDraft, 1979) },
                {
                  name: "round",
                  label: "Round",
                  type: "select",
                  options: [{ value: "all", label: "All rounds" }, ...[1, 2, 3, 4, 5, 6, 7].map((r) => ({ value: String(r), label: `Round ${r}` }))],
                },
              ]}
            />
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">MoneyPuck <span className="text-xs font-normal text-ink-muted">season-summary CSVs</span></h2>
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {status.moneypuck.credit}. {status.moneypuck.terms}
        </p>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Skaters">
            <ConnectorForm {...common} dataset="moneypuck_skaters" submitLabel="Fetch MoneyPuck skaters → preview" fields={[season, gameType, situations]} />
          </Card>
          <Card title="Goalies">
            <ConnectorForm {...common} dataset="moneypuck_goalies" submitLabel="Fetch MoneyPuck goalies → preview" fields={[season, gameType, situations]} />
          </Card>
          <Card title="Teams">
            <ConnectorForm {...common} dataset="moneypuck_teams" submitLabel="Fetch MoneyPuck teams → preview" fields={[season, gameType, situations]} />
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">
          EliteProspects <span className="text-xs font-normal text-ink-muted">official API only</span>{" "}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${status.eliteprospects.enabled ? "bg-good/10 text-good" : "bg-track text-ink-muted"}`}>
            {status.eliteprospects.enabled ? "Enabled" : "Disabled until configured"}
          </span>
        </h2>
        <Card>
          <p className="mb-3 text-sm text-ink-muted">{status.eliteprospects.reason} {status.eliteprospects.terms}</p>
          <ConnectorForm
            action={runConnectorAction}
            organizationId={ctx.org.id}
            disabled={!canImport || !status.eliteprospects.enabled}
            dataset="ep_players"
            submitLabel="Search EliteProspects → preview"
            fields={[{ name: "query", label: "Player name", type: "text", placeholder: "Player name" }]}
          />
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">
          RosterIQ models <span className="text-xs font-normal text-ink-muted">built here from NHL API data</span>{" "}
          <Link href="/real-data/models" className="ml-2 text-xs font-normal text-accent-text hover:underline">Model cards →</Link>
        </h2>
        <p className="text-xs text-ink-muted">{status.rosteriq_models.credit}. {status.rosteriq_models.terms}</p>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={`Expected goals — ${XG_MODEL_VERSION}`}>
            {xgSeasons.length === 0 || !files.xg_skaters.present ? (
              <p className="text-sm text-ink-muted">No xG model output in models/{XG_MODEL_VERSION}/ yet.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-ink-muted">
                  Season totals only. Every season is scored by a model that never saw it (completed seasons:
                  leave-one-season-out; the current season: the production model, updated nightly after the games).
                  Descriptive: ixG measures the chances a player got, not what he will get.
                </p>
                {Object.entries(inSeason).map(([sid, v]) => (
                  <p key={sid} className="mb-3 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-ink-secondary">
                    {`${sid.slice(0, 4)}-${sid.slice(6)}`} in progress: data through {v.through ?? "—"} ({v.games ?? 0} games). Stage and approve to refresh the app.
                  </p>
                ))}
                <ConnectorForm
                  {...common}
                  action={stageXgBundleAction}
                  cacheable={false}
                  dataset="rosteriq_xg_bundle"
                  submitLabel="Stage all xG totals (skaters, goalies, teams) → preview"
                  fields={[{ ...season, options: xgSeasons }, gameType]}
                />
                <div className="my-4 border-t border-line" />
                <ConnectorForm {...common} cacheable={false} dataset="rosteriq_xg_skaters" submitLabel="Stage skater xG → preview" fields={[{ ...season, options: xgSeasons }, gameType]} />
                <div className="my-4 border-t border-line" />
                <ConnectorForm {...common} cacheable={false} dataset="rosteriq_xg_goalies" submitLabel="Stage goalie xGA / GSAx → preview" fields={[{ ...season, options: xgSeasons }, gameType]} />
                <div className="my-4 border-t border-line" />
                <ConnectorForm {...common} cacheable={false} dataset="rosteriq_xg_teams" submitLabel="Stage team xGF / xGA → preview" fields={[{ ...season, options: xgSeasons }, gameType]} />
              </>
            )}
          </Card>
          <Card title={`Prospects — ${PROSPECT_MODEL_VERSION}`}>
            {draftYears.length === 0 || !files.prospects.present ? (
              <p className="text-sm text-ink-muted">No prospect model output in models/{PROSPECT_MODEL_VERSION}/ yet.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-ink-muted">
                  P(200+ NHL games in seven seasons) from draft-time information only. Past drafts are scored
                  out-of-sample; recent drafts have no outcome yet.
                </p>
                <ConnectorForm
                  {...common}
                  cacheable={false}
                  dataset="rosteriq_prospects"
                  submitLabel="Stage prospect projections → preview"
                  fields={[{ name: "draftYear", label: "Draft", type: "select", options: [{ value: "all", label: "All drafts" }, ...draftYears.map((y) => ({ value: String(y), label: String(y) }))] }]}
                />
                <div className="my-4 border-t border-line" />
                <ConnectorForm {...common} cacheable={false} dataset="rosteriq_nhle" submitLabel="Stage league equivalencies (NHLe) → preview" fields={[]} />
              </>
            )}
          </Card>
        </div>
      </section>

      <Card title="Provenance log (approved connector imports)">
        {sources.length === 0 ? (
          <p className="text-sm text-ink-muted">No real data has been approved yet. Run a connector above, review the preview, and approve it.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th>Source</Th>
                  <Th>Effective</Th>
                  <Th>Retrieved</Th>
                  <Th>Credit</Th>
                  <Th>Import</Th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-b border-line/50 last:border-0">
                    <Td>
                      <div className="font-medium">{s.name}</div>
                      <div className="max-w-md truncate font-mono text-xs text-ink-muted" title={s.url ?? ""}>{s.url}</div>
                    </Td>
                    <Td>{s.effectiveSeason ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{s.retrievedAt ? s.retrievedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—"}</Td>
                    <Td className="text-xs text-ink-secondary">{s.credit}</Td>
                    <Td>{s.importId ? <Link href={`/imports/${s.importId}`} className="text-accent-text hover:underline">View</Link> : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-muted">Log generated {formatDate(now)}.</p>
      </Card>
    </div>
  );
}
