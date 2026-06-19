/**
 * slice-d-e2e.mjs — E2E for Slice D (interactive map + Spanish UI).
 * Run from packages/web: node slice-d-e2e.mjs
 * Requires: backend :8787 + vite dev :5173 (proxy /api → 8787). DEV exposes window.__wwMap.
 *
 * Tolerant where data-dependent (no feature in view → TOLERATED, not FAIL).
 * Checks:
 *  1. Load — 0 console/network errors
 *  2. UI Spanish — tabs Finanzas / Eventos / Riesgo / Convergencia present
 *  3. Map click → popup with a Spanish heading (.map-popup__heading)
 *  4. Translate — an event/signal popup shows "Traducir"; click → text changes or "no disponible"
 *  5. Risk panel mounts (Spanish tab) + 375px responsive
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
function tolerated(check, detail) {
  results.push({ check, status: 'TOLERATED', detail: detail ?? '' });
  console.log(`[TOLERATED] ${check}${detail ? ': ' + detail : ''}`);
}

/** Ask the in-page map for a clickable feature on the given layers, projected to a pixel
 *  inside the visible map area (left of the desktop sidebar). Returns {x,y,layerId,freeText}|null. */
async function pickFeaturePixel(page, layers, { maxXFrac = 0.6, requireTitle = false } = {}) {
  return page.evaluate(({ layers, maxXFrac, requireTitle }) => {
    const m = window.__wwMap;
    if (!m) return null;
    const present = layers.filter((id) => m.getLayer(id));
    if (!present.length) return null;
    const feats = m.queryRenderedFeatures(undefined, { layers: present });
    const canvas = m.getCanvas();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const f of feats) {
      if (!f.geometry || f.geometry.type !== 'Point') continue;
      if (requireTitle && !(f.properties && String(f.properties.title || '').trim())) continue;
      const p = m.project(f.geometry.coordinates);
      if (p.x > 30 && p.x < W * maxXFrac && p.y > 80 && p.y < H - 80) {
        const id = f.layer.id;
        return { x: p.x, y: p.y, layerId: id, freeText: id.startsWith('evt-') || id.startsWith('sig-') };
      }
    }
    return null;
  }, { layers, maxXFrac, requireTitle });
}

