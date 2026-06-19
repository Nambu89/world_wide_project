// packages/web/test/glow.test.ts
// node:test — pure check of the glow-layer derivation (D-1002). No DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glowOf, GLOW_LAYERS, LAYERS } from '../src/map/layers.config.ts';

test('glowOf: -glow suffix + circle-blur + scaled radius + parent toggle', () => {
  const base = LAYERS.find((l) => l.id === 'evt-earthquake');
  assert.ok(base, 'evt-earthquake exists');
  const g = glowOf(base!);
  assert.equal(g.id, 'evt-earthquake-glow');
  assert.equal(g.type, 'circle');
  const paint = g.paint as Record<string, unknown>;
  assert.equal(paint['circle-blur'], 1);
  assert.ok(paint['circle-radius'] !== undefined, 'radius set');
  assert.ok(paint['circle-color'] !== undefined, 'color inherited');
  assert.equal(g.toggleKey, base!.toggleKey, 'toggles with its parent');
  assert.equal(g.source, base!.source, 'same source');
});

test('GLOW_LAYERS: only circle layers (no heatmap), all -glow', () => {
  assert.ok(GLOW_LAYERS.length > 0, 'non-empty');
  assert.ok(
    GLOW_LAYERS.every((l) => l.id.endsWith('-glow') && l.type === 'circle'),
    'every glow layer is a -glow circle',
  );
});
