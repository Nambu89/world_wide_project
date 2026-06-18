// packages/web/test/popup.test.ts
// node:test runner — tests the PURE popupRows model (no DOM; buildPopupNode is E2E-covered).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popupRows } from '../src/map/popup.ts';

test('popupRows: event → ES heading, localized country, translatable title', () => {
  const m = popupRows(
    { event_type: 'earthquake', severity: 78, country: 'Japan', source: 'usgs', occurred_at: '2026-06-18T00:00:00Z', title: 'M5.4 quake off Honshu' },
    'evt-earthquake',
  );
  assert.equal(m.heading, 'Terremoto');
  assert.equal(m.title, 'M5.4 quake off Honshu'); // free-text → translatable
  const pais = m.rows.find((r) => r.label === 'País');
  assert.equal(pais?.value, 'Japón'); // localized
  assert.ok(m.rows.some((r) => r.label === 'Severidad' && r.value === '78'));
});

test('popupRows: signal → section heading + translatable title', () => {
  const m = popupRows(
    { section: 'commodities_energy', tone: -4.2, country: 'Iran', source: 'gkg', title: 'oil prices surge' },
    'sig-commodities-energy',
  );
  assert.equal(m.heading, 'Materias primas y energía');
  assert.equal(m.title, 'oil prices surge');
});

test('popupRows: CII → no title (not translatable), Spanish band', () => {
  const m = popupRows({ country: 'Russia', composite: 64, band: 'elevated', dominantComponent: 'conflict' }, 'cii-countries');
  assert.equal(m.heading, 'Riesgo país (CII)');
  assert.equal(m.title, null); // structured → no Traducir button
  assert.ok(m.rows.some((r) => r.label === 'Banda' && r.value === 'Elevado'));
  assert.ok(m.rows.some((r) => r.label === 'País' && r.value === 'Rusia'));
});

test('popupRows: chokepoint → nameEs heading, no title', () => {
  const m = popupRows({ id: 'hormuz', nameEs: 'Estrecho de Ormuz', status: 'disrupted', score: 1 }, 'chokepoints');
  assert.equal(m.heading, 'Estrecho de Ormuz');
  assert.equal(m.title, null);
  assert.ok(m.rows.some((r) => r.label === 'Estado' && r.value === 'Disrupción'));
});
