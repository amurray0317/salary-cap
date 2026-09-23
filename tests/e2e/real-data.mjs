/**
 * Browser acceptance run for the real-data connectors, driven with
 * playwright-core against a running server that can reach the LIVE sources
 * (api-web.nhle.com, api.nhle.com, moneypuck.com).
 *
 * Usage (on a freshly seeded database — step 2 expects a live fetch):
 *   npm run db:reset && npm run build && NODE_USE_ENV_PROXY=1 npm start   # proxy flag only behind an HTTPS proxy
 *   npm run test:e2e:real-data
 *
 * Env: E2E_BASE_URL (default http://localhost:3000), CHROMIUM_PATH,
 *      E2E_SCREENSHOT_DIR (optional; saves a screenshot per step).
 *
 * Flow: analyst signs in → EliteProspects shows "Disabled until configured"
 * → Central Scouting rankings fetch → preview with provenance, nothing in
 * reference tables yet → approve → draft page → MoneyPuck skaters (all +
 * 5on5) → approve → McDavid career via NHL API → approve → McDavid 2024-25
 * game logs → approve → player page shows NHL + MoneyPuck + game log with TOI honesty → repeat fetch is served from cache →
 * rival organization sees none of it and gets 404 on the import.
 */
import { chromium } from "playwright-core";
import { execSync } from "child_process";
import path from "path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  try {
    return execSync(`find ${root} -maxdepth 3 -path "*chrome-linux/chrome" | head -1`).toString().trim();
  } catch {
    return "";
  }
}

let n = 0;
const checks = [];
async function step(page, name, fn) {
  n += 1;
  process.stdout.write(`STEP ${n}: ${name} … `);
  await fn();
  checks.push(name);
  console.log("ok");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(n).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`), fullPage: true });
}
const expectText = async (page, text) => {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
};
const form = (page, dataset) => page.locator(`form:has(input[name="dataset"][value="${dataset}"])`);

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "rosteriq-demo");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|scouting)/);
}

const browser = await chromium.launch({ executablePath: resolveChromium() });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
let rankingsImportUrl = "";

try {
  await step(page, "analyst signs in and opens Real data", async () => {
    await login(page, "analyst@aurora.demo");
    await page.goto(`${BASE}/real-data`);
    await expectText(page, "Real data connectors");
    await expectText(page, "Disabled until configured");
    await expectText(page, "non-commercial");
    if (!(await form(page, "ep_players").locator("button").isDisabled())) throw new Error("EP form should be disabled");
  });

  await step(page, "fetch Central Scouting rankings into a gated preview", async () => {
    const f = form(page, "nhl_draft_rankings");
    await f.locator('select[name="year"]').selectOption("2025");
    await f.locator('select[name="category"]').selectOption("1");
    await f.locator("button").click();
    await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
    rankingsImportUrl = page.url();
    await expectText(page, "Source & provenance");
    await expectText(page, "https://api-web.nhle.com/v1/draft/rankings/2025/1");
    await expectText(page, "2025 NHL Draft");
    await expectText(page, "fetched live");
    await expectText(page, "Matthew Schaefer");
    if ((await page.locator("text=Step 1 · Map CSV columns").count()) > 0) throw new Error("connector imports must not show mapping");
  });

  await step(page, "nothing is in reference tables before approval", async () => {
    const p2 = await page.context().newPage();
    await p2.goto(`${BASE}/real-data/draft`);
    await p2.getByText("No rankings imported").first().waitFor();
    await p2.close();
  });

  await step(page, "approve rankings → draft page shows midterm/final ranks", async () => {
    await page.locator("button:has-text('Approve & commit')").click();
    await expectText(page, "Committed");
    await expectText(page, "data source recorded");
    await page.goto(`${BASE}/real-data/draft`);
    await expectText(page, "NHL Central Scouting · 2025");
    await expectText(page, "Matthew Schaefer");
    await expectText(page, "Δ = midterm rank − final rank");
  });

  await step(page, "MoneyPuck skaters (all + 5on5) → preview → approve", async () => {
    await page.goto(`${BASE}/real-data`);
    const f = form(page, "moneypuck_skaters");
    await f.locator('select[name="season"]').selectOption("2024-25");
    await f.locator('input[value="5on5"]').check();
    await f.locator("button").click();
    await page.waitForURL(/\/imports\/[0-9a-f-]+$/, { timeout: 120000 });
    await expectText(page, "Data: MoneyPuck.com");
    await expectText(page, "moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/skaters.csv");
    await page.locator("button:has-text('Approve & commit')").click();
    await expectText(page, "Committed");
  });

  await step(page, "NHL career seasons for Connor McDavid → approve", async () => {
    await page.goto(`${BASE}/real-data`);
    const f = form(page, "nhl_player_seasons");
    await f.locator('textarea[name="playerIds"]').fill("8478402");
    await f.locator("button").click();
    await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
    await expectText(page, "no time-on-ice in the source");
    await expectText(page, "career through");
    await page.locator("button:has-text('Approve & commit')").click();
    await expectText(page, "Committed");
  });

  await step(page, "NHL game logs for Connor McDavid → approve", async () => {
    await page.goto(`${BASE}/real-data`);
    const f = form(page, "nhl_game_logs");
    await f.locator('textarea[name="playerIds"]').fill("8478402");
    await f.locator('select[name="season"]').selectOption("2024-25");
    await f.locator("button").click();
    await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
    await expectText(page, "https://api-web.nhle.com/v1/player/8478402/game-log/20242025/2");
    await page.locator("button:has-text('Approve & commit 67 valid rows')").click();
    await expectText(page, "Committed");
  });

  await step(page, "player page merges NHL career and MoneyPuck with credit and TOI honesty", async () => {
    await page.goto(`${BASE}/real-data/players?q=McDavid`);
    await page.locator("a:has-text('Connor McDavid')").first().click();
    await page.waitForURL(/\/real-data\/players\/8478402$/);
    await expectText(page, "Career by season — NHL API");
    await expectText(page, "MoneyPuck season summaries — Data: MoneyPuck.com");
    await expectText(page, "Game log 2024-25 regular season — NHL API (67 games)");
    await expectText(page, "Last 10:");
    await expectText(page, "never estimated");
    await expectText(page, "Data sources & provenance");
  });

  await step(page, "repeat fetch is served from the organization cache", async () => {
    await page.goto(`${BASE}/real-data`);
    const f = form(page, "nhl_draft_rankings");
    await f.locator('select[name="year"]').selectOption("2025");
    await f.locator('select[name="category"]').selectOption("1");
    await f.locator("button").click();
    await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
    await expectText(page, "served from this organization's cache");
    await expectText(page, "New / update existing");
    await page.locator("button:has-text('Discard import')").click();
    await expectText(page, "discarded");
  });

  await step(page, "rival organization sees none of it", async () => {
    await page.context().clearCookies();
    await login(page, "gm@ironport.demo");
    await page.goto(`${BASE}/real-data/players`);
    await expectText(page, "No real players imported yet");
    await page.goto(`${BASE}/real-data/draft`);
    await expectText(page, "No rankings imported");
    const res = await page.goto(rankingsImportUrl);
    if (res?.status() !== 404) throw new Error(`expected 404 for foreign import, got ${res?.status()}`);
  });

  console.log(`\nAll ${checks.length} real-data checks passed.`);
} catch (err) {
  console.error("\nFAILED:", err);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "failure.png"), fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}
