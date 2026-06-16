/**
 * sanctions-e2e.mjs — E2E test suite for the OFAC Sanctions UI surface.
 * Run from packages/web: node sanctions-e2e.mjs
 * Requires: backend on :8787 + vite dev on :5173 (vite proxies /api → 8787).
 *
 * Surface differs from convergence: sanctions is FOLDED INTO FinancePanel (D-501,
 * the 1st "Finance" tab — NOT its own tab). Map layer toggle 'sanctions' lives in
 * .layer-toggles (legacy keys) and is OFF by default (D-503).
 *
 * Checks:
 *  1. Load (no console errors / net 4xx-5xx)
 *  2. Finance tab → FinancePanel → SanctionsSection rows render, badCountries=0, badCounts=0
 *  3. Order (sanctionedCount descending)
 *  4. Sanctions layer toggle OFF by default → enable → ON
 *  5. Map-tie (click row → row gets active class, map canvas present)
 *  6. Not empty/error state (data present)
 *  7. Responsive: 375px no overflow + panel usable + 0 JS errors
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

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ========================== DESKTOP 1200px ==========================
  const ctx1200 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx1200.newPage();

  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) networkErrors.push({ url: resp.url(), status: resp.status() });
  });

  // CHECK 1 — Load
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/sanctions-01-load-1200.png` });

  const appErrors = consoleErrors.filter(
    (e) =>
      !e.text.includes('WebGL') &&
      !e.text.includes('GPU') &&
      !e.text.includes('CORS') &&
      !e.text.includes('favicon') &&
      !e.text.includes('maplibre') &&
      !e.text.includes('Mixed Content')
  );
  const netErrors = networkErrors.filter((e) => !e.url.includes('favicon'));
  record('CHECK 1 — Load: 0 console errors', appErrors.length === 0,
    appErrors.length === 0 ? '0 errors/warnings' : `${appErrors.length}: ${JSON.stringify(appErrors.slice(0, 3))}`);
  record('CHECK 1 — Load: 0 network 4xx/5xx', netErrors.length === 0,
    netErrors.length === 0 ? '0 network errors' : `${netErrors.length}: ${JSON.stringify(netErrors.slice(0, 3))}`);

  // CHECK 2 — Finance tab → SanctionsSection rows
  // Finance is the 1st tab. Open the panel drawer first (mobile starts collapsed;
  // on desktop the panel is a sidebar but clicking the tab is harmless).
  const financeTab = page.locator('.panel-tab', { hasText: 'Finance' });
  record('CHECK 2 — Finance tab exists', (await financeTab.count()) > 0, `${await financeTab.count()} match`);
  await financeTab.click();
  await page.waitForTimeout(3000);

  const sectionVisible = await page.locator('.sanctions-section').isVisible().catch(() => false);
  record('CHECK 2 — SanctionsSection mounted', sectionVisible, sectionVisible ? 'visible' : 'NOT FOUND');

  const rows = await page.locator('.sanctions-row').all();
  const rowCount = rows.length;
  let badCountries = 0;
  let badCounts = 0;
  const countNums = [];

  for (const row of rows) {
    const name = (await row.locator('.sanctions-row__country').textContent().catch(() => '')).trim();
    if (!name || name === 'undefined' || name === 'null') { badCountries++; console.log('  BAD COUNTRY:', JSON.stringify(name)); }
    const countText = (await row.locator('.sanctions-row__count').textContent().catch(() => '')).trim();
    const val = parseInt(countText.replace(/[^0-9]/g, ''), 10);
    if (countText === '' || countText.includes('NaN') || isNaN(val)) { badCounts++; console.log('  BAD COUNT:', JSON.stringify(countText)); }
    else countNums.push(val);
  }

  record('CHECK 2 — sanctions rows render', rowCount >= 1, `${rowCount} rows`);
  record('CHECK 2 — badCountries = 0 (anti-BUG-1 camelCase)', badCountries === 0,
    badCountries === 0 ? `0 bad / ${rowCount}` : `${badCountries} bad`);
  record('CHECK 2 — badCounts = 0 (no NaN)', badCounts === 0,
    badCounts === 0 ? '0 NaN' : `${badCounts} NaN`);

  // CHECK 3 — order descending by count
  let desc = true;
  for (let i = 1; i < countNums.length; i++) if (countNums[i] > countNums[i - 1]) { desc = false; break; }
  record('CHECK 3 — rows sorted by count desc', desc, `counts[0..5]: ${JSON.stringify(countNums.slice(0, 6))}`);

  // CHECK 6 — not empty/error
  const emptyVisible = await page.locator('.sanctions-section .state-empty').isVisible().catch(() => false);
  const errorVisible = await page.locator('.sanctions-section .state-error').isVisible().catch(() => false);
  record('CHECK 6 — section status ok (not empty/error)', rowCount > 0 && !emptyVisible && !errorVisible,
    `rows=${rowCount}, empty=${emptyVisible}, error=${errorVisible}`);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/sanctions-02-panel-1200.png` });

  // CHECK 4 — sanctions layer toggle (D-503: OFF by default)
  const sancToggle = page.locator('.layer-toggle-btn', { hasText: /sanctions/i });
  const sancBtnExists = (await sancToggle.count()) > 0;
  record('CHECK 4 — sanctions toggle button in UI', sancBtnExists, sancBtnExists ? 'found in .layer-toggles' : 'NOT FOUND');

  if (sancBtnExists) {
    const activeByDefault = await sancToggle.first().evaluate((el) => el.classList.contains('active'));
    record('CHECK 4 — sanctions toggle OFF by default (D-503)', !activeByDefault,
      activeByDefault ? 'FAIL: active by default' : 'correct: OFF');
    await sancToggle.first().click();
    await page.waitForTimeout(1000);
    const activeAfter = await sancToggle.first().evaluate((el) => el.classList.contains('active'));
    record('CHECK 4 — sanctions toggle ON after click', activeAfter, activeAfter ? 'ON' : 'did not activate');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/sanctions-04-layer-1200.png` });
  }

  // CHECK 5 — map-tie
  const firstBtn = page.locator('.sanctions-row__btn').first();
  if ((await firstBtn.count()) > 0) {
    const name = await firstBtn.locator('.sanctions-row__country').textContent().catch(() => '');
    await firstBtn.click();
    await page.waitForTimeout(1500);
    const activeCount = await page.locator('.sanctions-row.active').count();
    record('CHECK 5 — map-tie: row gets active class', activeCount > 0, `country="${name}", activeRows=${activeCount}`);
    const canvas = page.locator('.map-container canvas');
    record('CHECK 5 — map canvas present', (await canvas.count()) > 0, (await canvas.count()) > 0 ? 'canvas found' : 'not found');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/sanctions-05-maptie-1200.png` });
  } else {
    record('CHECK 5 — map-tie', false, 'no sanctions rows to click');
  }

  await ctx1200.close();

  // ========================== RESPONSIVE 375px ==========================
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page375 = await ctx375.newPage();
  const mobileErrors = [];
  page375.on('console', (msg) => { if (msg.type() === 'error') mobileErrors.push(msg.text()); });

  await page375.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page375.waitForTimeout(2000);

  const bodyScrollWidth = await page375.evaluate(() => document.body.scrollWidth);
  record('CHECK 7 — 375px: no horizontal overflow', bodyScrollWidth <= 377, `scrollWidth=${bodyScrollWidth}`);

  const handle = page375.locator('.panel-handle');
  if ((await handle.count()) > 0) { await handle.click(); await page375.waitForTimeout(500); }
  const financeTab375 = page375.locator('.panel-tab', { hasText: 'Finance' });
  if ((await financeTab375.count()) > 0) { await financeTab375.click(); await page375.waitForTimeout(2000); }
  await page375.screenshot({ path: `${SCREENSHOT_DIR}/sanctions-07-mobile-375.png` });

  const sectionVisible375 = await page375.locator('.sanctions-section').isVisible().catch(() => false);
  record('CHECK 7 — 375px: SanctionsSection usable', sectionVisible375, sectionVisible375 ? 'visible' : 'not visible');
  const mobileAppErrors = mobileErrors.filter((e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon'));
  record('CHECK 7 — 375px: 0 JS errors', mobileAppErrors.length === 0,
    mobileAppErrors.length === 0 ? 'no errors' : JSON.stringify(mobileAppErrors.slice(0, 3)));

  await ctx375.close();
  await browser.close();

  // ========================== Summary ==========================
  console.log('\n=== E2E SUMMARY ===');
  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS');
  console.log(`TOTAL: ${results.length} | PASS: ${passed.length} | FAIL: ${failed.length}`);
  console.log(`rowCount: ${rowCount}, badCountries: ${badCountries}, badCounts: ${badCounts}`);
  if (failed.length > 0) { console.log('\nFAILED:'); for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`); }
  console.log('\nVERDICT:', failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length;
}

run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
