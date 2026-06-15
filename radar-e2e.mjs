/**
 * Radar geoeconómico E2E — world_wide_project Fase 2 rebanada 2 (T-20).
 * Verifica en navegador real (Playwright) que el RadarPanel renderiza señales GKG
 * (clase BUG-1: el parser cliente camelCase debe producir filas, no 0).
 * Cubre: tab Radar, 6 secciones, expand→headlines, map-tie (.active), atribución,
 * responsive 375, 0 errores consola/red.
 * Run: node radar-e2e.mjs  (requiere server :8787 con signals poblados + web :5173).
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

async function clickTabRadar(page) {
  const tabs = await page.$$('.panel-tab');
  for (const t of tabs) {
    const txt = (await t.evaluate((el) => el.textContent ?? '')).trim();
    if (txt === 'Radar') { await t.click(); return true; }
  }
  return false;
}

async function run() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // ── TEST A: desktop 1200 — radar render ─────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  wire(page, 'desktop');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3500); // map WebGL + signals fetch into source

  const canvas = (await page.$('canvas.maplibregl-canvas')) !== null;
  const tabbed = await clickTabRadar(page);
  await page.waitForTimeout(600);

  const radarPanel = (await page.$('.radar-panel')) !== null;
  const sectionCount = (await page.$$('.radar-panel__section')).length;
  const attribution = (await page.$('.radar-panel__attribution')) !== null;
  const sectionLabels = await page.$$eval('.radar-panel__section-label', (els) =>
    els.map((e) => (e.textContent ?? '').trim()));

  // Expand "Commodities & Energy" (known to have data: 224 signals)
  let headlineCount = 0;
  let badHeadlines = 0;
  let sectionActive = false;
  let emptyState = false;
  let errorState = false;
  const hdrs = await page.$$('.radar-panel__section-hdr');
  let targetHdr = null;
  for (const h of hdrs) {
    const lbl = (await h.evaluate((el) => el.textContent ?? '')).trim();
    if (lbl.includes('Commodities')) { targetHdr = h; break; }
  }
  if (targetHdr) {
    await targetHdr.click();
    await page.waitForFunction(
      () => document.querySelector('.radar-panel__headline-row') ||
            document.querySelector('.state-empty') ||
            document.querySelector('.state-error'),
      { timeout: 12000 }
    ).catch(() => {});
    await page.waitForTimeout(500);
    headlineCount = (await page.$$('.radar-panel__headline-row')).length;
    const titles = await page.$$eval('.radar-panel__headline-title', (els) =>
      els.map((e) => (e.textContent ?? '').trim()));
    badHeadlines = titles.filter((t) => t === '' || t === 'undefined').length;
    sectionActive = (await page.$('.radar-panel__section.active')) !== null;
    emptyState = (await page.$('.state-empty')) !== null;
    errorState = (await page.$('.state-error')) !== null;
  }

  await shot(page, 'radar-desktop-1200');

  out.tests.radar_render_desktop = {
    status: canvas && radarPanel && sectionCount === 6 && headlineCount > 0 && badHeadlines === 0 && !errorState ? 'PASS'
          : (emptyState && headlineCount === 0) ? 'FAIL_EMPTY' : 'PARTIAL',
    canvas, tabbed, radarPanel, sectionCount, sectionLabels, headlineCount, badHeadlines,
    mapTieActive: sectionActive, emptyState, errorState, attribution,
  };
  await page.close();

  // ── TEST B: mobile 375 — drawer + no overflow + radar tab ───────────────
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mp = await mctx.newPage();
  wire(mp, 'mobile');
  await mp.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await mp.waitForTimeout(3000);
  const mCanvas = (await mp.$('canvas.maplibregl-canvas')) !== null;
  // open drawer if collapsed
  const handle = await mp.$('.panel-handle');
  let drawerOpens = false;
  if (handle) {
    await handle.click(); await mp.waitForTimeout(400);
    drawerOpens = (await mp.$('.panel-wrapper:not(.collapsed)')) !== null;
  }
  await clickTabRadar(mp);
  await mp.waitForTimeout(400);
  const mRadar = (await mp.$('.radar-panel')) !== null;
  const overflow = await mp.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await shot(mp, 'radar-mobile-375');
  out.tests.responsive_mobile = {
    status: mCanvas && !overflow && mRadar ? 'PASS' : 'PARTIAL',
    canvas: mCanvas, horizontalOverflow: overflow, drawerOpens, radarPanel: mRadar,
  };
  await mp.close();

  await browser.close();
  return out;
}

run().then((r) => {
  console.log('\n===== RADAR E2E =====');
  console.log(JSON.stringify(r.tests, null, 2));
  console.log('consoleErrors:', r.consoleErrors.length ? JSON.stringify(r.consoleErrors) : '(none)');
  console.log('networkErrors:', r.networkErrors.length ? JSON.stringify(r.networkErrors) : '(none)');
  console.log('screenshots:', r.shots.join(', '));
  const verdict = Object.values(r.tests).every((t) => t.status === 'PASS' || t.status === 'SKIP') && r.consoleErrors.length === 0;
  console.log('VERDICT:', verdict ? 'PASS' : 'REVIEW');
}).catch((e) => { console.error('FATAL', e); process.exit(1); });