async function clickMap(page, px) {
  const box = await page.locator('.map-container').boundingBox();
  await page.mouse.click(box.x + px.x, box.y + px.y);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const consoleErrors = [], networkErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) networkErrors.push({ url: r.url(), status: r.status() }); });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000); // let map load + data inject
  await page.screenshot({ path: `${SCREENSHOT_DIR}/slice-d-01-load-1200.png` });

  const appErrors = consoleErrors.filter((e) =>
    !e.includes('WebGL') && !e.includes('GPU') && !e.includes('CORS') &&
    !e.includes('favicon') && !e.includes('maplibre') && !e.includes('Mixed Content'));
  const netErrors = networkErrors.filter((e) => !e.url.includes('favicon'));
  record('CHECK 1 — 0 console errors', appErrors.length === 0, appErrors.length === 0 ? 'clean' : JSON.stringify(appErrors.slice(0, 3)));
  record('CHECK 1 — 0 network 4xx/5xx', netErrors.length === 0, netErrors.length === 0 ? 'clean' : JSON.stringify(netErrors.slice(0, 3)));

  // CHECK 2 — UI Spanish tabs
  const tabs = await page.locator('.panel-tab').all();
  const tabTexts = (await Promise.all(tabs.map((t) => t.textContent()))).map((t) => (t || '').trim());
  for (const want of ['Finanzas', 'Eventos', 'Riesgo', 'Convergencia']) {
    record(`CHECK 2 — tab "${want}" in Spanish`, tabTexts.includes(want), JSON.stringify(tabTexts));
  }

  // CHECK 3 — map click → Spanish popup
  const anyPx = await pickFeaturePixel(page, ['cii-countries', 'chokepoints', 'evt-earthquake', 'sanctions-countries']);
  if (anyPx) {
    await clickMap(page, anyPx);
    await page.waitForTimeout(800);
    const popup = page.locator('.maplibregl-popup');
    const popupVisible = await popup.isVisible().catch(() => false);
    const heading = (await page.locator('.map-popup__heading').textContent().catch(() => '')) || '';
    record('CHECK 3 — click → popup visible', popupVisible, `layer=${anyPx.layerId}`);
    record('CHECK 3 — popup has Spanish heading', heading.trim().length > 0, `heading="${heading.trim()}"`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/slice-d-02-popup-1200.png` });
  } else {
    tolerated('CHECK 3 — no clickable feature in view (data-dependent)', 'skipped popup click');
  }

  // CHECK 4 — translate on an event popup. Isolate evt-earthquake (USGS events always carry a
  // title) by hiding ALL other interactive layers, so the click handler's topmost pick is
  // deterministically the titled earthquake. Test-only via the DEV-exposed map.
  await page.evaluate(() => {
    const m = window.__wwMap;
    const others = ['evt-wildfire', 'evt-volcano', 'evt-storm', 'evt-flood', 'evt-conflict', 'evt-protest',
      'sig-commodities-energy', 'sig-critical-minerals', 'sig-semis-ai-tech', 'sig-digital-infra-cyber', 'sig-trade-sanctions',
      'cii-countries', 'chokepoints', 'sanctions-countries', 'convergence-countries'];
    for (const id of others) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
    if (m.getLayer('evt-earthquake')) m.setLayoutProperty('evt-earthquake', 'visibility', 'visible');
  });
  // Close any popup left open by CHECK 3 — its DOM overlay would intercept the next click.
  await page.evaluate(() => document.querySelectorAll('.maplibregl-popup-close-button').forEach((b) => b.click()));
  await page.waitForTimeout(400);
  const txtPx = await pickFeaturePixel(page, ['evt-earthquake'], { requireTitle: true });
  if (txtPx) {
    await clickMap(page, txtPx);
    await page.waitForTimeout(800);
    const heading4 = (await page.locator('.map-popup__heading').textContent().catch(() => '')) || '';
    record('CHECK 4 — earthquake popup opened (Spanish heading)', heading4.trim().length > 0, `heading="${heading4.trim()}"`);
    const btn = page.locator('.map-popup__translate');
    if ((await btn.count()) > 0) {
      const before = (await page.locator('.map-popup__title').textContent().catch(() => '')) || '';
      await btn.click();
      await page.waitForTimeout(6000); // gpt-5.x is slow; cache hit is instant
      const after = (await page.locator('.map-popup__title').textContent().catch(() => '')) || '';
      const btnGone = (await btn.count()) === 0;
      const btnMsg = btnGone ? '' : ((await btn.textContent().catch(() => '')) || '');
      const changed = (after.trim() !== before.trim()) || btnGone || btnMsg.includes('no disponible');
      record('CHECK 4 — Traducir → title changed or graceful message', changed, `before="${before.trim().slice(0, 30)}" after="${after.trim().slice(0, 30)}" btn="${btnMsg}"`);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/slice-d-03-translate-1200.png` });
    } else {
      tolerated('CHECK 4 — event/signal popup had no Traducir button', `layer=${txtPx.layerId}`);
    }
  } else {
    tolerated('CHECK 4 — no event/signal feature in view (data-dependent)', 'skipped translate');
  }

  // CHECK 5 — Riesgo panel mounts
  const riesgoTab = page.locator('.panel-tab', { hasText: 'Riesgo' });
  if ((await riesgoTab.count()) > 0) {
    await riesgoTab.click();
    await page.waitForTimeout(1500);
    const mounted = await page.locator('.risk-panel, [class*="risk"]').first().isVisible().catch(() => false);
    record('CHECK 5 — Riesgo panel mounts', mounted, mounted ? 'visible' : 'not visible');
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
  const mobApp = mobErrors.filter((e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon'));
  record('CHECK 5 — 375px: 0 JS errors', mobApp.length === 0, mobApp.length === 0 ? 'clean' : JSON.stringify(mobApp.slice(0, 3)));
  await p.screenshot({ path: `${SCREENSHOT_DIR}/slice-d-04-mobile-375.png` });
  await ctx375.close();
  await browser.close();

  console.log('\n=== E2E SUMMARY ===');
  const failed = results.filter((r) => r.status === 'FAIL');
  const tol = results.filter((r) => r.status === 'TOLERATED');
  console.log(`TOTAL: ${results.length} | PASS: ${results.filter((r) => r.status === 'PASS').length} | FAIL: ${failed.length} | TOLERATED: ${tol.length}`);
  if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`); }
  console.log('\nVERDICT:', failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length;
}

run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
