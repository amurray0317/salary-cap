/**
 * Browser end-to-end test of the first vertical slice, driven with
 * playwright-core against a running server.
 *
 * Usage:
 *   npm run build && npm start          # in one terminal
 *   npm run test:e2e                    # in another
 *
 * Env:
 *   E2E_BASE_URL   default http://localhost:3000
 *   CHROMIUM_PATH  default resolves a chromium under $PLAYWRIGHT_BROWSERS_PATH
 *
 * The flow: register a NEW user → create organization → create team + a new
 * league with a configured cap → add player → add 4-season contract → verify
 * dashboard commitments → create scenario → add an over-cap proposed signing
 * → verify the blocking violation and negative projected space → open the
 * scenario comparison.
 */
import { chromium } from "playwright-core";
import { execSync } from "child_process";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  try {
    return execSync(`find ${root} -maxdepth 3 -path "*chrome-linux/chrome" | head -1`)
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const step = (name) => console.log("STEP:", name);
const stamp = Date.now();
const email = `founder+${stamp}@e2e.test`;

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage();
page.setDefaultTimeout(20000);

try {
  step("register");
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="fullName"]', "E2E Founder");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "vertical-slice-1");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/onboarding");

  step("create organization");
  await page.fill('input[name="name"]', `E2E Hockey Ops ${stamp}`);
  await page.click("button:has-text('Create organization')");
  await page.waitForSelector("text=Create your first team");

  step("create team + new league with cap limits");
  await page.fill('input[name="name"]', "E2E Glaciers");
  await page.fill('input[name="abbreviation"]', "EEG");
  await page.selectOption('select[name="leagueId"]', "__new__");
  await page.fill('input[name="leagueName"]', `E2E League ${stamp}`);
  await page.fill('input[name="leagueAbbr"]', "ETL");
  await page.fill('input[name="capYear1"]', "80000000");
  await page.click("button:has-text('Create team')");
  await page.waitForURL("**/dashboard");

  step("add player");
  await page.goto(`${BASE}/players/new`);
  await page.fill('input[name="fullName"]', "Test Center One");
  await page.click("button:has-text('Add player')");
  await page.waitForURL("**/players/**");

  step("add 4-season contract");
  await page.goto(`${BASE}/contracts/new`);
  const capInputs = page.locator('input[name^="capHit_"]');
  const n = await capInputs.count();
  if (n < 4) throw new Error(`expected 4 season rows, got ${n}`);
  for (let i = 0; i < 4; i++) await capInputs.nth(i).fill("70000000");
  await page.click("button:has-text('Create contract')");
  await page.waitForURL("**/players/**");

  step("dashboard shows commitments");
  await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector("text=$70.0M");

  step("create scenario");
  await page.goto(`${BASE}/scenarios`);
  await page.fill('input[name="name"]', "Overspend test");
  await page.click("button:has-text('Create scenario')");
  await page.waitForURL("**/scenarios/**");

  step("add over-cap proposed signing");
  await page.fill('input[name="label"]', "Sign expensive UFA");
  await page.fill('input[name="playerName"]', "Pricey Winger");
  await page.locator('input[name^="season_"]').first().fill("15000000");
  await page.click("button:has-text('Add to scenario')");
  await page.waitForSelector("text=Sign expensive UFA");

  step("verify blocking violation and negative projected space");
  await page.waitForSelector("text=exceeds the upper limit");
  await page.waitForSelector("text=−$5.00M");

  step("comparison");
  await page.click("text=Compare with official");
  await page.waitForSelector("text=Official vs scenarios");

  console.log("E2E VERTICAL SLICE: PASS");
} catch (err) {
  console.error("E2E FAILURE:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
