/**
 * chokepoints-e2e.mjs — E2E for the "Rutas / Chokepoints" surface (slice A).
 * Run from packages/web: node chokepoints-e2e.mjs
 * Requires: backend :8787 + vite dev :5173 (vite proxies /api → 8787).
 *
 * Checks:
 *  1. Load (no console errors / net 4xx-5xx)
 *  2. "Rutas" tab (6th) → ChokepointsPanel → ≥12 rows, badNames=0, every row has impactEs
 *  3. Sorted by status severity (disrupted ≥ watch ≥ calm)
 *  4. chokepoints map layer toggle ON by default (D-604)
 *  5. Map-tie (click row → row active class, map canvas present)
 *  6. Responsive: 375px no overflow + tab bar scrollable + panel usable
 */

import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const SCREENSHOT_DIR = '../../plans/screenshots';
const results = [];
function record(check, pass, detail) {
  const status = pass ? 'PASS' : 'FAIL';
  results.push({ check, status, detail: detail ?? '' });
  console.log(`[${status}] ${check}${detail ? ': ' + detail : ''}`);
}
const sevRank = { disrupted: 2, watch: 1, calm: 0 };

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();

  const consoleErrors = [], networkErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) networkErrors.push({ url: r.url(), status: r.status() }); });

  // CHECK 1 — Load
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/chokepoints-01-load-1200.png` });
  const appErrors = consoleErrors.filter((e) =>
    !e.includes('WebGL') && !e.includes('GPU') && !e.includes('CORS') &&
    !e.includes('favicon') && !e.includes('maplibre') && !e.includes('Mixed Content'));
  const netErrors = networkErrors.filter((e) => !e.url.includes('favicon'));
  record('CHECK 1 — 0 console errors', appErrors.length === 0, appErrors.length === 0 ? 'clean' : JSON.stringify(appErrors.slice(0, 3)));
  record('CHECK 1 — 0 network 4xx/5xx', netErrors.length === 0, netErrors.length === 0 ? 'clean' : JSON.stringify(netErrors.slice(0, 3)));

  // CHECK 4 (before tab switch) — chokepoints toggle ON by default
  const cpToggle = page.locator('.layer-toggle-btn', { hasText: /chokepoints|rutas/i });
  const cpToggleExists = (await cpToggle.count()) > 0;
  record('CHECK 4 — chokepoints toggle present', cpToggleExists, cpToggleExists ? 'found' : 'NOT FOUND');
  if (cpToggleExists) {
    const onByDefault = await cpToggle.first().evaluate((el) => el.classList.contains('active'));
    record('CHECK 4 — chokepoints ON by default (D-604)', onByDefault, onByDefault ? 'ON' : 'FAIL: off');
  }

  // CHECK 2 — Rutas tab → panel rows
  const tabs = await page.locator('.panel-tab').all();
  const tabTexts = await Promise.all(tabs.map((t) => t.textContent()));
  const hasRutas = tabTexts.some((t) => t && t.trim() === 'Rutas');
  record('CHECK 2 — 6th tab "Rutas" exists', hasRutas, `tabs(${tabs.length}): ${JSON.stringify(tabTexts)}`);

  let rowCount = 0, badNames = 0, badImpacts = 0;
  const statuses = [];
  if (hasRutas) {
    await page.locator('.panel-tab', { hasText: 'Rutas' }).click();
    await page.waitForTimeout(2500);
    const panelVisible = await page.locator('.chokepoints-panel').isVisible().catch(() => false);
    record('CHECK 2 — ChokepointsPanel mounted', panelVisible, panelVisible ? 'visible' : 'NOT FOUND');

    const rows = await page.locator('.chokepoints-row').all();
    rowCount = rows.length;
    for (const row of rows) {
      const name = (await row.locator('.chokepoints-row__name').textContent().catch(() => '')).trim();
      if (!name || name === 'undefined' || name === 'null') badNames++;
      const impact = (await row.locator('.chokepoints-row__impact').textContent().catch(() => '')).trim();
      if (!impact || impact.length < 10) badImpacts++;
      const st = (await row.locator('.chokepoints-row__status').textContent().catch(() => '')).trim().toLowerCase();
      statuses.push(st.includes('disrup') ? 'disrupted' : st.includes('vigil') ? 'watch' : 'calm');
    }
    record('CHECK 2 — ≥12 chokepoint rows', rowCount >= 12, `${rowCount} rows`);
    record('CHECK 2 — badNames = 0 (anti-BUG-1)', badNames === 0, `${badNames} bad / ${rowCount}`);
    record('CHECK 2 — every row has impactEs', badImpacts === 0, `${badImpacts} missing`);

    // CHECK 3 — sorted by severity (disrupted ≥ watch ≥ calm)
    let sorted = true;
    for (let i = 1; i < statuses.length; i++) if (sevRank[statuses[i]] > sevRank[statuses[i - 1]]) { sorted = false; break; }
    record('CHECK 3 — rows ordered by severity', sorted, statuses.join(','));

    await page.screenshot({ path: `${SCREENSHOT_DIR}/chokepoints-02-panel-1200.png` });

    // CHECK 5 — map-tie
    const firstBtn = page.locator('.chokepoints-row__btn').first();
    if ((await firstBtn.count()) > 0) {
      await firstBtn.click();
      await page.waitForTimeout(1500);
      const activeCount = await page.locator('.chokepoints-row.active').count();
      record('CHECK 5 — map-tie: row gets active class', activeCount > 0, `activeRows=${activeCount}`);
      const canvas = page.locator('.map-container canvas');
      record('CHECK 5 — map canvas present', (await canvas.count()) > 0, (await canvas.count()) > 0 ? 'canvas' : 'none');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/chokepoints-05-maptie-1200.png` });
    }
  }

  await ctx.close();

  // CHECK 6 — responsive 375
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await ctx375.newPage();
  const mobErrors = [];
  p.on('console', (m) => { if (m.type() === 'error') mobErrors.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(2000);
  const scrollW = await p.evaluate(() => document.body.scrollWidth);
  record('CHECK 6 — 375px: no horizontal overflow', scrollW <= 377, `scrollWidth=${scrollW}`);
  const handle = p.locator('.panel-handle');
  if ((await handle.count()) > 0) { await handle.click(); await p.waitForTimeout(400); }
  const rutas375 = p.locator('.panel-tab', { hasText: 'Rutas' });
  if ((await rutas375.count()) > 0) { await rutas375.click(); await p.waitForTimeout(2000); }
  await p.screenshot({ path: `${SCREENSHOT_DIR}/chokepoints-06-mobile-375.png` });
  const panel375 = await p.locator('.chokepoints-panel').isVisible().catch(() => false);
  record('CHECK 6 — 375px: panel usable', panel375, panel375 ? 'visible' : 'not visible');
  const mobApp = mobErrors.filter((e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon'));
  record('CHECK 6 — 375px: 0 JS errors', mobApp.length === 0, mobApp.length === 0 ? 'clean' : JSON.stringify(mobApp.slice(0, 3)));
  await ctx375.close();
  await browser.close();

  console.log('\n=== E2E SUMMARY ===');
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`TOTAL: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  console.log(`rowCount: ${rowCount}, badNames: ${badNames}, badImpacts: ${badImpacts}`);
  if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`); }
  console.log('\nVERDICT:', failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length;
}

run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
