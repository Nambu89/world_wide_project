/**
 * redesign-e2e.mjs — E2E guard for the command-center reskin (Slice 1 / ADR-019).
 * Run from packages/web: node redesign-e2e.mjs  (needs backend :8787 + vite :5173).
 *
 * Asserts the reskin took effect (dark basemap canvas, mono tabs, cyan HUD popup)
 * and didn't regress (0 console errors). Tolerant where data-dependent.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const SHOTS = '../../plans/screenshots';
const results = [];
const rec = (c, p, d) => { results.push({ c, s: p ? 'PASS' : 'FAIL', d: d ?? '' }); console.log(`[${p ? 'PASS' : 'FAIL'}] ${c}${d ? ': ' + d : ''}`); };
const tol = (c, d) => { results.push({ c, s: 'TOL', d }); console.log(`[TOLERATED] ${c}${d ? ': ' + d : ''}`); };

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/redesign-01-load-1200.png` });

  // 1 — no console errors (caught the glow-radius bug)
  const appErr = errs.filter((e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon') && !e.includes('Mixed Content'));
  rec('CHECK 1 — 0 console errors/warnings', appErr.length === 0, appErr.length ? JSON.stringify(appErr.slice(0, 2)) : 'clean');

  // 2 — basemap canvas present (CARTO vector renders to canvas)
  const canvas = await page.locator('.map-container canvas').count();
  rec('CHECK 2 — map canvas present', canvas > 0, `canvas=${canvas}`);

  // 3 — active tab uses monospace (HUD chrome)
  const tabFont = await page.locator('.panel-tab.active').first().evaluate((el) => getComputedStyle(el).fontFamily).catch(() => '');
  rec('CHECK 3 — active tab is monospace', /mono|consolas|cascadia/i.test(tabFont), tabFont.slice(0, 40));

  // 4 — open a popup, assert HUD cyan border (rgb 34,211,238)
  const px = await page.evaluate(() => {
    const m = window.__wwMap; if (!m) return null;
    const f = m.queryRenderedFeatures(undefined, { layers: ['chokepoints', 'cii-countries', 'sanctions-countries'].filter((id) => m.getLayer(id)) })[0];
    if (!f || f.geometry.type !== 'Point') return null;
    const p = m.project(f.geometry.coordinates); return { x: p.x, y: p.y };
  });
  if (px) {
    const box = await page.locator('.map-container').boundingBox();
    await page.mouse.click(box.x + px.x, box.y + px.y);
    await page.waitForTimeout(700);
    const border = await page.locator('.maplibregl-popup-content').first().evaluate((el) => getComputedStyle(el).borderColor).catch(() => '');
    rec('CHECK 4 — popup HUD cyan border', border.includes('34, 211, 238'), `border=${border}`);
    await page.screenshot({ path: `${SHOTS}/redesign-02-popup-1200.png` });
  } else {
    tol('CHECK 4 — no feature in view (data-dependent)', 'skipped popup border');
  }
  await ctx.close();

  // 5 — 375px no overflow
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p = await ctx375.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(1500);
  const sw = await p.evaluate(() => document.body.scrollWidth);
  rec('CHECK 5 — 375px no horizontal overflow', sw <= 377, `scrollWidth=${sw}`);
  await p.screenshot({ path: `${SHOTS}/redesign-03-mobile-375.png` });
  await ctx375.close();
  await browser.close();

  const fail = results.filter((r) => r.s === 'FAIL');
  console.log(`\n=== REDESIGN E2E === TOTAL ${results.length} | PASS ${results.filter((r) => r.s === 'PASS').length} | FAIL ${fail.length} | TOL ${results.filter((r) => r.s === 'TOL').length}`);
  console.log('VERDICT:', fail.length === 0 ? 'PASS' : 'FAIL');
  return fail.length;
}
run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
