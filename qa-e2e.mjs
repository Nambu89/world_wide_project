/**
 * QA E2E script — world_wide_project MVP Finanzas
 * Run with: node qa-e2e.mjs  (from project root)
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
const SCREENSHOTS_DIR = join(__dirname, 'plans', 'screenshots');

const results = {
  consoleErrors: [],
  consoleWarnings: [],
  networkErrors: [],
  tests: {},
  screenshots: [],
};

async function takeScreenshot(page, name) {
  const path = join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  results.screenshots.push(path);
  console.log(`[SCREENSHOT] ${path}`);
  return path;
}

async function runTests() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
  });

  // -----------------------------------------------------------------------
  // TEST 1: Carga inicial (desktop 1200x800)
  // -----------------------------------------------------------------------
  console.log('\n=== TEST 1: Carga inicial (1200x800) ===');
  const page = await context.newPage();

  const consoleErrorsAtLoad = [];

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      consoleErrorsAtLoad.push(text);
      results.consoleErrors.push(text);
    }
    if (type === 'warning' || type === 'warn') {
      results.consoleWarnings.push(text);
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400) {
      results.networkErrors.push({ url, status });
    }
  });

  page.on('pageerror', (err) => {
    results.consoleErrors.push(`PAGE_ERROR: ${err.message}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });

  // Wait extra for map init (WebGL can be slow)
  await page.waitForTimeout(4000);

  // Check for map canvas (WebGL)
  const canvas = await page.$('canvas.maplibregl-canvas');
  const hasCanvas = canvas !== null;
  console.log(`  Canvas WebGL (maplibregl-canvas): ${hasCanvas}`);

  // Check app layout renders (no white screen)
  const appLayout = await page.$('.app-layout');
  const hasAppLayout = appLayout !== null;
  console.log(`  .app-layout renderizado: ${hasAppLayout}`);

  // Check panel wrapper present
  const panelWrapper = await page.$('.panel-wrapper');
  const hasPanelWrapper = panelWrapper !== null;
  console.log(`  .panel-wrapper presente: ${hasPanelWrapper}`);

  // Check layer toggle nav
  const layerTogglesNav = await page.$('nav.layer-toggles');
  console.log(`  nav.layer-toggles presente: ${layerTogglesNav !== null}`);

  await takeScreenshot(page, 'test1-carga-desktop-1200');

  results.tests['carga_desktop'] = {
    status: hasCanvas && hasAppLayout ? 'PASS' : 'FAIL',
    canvas: hasCanvas,
    appLayout: hasAppLayout,
    panelWrapper: hasPanelWrapper,
    layerToggles: layerTogglesNav !== null,
    consoleErrorsAtLoad: [...consoleErrorsAtLoad],
  };

  // -----------------------------------------------------------------------
  // TEST 2: Panel Finanzas — markets list + sparkline
  // -----------------------------------------------------------------------
  console.log('\n=== TEST 2: Panel Finanzas (markets) ===');

  // On desktop the panel-wrapper starts as collapsed, need to expand (ADR-008)
  // Check if collapsed class is present
  const panelCollapsed = await page.$('.panel-wrapper.collapsed');
  if (panelCollapsed) {
    console.log('  Panel colapsado — expandiendo via handle click...');
    const handle = await page.$('.panel-handle');
    if (handle) {
      await handle.click();
      await page.waitForTimeout(600);
    }
  }

  // Wait for the instrument list or any state indicator
  await page.waitForFunction(
    () =>
      document.querySelector('.instrument-list') ||
      document.querySelector('.state-error') ||
      document.querySelector('.state-empty'),
    { timeout: 10000 }
  ).catch(() => console.log('  WARN: instrument-list/error/empty no apareció en 10s'));

  const loadingState = await page.$('.state-loading');
  const errorState = await page.$('.state-error');
  const emptyState = await page.$('.state-empty');
  const instrumentList = await page.$('.instrument-list');

  console.log(`  state-loading: ${loadingState !== null}`);
  console.log(`  state-error: ${errorState !== null}`);
  console.log(`  state-empty: ${emptyState !== null}`);
  console.log(`  instrument-list: ${instrumentList !== null}`);

  let instrumentCount = 0;
  let instrumentSymbols = [];
  if (instrumentList) {
    const cards = await page.$$('.instrument-card');
    instrumentCount = cards.length;
    instrumentSymbols = await page.$$eval(
      '.instrument-card__symbol',
      (els) => els.map((e) => e.textContent ?? '')
    );
    console.log(`  Instrumentos renderizados: ${instrumentCount}`);
    console.log(`  Simbolos: ${instrumentSymbols.join(', ')}`);
  }

  await takeScreenshot(page, 'test2-panel-finanzas-list');

  // Sub-test 2b: Sparkline on click
  let sparklineShown = false;
  let sparklineHasCanvas = false;
  let sparklineHasEmptyState = false;
  if (instrumentList && instrumentCount > 0) {
    console.log('  Sub-test 2b: Sparkline (click primer instrumento)...');
    const firstCard = await page.$('.instrument-card');
    await firstCard.click();
    await page.waitForTimeout(3000); // wait for fetch

    sparklineShown = (await page.$('.sparkline-area')) !== null;
    sparklineHasCanvas = (await page.$('.sparkline-canvas')) !== null;
    sparklineHasEmptyState = (await page.$('.sparkline-loading')) !== null;

    console.log(`  .sparkline-area: ${sparklineShown}`);
    console.log(`  .sparkline-canvas: ${sparklineHasCanvas}`);
    console.log(`  .sparkline-loading (empty/no data): ${sparklineHasEmptyState}`);

    await takeScreenshot(page, 'test2b-sparkline');
  }

  results.tests['panel_finanzas'] = {
    status:
      instrumentList !== null && instrumentCount >= 7
        ? 'PASS'
        : instrumentCount > 0
        ? 'PARTIAL'
        : 'FAIL',
    instrumentCount,
    instrumentSymbols,
    sparklineShown,
    sparklineHasCanvas,
    sparklineHasEmptyState,
    errorState: errorState !== null,
    emptyState: emptyState !== null,
  };

  // -----------------------------------------------------------------------
  // TEST 3: Toggle de capa GDELT
  // -----------------------------------------------------------------------
  console.log('\n=== TEST 3: Toggle de capa GDELT ===');

  // Deselect instrument first
  const selectedCard = await page.$('.instrument-card.selected');
  if (selectedCard) await selectedCard.click();
  await page.waitForTimeout(300);

  const toggleButtons = await page.$$('.layer-toggle-btn');
  const toggleCount = toggleButtons.length;
  console.log(`  Botones toggle encontrados: ${toggleCount}`);

  let gdeltToggleFound = false;
  let gdeltToggleLabel = null;
  let toggleStateChangedOff = false;
  let toggleStateChangedOn = false;

  for (const btn of toggleButtons) {
    const label = (await btn.textContent()) ?? '';
    const ariaLabel = (await btn.getAttribute('aria-label')) ?? '';
    console.log(`  Toggle button: label="${label}" | aria-label="${ariaLabel}"`);

    const isGdelt =
      label.toLowerCase().includes('events') ||
      ariaLabel.toLowerCase().includes('gdelt') ||
      label.toLowerCase().includes('gdelt');

    if (isGdelt) {
      gdeltToggleFound = true;
      gdeltToggleLabel = label;

      const wasActive = await btn.evaluate((el) => el.classList.contains('active'));
      const ariaPressedInitial = await btn.getAttribute('aria-pressed');
      console.log(
        `  Estado inicial — .active: ${wasActive}, aria-pressed: ${ariaPressedInitial}`
      );

      // Click OFF
      await btn.click();
      await page.waitForTimeout(600);
      const isActiveAfterOff = await btn.evaluate((el) => el.classList.contains('active'));
      const ariaPressedOff = await btn.getAttribute('aria-pressed');
      console.log(
        `  Tras click 1 (off) — .active: ${isActiveAfterOff}, aria-pressed: ${ariaPressedOff}`
      );
      toggleStateChangedOff = wasActive !== isActiveAfterOff;

      await takeScreenshot(page, 'test3-toggle-off');

      // Click ON
      await btn.click();
      await page.waitForTimeout(600);
      const isActiveAfterOn = await btn.evaluate((el) => el.classList.contains('active'));
      const ariaPressedOn = await btn.getAttribute('aria-pressed');
      console.log(
        `  Tras click 2 (on) — .active: ${isActiveAfterOn}, aria-pressed: ${ariaPressedOn}`
      );
      toggleStateChangedOn = isActiveAfterOn === wasActive;

      await takeScreenshot(page, 'test3-toggle-on');
      break;
    }
  }

  results.tests['layer_toggle'] = {
    status:
      gdeltToggleFound && toggleStateChangedOff && toggleStateChangedOn ? 'PASS' : gdeltToggleFound ? 'PARTIAL' : 'FAIL',
    gdeltToggleFound,
    gdeltToggleLabel,
    toggleCount,
    toggleStateChangedOff,
    toggleStateChangedOn,
  };

  await page.close();

  // -----------------------------------------------------------------------
  // TEST 4a: Responsive — Mobile 375x812
  // -----------------------------------------------------------------------
  console.log('\n=== TEST 4a: Responsive — Mobile (375x812) ===');
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 375, height: 812 });

  mobilePage.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(`[mobile] ${msg.text()}`);
  });
  mobilePage.on('pageerror', (err) => {
    results.consoleErrors.push(`[mobile] PAGE_ERROR: ${err.message}`);
  });

  await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await mobilePage.waitForTimeout(3000);

  const mobileCanvas = await mobilePage.$('canvas.maplibregl-canvas');
  const mobileAppLayout = await mobilePage.$('.app-layout');
  const mobilePanelWrapperEl = await mobilePage.$('.panel-wrapper');
  const mobilePanelCollapsed = await mobilePage.$('.panel-wrapper.collapsed');

  console.log(`  Canvas WebGL: ${mobileCanvas !== null}`);
  console.log(`  .app-layout: ${mobileAppLayout !== null}`);
  console.log(`  Panel wrapper: ${mobilePanelWrapperEl !== null}`);
  console.log(
    `  Panel colapsado inicialmente: ${mobilePanelCollapsed !== null} (esperado: true)`
  );

  // Check horizontal overflow
  const mobileOverflow = await mobilePage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasHorizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log(
    `  Overflow horizontal: ${mobileOverflow.hasHorizontalOverflow} (scroll=${mobileOverflow.scrollWidth}, client=${mobileOverflow.clientWidth})`
  );

  // Check touch target size of layer toggle
  const mobileToggleBtnSize = await mobilePage.evaluate(() => {
    const btn = document.querySelector('.layer-toggle-btn');
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  console.log(`  Toggle btn size (touch target): ${JSON.stringify(mobileToggleBtnSize)}`);

  // Check panel-handle is visible on mobile
  const mobileHandleVisible = await mobilePage.evaluate(() => {
    const handle = document.querySelector('.panel-handle');
    if (!handle) return false;
    const s = window.getComputedStyle(handle);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  });
  console.log(`  .panel-handle visible en mobile: ${mobileHandleVisible} (esperado: true)`);

  await takeScreenshot(mobilePage, 'test4a-mobile-375-closed');

  // Expand drawer
  let mobileDrawerOpened = false;
  const mobileHandle = await mobilePage.$('.panel-handle');
  if (mobileHandle) {
    await mobileHandle.click();
    await mobilePage.waitForTimeout(500);
    const afterExpand = await mobilePage.$('.panel-wrapper:not(.collapsed)');
    mobileDrawerOpened = afterExpand !== null;
    console.log(`  Drawer abierto tras click: ${mobileDrawerOpened}`);

    await mobilePage.waitForTimeout(500);
    await takeScreenshot(mobilePage, 'test4a-mobile-375-panel-open');

    // Verify map canvas still exists (not destroyed by panel)
    const canvasAfterOpen = await mobilePage.$('canvas.maplibregl-canvas');
    console.log(`  Canvas existe tras abrir panel: ${canvasAfterOpen !== null}`);
  }

  results.tests['responsive_mobile'] = {
    status:
      mobileCanvas !== null &&
      !mobileOverflow.hasHorizontalOverflow &&
      mobilePanelCollapsed !== null &&
      mobileDrawerOpened
        ? 'PASS'
        : 'PARTIAL',
    canvas: mobileCanvas !== null,
    appLayout: mobileAppLayout !== null,
    panelCollapsedInitially: mobilePanelCollapsed !== null,
    drawerOpens: mobileDrawerOpened,
    handleVisible: mobileHandleVisible,
    horizontalOverflow: mobileOverflow.hasHorizontalOverflow,
    toggleBtnSize: mobileToggleBtnSize,
  };

  await mobilePage.close();

  // -----------------------------------------------------------------------
  // TEST 4b: Responsive — Desktop 1200x800
  // -----------------------------------------------------------------------
  console.log('\n=== TEST 4b: Responsive — Desktop (1200x800) ===');
  const desktopPage = await context.newPage();
  await desktopPage.setViewportSize({ width: 1200, height: 800 });

  desktopPage.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(`[desktop] ${msg.text()}`);
  });

  await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await desktopPage.waitForTimeout(3000);

  const desktopCanvas = await desktopPage.$('canvas.maplibregl-canvas');
  const desktopPanelCollapsed = await desktopPage.$('.panel-wrapper.collapsed');

  const desktopHandleVisible = await desktopPage.evaluate(() => {
    const handle = document.querySelector('.panel-handle');
    if (!handle) return null;
    const s = window.getComputedStyle(handle);
    return {
      display: s.display,
      visibility: s.visibility,
      isVisible: s.display !== 'none' && s.visibility !== 'hidden',
    };
  });

  const desktopOverflow = await desktopPage.evaluate(() => ({
    hasHorizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));

  console.log(`  Canvas WebGL: ${desktopCanvas !== null}`);
  console.log(`  Panel colapsado: ${desktopPanelCollapsed !== null} (esperado: false en desktop)`);
  console.log(`  panel-handle visible: ${JSON.stringify(desktopHandleVisible)}`);
  console.log(`  Overflow horizontal: ${desktopOverflow.hasHorizontalOverflow}`);

  await takeScreenshot(desktopPage, 'test4b-desktop-1200');

  results.tests['responsive_desktop'] = {
    status:
      desktopCanvas !== null &&
      !desktopOverflow.hasHorizontalOverflow
        ? 'PASS'
        : 'FAIL',
    canvas: desktopCanvas !== null,
    panelCollapsed: desktopPanelCollapsed !== null,
    handleVisible: desktopHandleVisible,
    horizontalOverflow: desktopOverflow.hasHorizontalOverflow,
  };

  await desktopPage.close();
  await browser.close();

  return results;
}

runTests()
  .then((results) => {
    console.log('\n\n========== RESULTADOS BRUTOS QA E2E ==========');
    console.log(JSON.stringify(results, null, 2));
    console.log('\n=== VEREDICTO POR TEST ===');
    for (const [name, data] of Object.entries(results.tests)) {
      console.log(`  ${name}: ${data.status}`);
    }
    console.log('\n=== ERRORES DE CONSOLA ===');
    if (results.consoleErrors.length === 0) {
      console.log('  (ninguno)');
    } else {
      results.consoleErrors.forEach((e) => console.log(`  ERROR: ${e}`));
    }
    console.log('\n=== WARNINGS DE CONSOLA ===');
    if (results.consoleWarnings.length === 0) {
      console.log('  (ninguno)');
    } else {
      results.consoleWarnings.forEach((w) => console.log(`  WARN: ${w}`));
    }
    console.log('\n=== ERRORES DE RED (4xx/5xx) ===');
    if (results.networkErrors.length === 0) {
      console.log('  (ninguno)');
    } else {
      results.networkErrors.forEach((e) => console.log(`  ${e.status} ${e.url}`));
    }
    console.log('\n=== SCREENSHOTS ===');
    results.screenshots.forEach((s) => console.log(`  ${s}`));
  })
  .catch((err) => {
    console.error('ERROR FATAL en QA runner:', err);
    process.exit(1);
  });
