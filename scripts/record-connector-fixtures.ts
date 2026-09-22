/**
 * Records REAL responses from the external data sources into
 * tests/fixtures/connectors/ so parsers and tests are built on what the
 * sources actually return, not on assumed formats.
 *
 * Trimming is deterministic and only ever DROPS whole array elements / CSV
 * lines — no field value is edited. manifest.json records the URL, HTTP
 * status, retrieval time, and the trimming applied to every fixture.
 *
 * Usage (behind an HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1):
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/record-connector-fixtures.ts
 * EliteProspects data fixtures are recorded only when EP_API_KEY is set;
 * without a key only the real 401 responses are recorded.
 */
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "tests", "fixtures", "connectors");
const UA = "RosterIQ-fixture-recorder/0.1 (+https://github.com/amurray0317/salary-cap)";

interface ManifestEntry {
  file: string;
  url: string;
  status: number;
  retrievedAt: string;
  trimming: string;
}
const manifest: ManifestEntry[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/csv, */*" } });
  const text = await res.text();
  await sleep(1200); // be polite between requests
  return { status: res.status, text };
}

function write(file: string, url: string, status: number, body: string, trimming: string) {
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  manifest.push({ file, url, status, retrievedAt: new Date().toISOString(), trimming });
  console.log(`  ${status} ${file} (${body.length} bytes)`);
}

async function json(file: string, url: string, trim?: (d: Record<string, unknown>) => [Record<string, unknown>, string]) {
  const { status, text } = await get(url);
  if (status !== 200) throw new Error(`${url} → HTTP ${status}`);
  let data = JSON.parse(text) as Record<string, unknown>;
  let note = "none (full response)";
  if (trim) [data, note] = trim(data);
  write(file, url, status, JSON.stringify(data, null, 1) + "\n", note);
}

/** Keep the header plus every line for the first `players` distinct ids (column 0). */
function trimCsvByFirstColumn(text: string, keep: number): [string, string] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!;
  const kept: string[] = [];
  const ids: string[] = [];
  for (const line of lines.slice(1)) {
    const id = line.slice(0, line.indexOf(","));
    if (!ids.includes(id)) {
      if (ids.length >= keep) continue;
      ids.push(id);
    }
    kept.push(line);
  }
  return [
    [header, ...kept].join("\n") + "\n",
    `header + all lines (every situation) for the first ${keep} distinct ids in file order; ${lines.length - 1} data lines in original`,
  ];
}

async function csv(file: string, url: string, keep: number) {
  const { status, text } = await get(url);
  if (status !== 200) throw new Error(`${url} → HTTP ${status}`);
  const [body, note] = trimCsvByFirstColumn(text, keep);
  write(file, url, status, body, note);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const web = "https://api-web.nhle.com/v1";
  const rest = "https://api.nhle.com/stats/rest/en";
  const cay = (season: string, gameType: number) => `cayenneExp=${encodeURIComponent(`seasonId=${season} and gameTypeId=${gameType}`)}`;

  console.log("NHL api-web");
  await json("nhl/player-landing-8478402.json", `${web}/player/8478402/landing`);
  await json("nhl/player-landing-8471679.json", `${web}/player/8471679/landing`);
  await json("nhl/roster-CHI-20242025.json", `${web}/roster/CHI/20242025`);
  await json("nhl/draft-rankings-2025-1.json", `${web}/draft/rankings/2025/1`, (d) => {
    const all = d.rankings as Array<Record<string, unknown>>;
    const head = all.slice(0, 20);
    const partial = all.filter((r) => r.finalRank === undefined || r.midtermRank === undefined || r.lastAmateurClub === undefined).slice(0, 6);
    return [{ ...d, rankings: [...head, ...partial.filter((p) => !head.includes(p))] }, `first 20 rankings + up to 6 entries missing finalRank/midtermRank/lastAmateurClub; ${all.length} in original`];
  });
  await json("nhl/draft-rankings-2025-3.json", `${web}/draft/rankings/2025/3`);
  await json("nhl/draft-picks-2024-1.json", `${web}/draft/picks/2024/1`);

  console.log("NHL stats REST");
  await json(
    "nhl/stats-skater-summary-20242025-2.json",
    `${rest}/skater/summary?isAggregate=false&isGame=false&start=0&limit=-1&sort=${encodeURIComponent('[{"property":"playerId","direction":"ASC"}]')}&${cay("20242025", 2)}`,
    (d) => {
      const all = d.data as Array<Record<string, unknown>>;
      const head = all.slice(0, 12);
      const multi = all.filter((r) => String(r.teamAbbrevs ?? "").includes(",")).slice(0, 3);
      const picked = [...head, ...multi.filter((m) => !head.includes(m))];
      const nullFo = all.filter((r) => r.faceoffWinPct === null && !picked.includes(r)).slice(0, 3);
      return [{ ...d, data: [...picked, ...nullFo] }, `first 12 by playerId + 3 multi-team + 3 null-faceoff rows; ${all.length} in original ("total" left as reported)`];
    },
  );
  await json(
    "nhl/stats-goalie-summary-20242025-2.json",
    `${rest}/goalie/summary?isAggregate=false&isGame=false&start=0&limit=-1&sort=${encodeURIComponent('[{"property":"playerId","direction":"ASC"}]')}&${cay("20242025", 2)}`,
    (d) => {
      const all = d.data as Array<Record<string, unknown>>;
      return [{ ...d, data: all.slice(0, 10) }, `first 10 by playerId; ${all.length} in original ("total" left as reported)`];
    },
  );
  await json("nhl/stats-teams.json", `${rest}/team`);
  await json("nhl/stats-team-summary-20242025-2.json", `${rest}/team/summary?isAggregate=false&isGame=false&start=0&limit=-1&${cay("20242025", 2)}`);

  console.log("MoneyPuck season summaries");
  const mp = "https://moneypuck.com/moneypuck/playerData/seasonSummary";
  await csv("moneypuck/skaters-2024-regular.csv", `${mp}/2024/regular/skaters.csv`, 8);
  await csv("moneypuck/goalies-2024-regular.csv", `${mp}/2024/regular/goalies.csv`, 5);
  await csv("moneypuck/teams-2024-regular.csv", `${mp}/2024/regular/teams.csv`, 3);

  console.log("EliteProspects (official API)");
  for (const [file, url] of [
    ["eliteprospects/401-missing-key.json", "https://api.eliteprospects.com/v1/leagues"],
    ["eliteprospects/401-invalid-key.json", "https://api.eliteprospects.com/v1/players?apiKey=invalid-probe-key&limit=1"],
  ] as const) {
    const { status, text } = await get(url);
    write(file, url, status, text.trim() + "\n", "none (full error response)");
  }
  const key = process.env.EP_API_KEY;
  if (key) {
    const url = `https://api.eliteprospects.com/v1/players?q=${encodeURIComponent("Macklin Celebrini")}&limit=3&apiKey=${encodeURIComponent(key)}`;
    const { status, text } = await get(url);
    write("eliteprospects/players-search.json", url.replace(key, "REDACTED"), status, text.trim() + "\n", "none (full response)");
  } else {
    console.log("  EP_API_KEY not set — data fixtures not recorded");
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifest.length} fixtures + manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
