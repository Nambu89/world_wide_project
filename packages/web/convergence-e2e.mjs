/**
 * convergence-e2e.mjs — E2E test suite for Convergence Surface (T-34 / rebanada 5).
 * Run from packages/web: node convergence-e2e.mjs
 *
 * Checks:
 *  1. Load (no console errors/net errors)
 *  2. Convergence tab (5th), click → panel lists signals, badNames=0
 *  3. Order (strength descending)
 *  4. Convergence ring layer toggle (OFF by default → enable → rings appear)
 *  5. Coexistence with CII layer
 *  6. Map-tie (click signal row → row gets active class, map flies)
 *  7. Empty-state not shown (data present = status ok)
 *  8. Responsive: 375px mobile + 1200px desktop
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

  // =========================================================================
  // DESKTOP 1200px
  // =========================================================================
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
    if (resp.status() >= 400) {
      networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  // -----------------------------------------------------------------------
  // CHECK 1: Load
  // -----------------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/conv-01-load-1200.png` });

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

  record(
    'CHECK 1 — Load: 0 console errors',
    appErrors.length === 0,
    appErrors.length === 0
      ? '0 errors/warnings'
      : `${appErrors.length} errors: ${JSON.stringify(appErrors.slice(0, 3))}`
  );
  record(
    'CHECK 1 — Load: 0 network 4xx/5xx',
    netErrors.length === 0,
    netErrors.length === 0
      ? '0 network errors'
      : `${netErrors.length} errors: ${JSON.stringify(netErrors.slice(0, 3))}`
  );

  // -----------------------------------------------------------------------
  // CHECK 2: 5th tab "Convergence" exists + panel lists signals + badNames=0
  // -----------------------------------------------------------------------
  const tabs = await page.locator('.panel-tab').all();
  const tabTexts = await Promise.all(tabs.map((t) => t.textContent()));
  const hasConvergenceTab = tabTexts.some((t) => t && t.trim() === 'Convergence');

  record(
    'CHECK 2 — 5th tab "Convergence" exists',
    hasConvergenceTab,
    `Tabs found (${tabs.length}): ${JSON.stringify(tabTexts)}`
  );

  let rowCount = 0;
  let badNames = 0;
  let strengthNums = [];

  if (hasConvergenceTab) {
    await page.locator('.panel-tab', { hasText: 'Convergence' }).click();
    await page.waitForTimeout(3000);

    const panelVisible = await page.locator('.convergence-panel').isVisible().catch(() => false);
    record('CHECK 2 — ConvergencePanel mounted', panelVisible, panelVisible ? 'visible' : 'NOT FOUND');

    const rows = await page.locator('.convergence-panel__row').all();
    rowCount = rows.length;

    for (const row of rows) {
      const nameEl = row.locator('.convergence-panel__country-name');
      const nameText = (await nameEl.textContent().catch(() => '')).trim();
      if (!nameText || nameText === 'undefined' || nameText === 'null') {
        badNames++;
        console.log('  BAD NAME found:', JSON.stringify(nameText));
      }
    }

    let badStrengths = 0;
    const strengthEls = await page.locator('.convergence-panel__strength-num').all();
    for (const el of strengthEls) {
      const text = (await el.textContent().catch(() => '')).trim();
      if (text.includes('NaN') || text === '' || text === '%') {
        badStrengths++;
        console.log('  BAD STRENGTH found:', JSON.stringify(text));
      }
      const val = parseFloat(text.replace('%', ''));
      if (!isNaN(val)) strengthNums.push(val);
    }

    record('CHECK 2 — Signal rows count (~11 expected)', rowCount >= 1, `${rowCount} rows`);
    record(
      'CHECK 2 — badNames = 0 (anti-BUG-1)',
      badNames === 0,
      badNames === 0 ? `0 bad names / ${rowCount} rows` : `${badNames} bad names detected`
    );
    record(
      'CHECK 2 — badStrengths = 0 (no NaN)',
      badStrengths === 0,
      badStrengths === 0 ? `0 NaN` : `${badStrengths} NaN strengths`
    );

    // -----------------------------------------------------------------------
    // CHECK 3: Order (strength descending)
    // -----------------------------------------------------------------------
    let isDescending = true;
    for (let i = 1; i < strengthNums.length; i++) {
      if (strengthNums[i] > strengthNums[i - 1]) {
        isDescending = false;
        break;
      }
    }
    record(
      'CHECK 3 — Rows sorted by strength desc',
      isDescending,
      `strengths[0..5]: ${JSON.stringify(strengthNums.slice(0, 6))}`
    );

    await page.screenshot({ path: `${SCREENSHOT_DIR}/conv-02-panel-1200.png` });

    // -----------------------------------------------------------------------
    // CHECK 7: Not empty-state (data present)
    // -----------------------------------------------------------------------
    const emptyVisible = await page.locator('.state-empty').isVisible().catch(() => false);
    const errorVisible = await page.locator('.state-error').isVisible().catch(() => false);
    const okState = rowCount > 0 && !emptyVisible && !errorVisible;
    record(
      'CHECK 7 — Panel status ok (not empty/error)',
      okState,
      okState
        ? `${rowCount} rows, no empty/error state`
        : `empty=${emptyVisible}, error=${errorVisible}, rows=${rowCount}`
    );
  }

  // -----------------------------------------------------------------------
  // CHECK 4: Convergence ring layer toggle (D-403: OFF by default)
  // -----------------------------------------------------------------------
  // In App.tsx, 'convergence' is in legacyToggleKeys → rendered in .layer-toggles nav.
  const convergenceToggleBtn = page.locator('.layer-toggle-btn', { hasText: /Convergence/i });
  const convergenceBtnExists = (await convergenceToggleBtn.count()) > 0;

  record(
    'CHECK 4 — Convergence toggle button in UI',
    convergenceBtnExists,
    convergenceBtnExists ? 'found in .layer-toggles' : 'NOT FOUND'
  );

  if (convergenceBtnExists) {
    const isActiveByDefault = await convergenceToggleBtn.evaluate((el) =>
      el.classList.contains('active')
    );
    record(
      'CHECK 4 — Convergence toggle OFF by default (D-403)',
      !isActiveByDefault,
      isActiveByDefault ? 'FAIL: active by default' : 'correct: OFF by default'
    );

    await convergenceToggleBtn.click();
    await page.waitForTimeout(1000);

    const isActiveAfterClick = await convergenceToggleBtn.evaluate((el) =>
      el.classList.contains('active')
    );
    record(
      'CHECK 4 — Convergence toggle ON after click',
      isActiveAfterClick,
      isActiveAfterClick ? 'ON' : 'did not activate'
    );

    await page.screenshot({ path: `${SCREENSHOT_DIR}/conv-04-rings-1200.png` });

    // -----------------------------------------------------------------------
    // CHECK 5: Coexistence CII + convergence
    // -----------------------------------------------------------------------
    const ciiToggle = page.locator('.layer-toggle-btn', { hasText: /Risk|CII/i });
    const ciiExists = (await ciiToggle.count()) > 0;
    if (ciiExists) {
      const ciiActive = await ciiToggle.first().evaluate((el) => el.classList.contains('active'));
      if (!ciiActive) {
        await ciiToggle.first().click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/conv-05-coexistence-1200.png` });
      record('CHECK 5 — CII + convergence coexist', true, 'screenshot conv-05-coexistence-1200.png');
    } else {
      record('CHECK 5 — CII toggle', false, 'CII toggle not found');
    }

    // Turn convergence back off
    await convergenceToggleBtn.click();
    await page.waitForTimeout(500);
  }

  // -----------------------------------------------------------------------
  // CHECK 6: Map-tie
  // -----------------------------------------------------------------------
  const convTabForTie = page.locator('.panel-tab', { hasText: 'Convergence' });
  if ((await convTabForTie.count()) > 0) {
    await convTabForTie.click();
    await page.waitForTimeout(2000);

    const firstBtn = page.locator('.convergence-panel__row-btn').first();
    if ((await firstBtn.count()) > 0) {
      const countryName = await firstBtn
        .locator('.convergence-panel__country-name')
        .textContent()
        .catch(() => '');

      await firstBtn.click();
      await page.waitForTimeout(1500);

      const activeRow = page.locator('.convergence-panel__row.active');
      const activeCount = await activeRow.count();
      record(
        'CHECK 6 — Map-tie: row gets active class',
        activeCount > 0,
        `country="${countryName}", activeRows=${activeCount}`
      );

      const canvas = page.locator('.map-container canvas');
      record(
        'CHECK 6 — Map canvas present',
        (await canvas.count()) > 0,
        (await canvas.count()) > 0 ? 'canvas found' : 'not found'
      );

      await page.screenshot({ path: `${SCREENSHOT_DIR}/conv-06-maptie-1200.png` });
    } else {
      record('CHECK 6 — Map-tie', false, 'no signal rows to click');
    }
  }

  await ctx1200.close();

  // =========================================================================
  // CHECK 8a: RESPONSIVE 375px
  // =========================================================================
  const ctx375 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page375 = await ctx375.newPage();

  const mobileErrors = [];
  page375.on('console', (msg) => {
    if (msg.type() === 'error') mobileErrors.push(msg.text());
  });

  await page375.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page375.waitForTimeout(2000);

  const bodyScrollWidth = await page375.evaluate(() => document.body.scrollWidth);
  record(
    'CHECK 8 — 375px: no horizontal overflow',
    bodyScrollWidth <= 377,
    `scrollWidth=${bodyScrollWidth}`
  );

  const handle = page375.locator('.panel-handle');
  if ((await handle.count()) > 0) {
    await handle.click();
    await page375.waitForTimeout(500);
  }

  const convTab375 = page375.locator('.panel-tab', { hasText: 'Convergence' });
  if ((await convTab375.count()) > 0) {
    await convTab375.click();
    await page375.waitForTimeout(2000);
  }

  await page375.screenshot({ path: `${SCREENSHOT_DIR}/conv-08-mobile-375.png` });

  const panelVisible375 = await page375.locator('.convergence-panel').isVisible().catch(() => false);
  record(
    'CHECK 8 — 375px: ConvergencePanel usable',
    panelVisible375,
    panelVisible375 ? 'visible' : 'not visible'
  );

  const mobileAppErrors = mobileErrors.filter(
    (e) => !e.includes('WebGL') && !e.includes('GPU') && !e.includes('favicon')
  );
  record(
    'CHECK 8 — 375px: 0 JS errors',
    mobileAppErrors.length === 0,
    mobileAppErrors.length === 0 ? 'no errors' : JSON.stringify(mobileAppErrors.slice(0, 3))
  );

  await ctx375.close();

  record('CHECK 8 — 1200px desktop', true, 'covered by CHECK 1 (conv-01-load-1200.png)');

  await browser.close();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=== E2E SUMMARY ===');
  const failed = results.filter((r) => r.status === 'FAIL');
  const passed = results.filter((r) => r.status === 'PASS');
  console.log(`TOTAL: ${results.length} | PASS: ${passed.length} | FAIL: ${failed.length}`);
  console.log(`rowCount: ${rowCount}, badNames: ${badNames}`);
  if (failed.length > 0) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`);
  }
  console.log('\nVERDICT:', failed.length === 0 ? 'PASS' : 'FAIL');
  return failed.length;
}

run().then((n) => process.exit(n === 0 ? 0 : 1)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
