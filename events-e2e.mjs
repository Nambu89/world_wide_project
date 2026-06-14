/**
 * Events-layer E2E — world_wide_project Fase 2 (capa de eventos globales).
 * Verifica el render de la capa de eventos en navegador real (Playwright),
 * en particular que el fix del contrato camelCase (BUG-1) resuelve "0 puntos".
 * Run: node events-e2e.mjs  (requiere server :8787 + web :5173 arriba)
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

async function run() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // ── TEST A: desktop 1200 — events render ────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  wire(page, 'desktop');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(4000); // map WebGL + /api/events fetch

  const canvas = (await page.$('canvas.maplibregl-canvas')) !== null;
  const eventsPanel = (await page.$('.events-panel')) !== null;

  // Wait for the events list OR an explicit state
  await page.waitForFunction(
    () => document.querySelector('.events-panel__list') ||
          document.querySelector('.state-empty') ||
          document.querySelector('.state-error'),
    { timeout: 12000 }
  ).catch(() => {});

  const rowCount = (await page.$$('.events-panel__event-row')).length;
  const typeTexts = await page.$$eval('.events-panel__event-type', (els) =>
    els.map((e) => (e.textContent ?? '').trim()));
  const emptyAfterFilter = (await page.$('.state-empty')) !== null;
  const errorState = (await page.$('.state-error')) !== null;
  const attribution = (await page.$('.events-panel__attribution')) !== null;
  const uniqueTypes = [...new Set(typeTexts)];
  // The bug signature: rows with empty/undefined type text, or zero rows + "all hidden"
  const badTypes = typeTexts.filter((t) => t === '' || t === 'undefined').length;

  await shot(page, 'events-desktop-1200');

  out.tests.events_render_desktop = {
    status: canvas && eventsPanel && rowCount > 0 && badTypes === 0 && !errorState ? 'PASS'
          : (emptyAfterFilter && rowCount === 0) ? 'FAIL_EMPTY' : 'PARTIAL',
    canvas, eventsPanel, rowCount, uniqueTypes, badTypes, emptyAfterFilter, errorState, attribution,
  };

  // ── TEST B: toggle a type off → list shrinks/hides that type ────────────
  let toggleWorks = false;
  const toggles = await page.$$('.events-panel__toggle-btn');
  if (toggles.length > 0 && rowCount > 0) {
    const before = (await page.$$('.events-panel__event-row')).length;
    // turn ALL off by clicking each active toggle
    for (const b of toggles) {
      const active = await b.evaluate((el) => el.classList.contains('active'));
      if (active) { await b.click(); await page.waitForTimeout(80); }
    }
    await page.waitForTimeout(400);
    const afterOff = (await page.$$('.events-panel__event-row')).length;
    // turn first toggle back on
    if (toggles[0]) { await toggles[0].click(); await page.waitForTimeout(400); }
    const afterOn = (await page.$$('.events-panel__event-row')).length;
    toggleWorks = afterOff < before && afterOn >= 0;
    out.tests.toggle = { status: toggleWorks ? 'PASS' : 'PARTIAL', before, afterOff, afterOn, toggleCount: toggles.length };
  } else {
    out.tests.toggle = { status: 'SKIP', reason: 'no toggles or no rows' };
  }
  await page.close();

  // ── TEST C: mobile 375 — drawer + no overflow ───────────────────────────
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mp = await mctx.newPage();
  wire(mp, 'mobile');
  await mp.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await mp.waitForTimeout(3500);
  const mCanvas = (await mp.$('canvas.maplibregl-canvas')) !== null;
  const overflow = await mp.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const collapsed = (await mp.$('.panel-wrapper.collapsed')) !== null;
  let drawerOpens = false;
  const handle = await mp.$('.panel-handle');
  if (handle) {
    await handle.click(); await mp.waitForTimeout(500);
    drawerOpens = (await mp.$('.panel-wrapper:not(.collapsed)')) !== null;
  }
  await shot(mp, 'events-mobile-375');
  out.tests.responsive_mobile = {
    status: mCanvas && !overflow && drawerOpens ? 'PASS' : 'PARTIAL',
    canvas: mCanvas, horizontalOverflow: overflow, collapsedInitially: collapsed, drawerOpens,
  };
  await mp.close();

  await browser.close();
  return out;
}

run().then((r) => {
  console.log('\n===== EVENTS E2E =====');
  console.log(JSON.stringify(r.tests, null, 2));
  console.log('consoleErrors:', r.consoleErrors.length ? JSON.stringify(r.consoleErrors) : '(none)');
  console.log('networkErrors:', r.networkErrors.length ? JSON.stringify(r.networkErrors) : '(none)');
  console.log('screenshots:', r.shots.join(', '));
  const verdict = Object.values(r.tests).every((t) => t.status === 'PASS' || t.status === 'SKIP') && r.consoleErrors.length === 0;
  console.log('VERDICT:', verdict ? 'PASS' : 'REVIEW');
}).catch((e) => { console.error('FATAL', e); process.exit(1); });
