import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreChokepoints, haversineKm } from '../src/chokepoints.js';
import type { EventRow, SignalRow } from '@www/store';

const now = Date.now();

function evt(lat: number, lon: number, severity: number): EventRow {
  return {
    source: 'gdelt', sourceEventId: `e${lat}-${lon}-${severity}`, eventType: 'conflict',
    category: 'conflict', severity, lat, lon, country: 'IR', title: 't', url: null,
    occurredAt: now, capturedAt: now, rawJson: null,
  };
}

test('haversineKm: same point ≈ 0, antipode-ish is large', () => {
  assert.ok(haversineKm(26.6, 56.4, 26.6, 56.4) < 1);
  assert.ok(haversineKm(26.6, 56.4, 0, 0) > 5000);
});

function sigHormuz(): SignalRow {
  return {
    source: 'gkg', signalId: `s${Math.round(now)}-${Math.random()}`,
    title: 'Crisis escalates in the Strait of Hormuz', url: null, tone: -7,
    themes: 'ECON_OILPRICE', persons: null, organizations: null,
    lat: null, lon: null, country: null, occurredAt: now, capturedAt: now,
    rawJson: null, sections: [],
  };
}

test('scoreChokepoints: events-only near Hormuz → watch (naming required for disrupted, L-5)', () => {
  const events: EventRow[] = [evt(26.7, 56.5, 90), evt(26.5, 56.3, 80), evt(26.6, 56.4, 95)];
  const rows = scoreChokepoints(events, [], now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz, 'hormuz present');
  assert.equal(hormuz.status, 'watch', `expected watch (events alone), score=${hormuz.score}`);
});

test('scoreChokepoints: named negative signals + nearby events → disrupted', () => {
  const events: EventRow[] = [evt(26.7, 56.5, 95), evt(26.5, 56.3, 95), evt(26.6, 56.4, 95)];
  const signals: SignalRow[] = [sigHormuz(), sigHormuz(), sigHormuz()];
  const rows = scoreChokepoints(events, signals, now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz, 'hormuz present');
  assert.equal(hormuz.status, 'disrupted', `expected disrupted, score=${hormuz.score}`);
});

test('scoreChokepoints: proximity-only (no naming) caps at watch even with high score (gate)', () => {
  // Saturate events + nearby negative signals near Hormuz, but NONE name the strait.
  const events: EventRow[] = Array.from({ length: 6 }, (_, i) => evt(26.6 + i * 0.01, 56.4, 95));
  const sigsNear: SignalRow[] = Array.from({ length: 10 }, (_, i) => ({
    source: 'gkg', signalId: `near${i}`, title: 'unrelated regional unrest', url: null, tone: -6,
    themes: null, persons: null, organizations: null, lat: 26.6, lon: 56.4, country: null,
    occurredAt: now, capturedAt: now, rawJson: null, sections: [],
  }));
  const rows = scoreChokepoints(events, sigsNear, now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz, 'hormuz present');
  assert.notEqual(hormuz.status, 'disrupted', `proximity-only must not be disrupted, got ${hormuz.status} score=${hormuz.score}`);
  assert.equal(hormuz.status, 'watch', 'high proximity without naming → watch');
});

test('scoreChokepoints: low-severity events (< floor) do NOT trigger', () => {
  const events: EventRow[] = [evt(26.7, 56.5, 20), evt(26.6, 56.4, 30)];
  const rows = scoreChokepoints(events, [], now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.equal(hormuz.status, 'calm', `minor events ignored, score=${hormuz.score}`);
});

test('scoreChokepoints: no nearby activity → all calm, one row per chokepoint', () => {
  const rows = scoreChokepoints([], [], now);
  assert.ok(rows.length >= 12, `expected ≥12 chokepoints, got ${rows.length}`);
  assert.ok(rows.every((r) => r.status === 'calm'), 'all calm with no data');
});

test('scoreChokepoints: GKG name-match (no coords) still raises score', () => {
  const sig: SignalRow = {
    source: 'gkg', signalId: 's1', title: 'Tensions rise in the Strait of Hormuz',
    url: null, tone: -8, themes: 'ECON_OILPRICE', persons: null, organizations: null,
    lat: null, lon: null, country: null, occurredAt: now, capturedAt: now,
    rawJson: null, sections: [],
  };
  const rows = scoreChokepoints([], [sig], now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz && hormuz.score > 0, 'name-match contributes to score');
});

test('scoreChokepoints: events outside radius do NOT trigger', () => {
  // A conflict in mid-Atlantic (0,0) is far from every chokepoint → all calm.
  const rows = scoreChokepoints([evt(0, 0, 100)], [], now);
  assert.ok(rows.every((r) => r.status === 'calm'), 'far event triggers nothing');
});
