/**
 * intel-e2e.mjs — E2E for the "Inteligencia" AI insights surface (slice B).
 * Run from packages/web: node intel-e2e.mjs
 * Requires: backend :8787 + vite dev :5173 (proxy /api → 8787).
 *
 * Both data and empty-state are PASS (empty is expected if no LLM batch yet, D-705).
 * Checks:
 *  1. Load (0 console errors / net 4xx-5xx)
 *  2. "Inteligencia" tab (7th) → IntelPanel mounts
 *  3. Renders EITHER ≥1 .intel-card (title + ≥1 consequence, badNames=0) OR the empty-state
 *  4. If cards: ordered by severity (alta ≥ media ≥ baja)
 *  5. Responsive 375px: no overflow + panel usable + 0 JS errors
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
const sevRank = { alta: 2, media: 1, baja: 0 };

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const consoleErrors = [], networkErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) networkErrors.push({ url: r.url(), status: r.status() }); });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/intel-01-load-1200.png` });
  const appErrors = consoleErrors.filter((e) =>
    !e.includes('WebGL') && !e.includes('GPU') && !e.includes('CORS') &&
    !e.includes('favicon') && !e.includes('maplibre') && !e.includes('Mixed Content'));
  const netErrors = networkErrors.filter((e) => !e.url.includes('favicon'));
  record('CHECK 1 — 0 console errors', appErrors.length === 0, appErrors.length === 0 ? 'clean' : JSON.stringify(appErrors.slice(0, 3)));
  record('CHECK 1 — 0 network 4xx/5xx', netErrors.length === 0, netErrors.length === 0 ? 'clean' : JSON.stringify(netErrors.slice(0, 3)));

  const tabs = await page.locator('.panel-tab').all();
  const tabTexts = await Promise.all(tabs.map((t) => t.textContent()));
  const hasIntel = tabTexts.some((t) => t && t.trim() === 'Inteligencia');
  record('CHECK 2 — 7th tab "Inteligencia" exists', hasIntel, `tabs(${tabs.length}): ${JSON.stringify(tabTexts)}`);

  let cardCount = 0, badTitles = 0, emptyShown = false;
  const severities = [];
  if (hasIntel) {
    await page.locator('.panel-tab', { hasText: 'Inteligencia' }).click();
    await page.waitForTimeout(2500);
    const panelVisible = await page.locator('.intel-panel').isVisible().catch(() => false);
    record('CHECK 2 — IntelPanel mounted', panelVisible, panelVisible ? 'visible' : 'NOT FOUND');

    const cards = await page.locator('.intel-card').all();
    cardCount = cards.length;
    emptyShown = await page.locator('.intel-panel .state-empty').isVisible().catch(() => false);

    if (cardCount > 0) {
      for (const c of cards) {
        const title = (await c.locator('.intel-card__title').textContent().catch(() => '')).trim();
        if (!title || title === 'undefined') badTitles++;
        const cons = await c.locator('.intel-card__consequence').count();
        if (cons < 1) badTitles++; // a card with no consequence is malformed
        const sev = (await c.locator('.intel-card__severity').textContent().catch(() => '')).trim().toLowerCase();
        severities.push(sev.includes('alta') ? 'alta' : sev.includes('media') ? 'media' : 'baja');
      }
      record('CHECK 3 — cards render with title + consequence (badTitles=0)', badTitles === 0, `${cardCount} cards, ${badTitles} bad`);
      let sorted = true;
      for (let i = 1; i < severities.length; i++) if (sevRank[severities[i]] > sevRank[severities[i - 1]]) { sorted = false; break; }
      record('CHECK 4 — cards ordered by severity', sorted, severities.join(','));
    } else {
      record('CHECK 3 — empty-state shown (no batch yet, valid per D-705)', emptyShown, emptyShown ? 'empty-state visible' : 'NO cards AND NO empty-state (FAIL)');
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/intel-02-panel-1200.png` });
  }

  await ctx.close();

  // Responsive 375
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await ctx375.newPage();
  const mobErrors = [];
  p.on('console', (m) => { if (m.type() === 'error') mobErrors.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(2000);
  const scrollW = await p.evaluate(() => document.body.scrollWidth);
  record('CHECK 5 — 375px: no horizontal overflow', scrollW <= 377, `scrollWidth=${scrollW}`);
  const handle = p.locator('.panel-handle');
  if ((await handle.count()) > 0) { await handle.click(); await p.waitForTimeout(400); }
  const intel375 = p.locator('.panel-tab', { hasText: 'Inteligencia' });
  if ((await intel375.count()) > 0) { await intel375.click(); await p.waitForTimeout(2000); }
  await p.screenshot({ path: `${SCREENSHOT_DIR}/intel-05-mobile-375.png` });
  const panel375 = await p.locator('.intel-panel').isVisible().catch(() => false);
  record('CHECK 5 — 375px: panel usable', panel375, panel375 ? 'visible' : 'not visible');
  const mobApp = mobErrors.filter((e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon'));
  record('CHECK 5 — 375px: 0 JS errors', mobApp.length === 0, mobApp.length === 0 ? 'clean' : JSON.stringify(mobApp.slice(0, 3)));
  await ctx375.close();
  await browser.close();

  console.log('\n=== E2E SUMMARY ===');
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`TOTAL: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  console.log(`cardCount: ${cardCount}, emptyShown: ${emptyShown}`);
  if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`); }
  console.log('\nVERDICT:', failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length;
}

run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
