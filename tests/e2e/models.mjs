/**
 * Browser acceptance run for the RosterIQ model-output imports (xG season
 * totals, prospect projections, NHLe), driven with playwright-core against a
 * running server. Reads the committed files in models/<version>/ — no
 * network access to external sources is needed.
 *
 * Usage (fresh database):
 *   npm run db:reset && npm run build && npm start
 *   npm run test:e2e:models
 *
 * Env: E2E_BASE_URL (default http://localhost:3000), CHROMIUM_PATH,
 *      E2E_SCREENSHOT_DIR (optional; saves a screenshot per step).
 *
 * Flow: analyst opens Real data → stages 2025-26 skater xG → preview shows the
 * model file, its SHA-256 and the model version, nothing written yet → approve →
 * McDavid's page shows RosterIQ ixG with its reasons → goalie xGA/GSAx and team
 * totals → prospects (all drafts) → prospects page with outcomes → NHLe →
 * model cards → rival organization sees none of it.
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

async function stage(page, dataset, fill) {
  await page.goto(`${BASE}/real-data`);
  const f = form(page, dataset);
  if (fill) await fill(f);
  await f.locator("button").click();
  await page.waitForURL(/\/imports\/[0-9a-f-]+$/, { timeout: 120000 });
  return page.url();
}

async function approve(page) {
  await page.locator("button:has-text('Approve & commit')").click();
  await expectText(page, "Committed");
}

const browser = await chromium.launch({ executablePath: resolveChromium() });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
let xgImportUrl = "";

try {
  await step(page, "analyst opens the RosterIQ models section", async () => {
    await login(page, "analyst@aurora.demo");
    await page.goto(`${BASE}/real-data`);
    await expectText(page, "RosterIQ models");
    await expectText(page, "Expected goals — rosteriq-xg-v1");
    await expectText(page, "Prospects — rosteriq-prospects-v1");
    if ((await form(page, "rosteriq_xg_skaters").locator('input[name="bypassCache"]').count()) > 0) {
      throw new Error("model imports must not offer a cache bypass");
    }
  });

  await step(page, "stage 2025-26 skater xG into a gated preview with file provenance", async () => {
    xgImportUrl = await stage(page, "rosteriq_xg_skaters", async (f) => {
      await f.locator('select[name="season"]').selectOption("2025-26");
      await f.locator('select[name="gameType"]').selectOption("regular");
    });
    await expectText(page, "Source & provenance");
    await expectText(page, "models/rosteriq-xg-v1/import_xg_skaters.csv (sha256");
    await expectText(page, "RosterIQ xG · skater season totals (rosteriq-xg-v1) — 2025-26 regular season");
    await expectText(page, "RosterIQ model, built from NHL API data");
  });

  await step(page, "nothing is on the player page before approval", async () => {
    const p2 = await page.context().newPage();
    const res = await p2.goto(`${BASE}/real-data/players/8478402`);
    if (res?.status() !== 404 && (await p2.locator("text=RosterIQ expected goals").count()) > 0) {
      throw new Error("xG rows visible before approval");
    }
    await p2.close();
  });

  await step(page, "approve → McDavid's page shows ixG with its reasons", async () => {
    await approve(page);
    await expectText(page, "data source recorded");
    await page.goto(`${BASE}/real-data/players/8478402`);
    await expectText(page, "RosterIQ expected goals — ixG and why (model output)");
    await expectText(page, "Biggest reasons (goals)");
    await expectText(page, "Distance");
    await expectText(page, "Each season is scored by a model that never saw it");
  });

  await step(page, "goalie xGA / GSAx and team totals import and approve", async () => {
    await stage(page, "rosteriq_xg_goalies", async (f) => {
      await f.locator('select[name="season"]').selectOption("2025-26");
    });
    await expectText(page, "import_xg_goalies.csv");
    await approve(page);
    await stage(page, "rosteriq_xg_teams", async (f) => {
      await f.locator('select[name="season"]').selectOption("2025-26");
    });
    await expectText(page, "import_xg_teams.csv");
    await approve(page);
  });

  await step(page, "prospect projections (all drafts) and NHLe import and approve", async () => {
    await stage(page, "rosteriq_prospects", async (f) => {
      await f.locator('select[name="draftYear"]').selectOption("all");
    });
    await expectText(page, "models/rosteriq-prospects-v1/import_prospects.csv (sha256");
    await approve(page);
    await stage(page, "rosteriq_nhle");
    await expectText(page, "import_league_factors.csv");
    await approve(page);
  });

  await step(page, "prospects page shows a past draft with outcomes and a model-vs-draft-order check", async () => {
    await page.goto(`${BASE}/real-data/prospects?y=2015`);
    await expectText(page, "2015 NHL Draft · skaters");
    await expectText(page, "Connor McDavid");
    await expectText(page, "Expected 200-game players");
    await expectText(page, "Hits in first 30 picks");
  });

  await step(page, "model cards show test-season accuracy against MoneyPuck and draft position", async () => {
    await page.goto(`${BASE}/real-data/models`);
    await expectText(page, "MoneyPuck xGoal (Data: MoneyPuck.com)");
    await expectText(page, "Draft position only");
    await expectText(page, "What it cannot see");
  });

  await step(page, "rival organization sees none of it", async () => {
    await page.context().clearCookies();
    await login(page, "gm@ironport.demo");
    await page.goto(`${BASE}/real-data/prospects`);
    await expectText(page, "No prospect projections imported");
    const res = await page.goto(xgImportUrl);
    if (res?.status() !== 404) throw new Error(`expected 404 for foreign import, got ${res?.status()}`);
  });

  console.log(`\nAll ${checks.length} model-import checks passed.`);
} catch (err) {
  console.error("\nFAILED:", err);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "failure.png"), fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}
