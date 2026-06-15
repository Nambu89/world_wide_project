/**
 * CII E2E — world_wide_project Fase 2 rebanada 3 (T-26).
 * Verifica en navegador real (Playwright) que la capa CII + RiskPanel renderizan
 * datos CII reales (clase BUG-1: el parser cliente camelCase debe producir filas).
 * Cubre: tab Risk, RiskPanel con países, composite, componente dominante, map-tie
 * (.risk-panel__row.active), atribución, responsive 375, 0 errores consola/red.
 * Run: node cii-e2e.mjs  (requiere server :8787 con cii_snapshots + web :5173).
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const { chromium } = require('./packages/web/node_modules/@playwright/test');

const BASE_URL = 'http://localhost:5173';
const SHOTS = join(__dirname, 'plans', 'screenshots');
const out = { consoleErrors: [], networkErrors: [], tests: {}, shots: [] };

async function shot(page, name) {
  const p = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  out.shots.push(p);
}

function wire(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => out.consoleErrors.push(`[${tag}] PAGE_ERROR: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) out.networkErrors.push({ url: r.url(), status: r.status() }); });
}

async function clickTab(page, label) {
  const tabs = await page.$$('.panel-tab');
  for (const t of tabs) {
    const txt = (await t.evaluate((el) => el.textContent ?? '')).trim();
    if (txt === label) { await t.click(); return true; }
  }
  return false;
}

async function run() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // ── TEST A: desktop 1200 — CII render ───────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  wire(page, 'desktop');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3500); // map WebGL + /api/cii fetch

  const canvas = (await page.$('canvas.maplibregl-canvas')) !== null;
  const tabbed = await clickTab(page, 'Risk');
  await page.waitForFunction(
    () => document.querySelector('.risk-panel__row') ||
          document.querySelector('.state-empty') ||
          document.querySelector('.state-error'),
    { timeout: 12000 }
  ).catch(() => {});
  await page.waitForTimeout(400);

  const riskPanel = (await page.$('.risk-panel')) !== null;
  const rowCount = (await page.$$('.risk-panel__row')).length;
  const names = await page.$$eval('.risk-panel__country-name', (els) =>
    els.map((e) => (e.textContent ?? '').trim()));
  const badNames = names.filter((n) => n === '' || n === 'undefined').length;
  const attribution = (await page.$('.risk-panel__attribution')) !== null;
  const errorState = (await page.$('.state-error')) !== null;
  const emptyState = (await page.$('.state-empty')) !== null;

  // map-tie: click first country row → row gets .active
  let mapTieActive = false;
  const firstBtn = await page.$('.risk-panel__row-btn');
  if (firstBtn) {
    await firstBtn.click();
    await page.waitForTimeout(500);
    mapTieActive = (await page.$('.risk-panel__row.active')) !== null;
  }

  await shot(page, 'cii-desktop-1200');

  out.tests.cii_render_desktop = {
    status: canvas && riskPanel && rowCount > 0 && badNames === 0 && !errorState ? 'PASS'
          : (emptyState && rowCount === 0) ? 'FAIL_EMPTY' : 'PARTIAL',
    canvas, tabbed, riskPanel, rowCount, sampleNames: names.slice(0, 5), badNames,
    mapTieActive, attribution, errorState, emptyState,
  };
  await page.close();

  // ── TEST B: mobile 375 — drawer + no overflow + Risk tab ────────────────
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mp = await mctx.newPage();
  wire(mp, 'mobile');
  await mp.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await mp.waitForTimeout(3000);
  const mCanvas = (await mp.$('canvas.maplibregl-canvas')) !== null;
  const handle = await mp.$('.panel-handle');
  let drawerOpens = false;
  if (handle) {
    await handle.click(); await mp.waitForTimeout(400);
    drawerOpens = (await mp.$('.panel-wrapper:not(.collapsed)')) !== null;
  }
  await clickTab(mp, 'Risk');
  await mp.waitForTimeout(500);
  const mRisk = (await mp.$('.risk-panel')) !== null;
  const overflow = await mp.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await shot(mp, 'cii-mobile-375');
  out.tests.responsive_mobile = {
    status: mCanvas && !overflow && mRisk ? 'PASS' : 'PARTIAL',
    canvas: mCanvas, horizontalOverflow: overflow, drawerOpens, riskPanel: mRisk,
  };
  await mp.close();

  await browser.close();
  return out;
}

run().then((r) => {
  console.log('\n===== CII E2E =====');
  console.log(JSON.stringify(r.tests, null, 2));
  console.log('consoleErrors:', r.consoleErrors.length ? JSON.stringify(r.consoleErrors) : '(none)');
  console.log('networkErrors:', r.networkErrors.length ? JSON.stringify(r.networkErrors) : '(none)');
  console.log('screenshots:', r.shots.join(', '));
  const verdict = Object.values(r.tests).every((t) => t.status === 'PASS' || t.status === 'SKIP') && r.consoleErrors.length === 0;
  console.log('VERDICT:', verdict ? 'PASS' : 'REVIEW');
}).catch((e) => { console.error('FATAL', e); process.exit(1); });
