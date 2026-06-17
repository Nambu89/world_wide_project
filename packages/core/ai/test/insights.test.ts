// Ephemeral DB — set before the @www/store import chain creates the (lazy) singleton.
process.env['LIBSQL_URL'] = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInsights, buildIntelContext, buildChokepointContext, generateInsights } from '../src/insights.js';
import { _resetDbForTesting, migrate, saveBriefing } from '@www/store';

test('parseInsights: valid JSON array', () => {
  const txt = JSON.stringify([{ id: 'a', title: 'Ormuz', category: 'energia', triggers: ['hormuz'], consequences: ['petróleo↑'], affected: ['UE'], severity: 'alta', confidence: 'media' }]);
  const r = parseInsights(txt);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Ormuz');
  assert.equal(r[0].severity, 'alta');
});

test('parseInsights: parses countries/chokepoints; defaults to [] when absent', () => {
  const withEnt = parseInsights(JSON.stringify([{ title: 'A', consequences: ['x'], countries: ['Iraq'], chokepoints: ['hormuz'] }]));
  assert.deepEqual(withEnt[0].countries, ['Iraq']);
  assert.deepEqual(withEnt[0].chokepoints, ['hormuz']);
  const without = parseInsights(JSON.stringify([{ title: 'B', consequences: ['y'] }]));
  assert.deepEqual(without[0].countries, []);
  assert.deepEqual(without[0].chokepoints, []);
});

test('parseInsights: strips ```json fences', () => {
  const r = parseInsights('```json\n[{"title":"X","consequences":["y"]}]\n```');
  assert.equal(r.length, 1);
  assert.equal(r[0].category, 'otro'); // default
  assert.equal(r[0].severity, 'media'); // default
});

test('parseInsights: accepts {insights:[...]} wrapper', () => {
  const r = parseInsights('{"insights":[{"title":"X","consequences":["y"]}]}');
  assert.equal(r.length, 1);
});

test('parseInsights: drops cards missing title or consequences', () => {
  const r = parseInsights(JSON.stringify([{ title: '', consequences: ['y'] }, { title: 'ok', consequences: [] }, { title: 'good', consequences: ['z'] }]));
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'good');
});

test('parseInsights: garbage → []', () => {
  assert.deepEqual(parseInsights('not json at all'), []);
  assert.deepEqual(parseInsights(''), []);
});

test('parseInsights: salvages complete cards from truncated JSON (L-5)', () => {
  // Array cut off at maxTokens mid-third-card → first two complete cards recovered.
  const truncated = '[{"title":"A","consequences":["x"]},{"title":"B","consequences":["y"]},{"title":"C","conseq';
  const r = parseInsights(truncated);
  assert.equal(r.length, 2, 'recovers the 2 complete cards, drops the cut one');
  assert.equal(r[0].title, 'A');
  assert.equal(r[1].title, 'B');
});

test('buildChokepointContext: only disrupted/watch, sorted by score', () => {
  const ctx = buildChokepointContext([
    { chokepointId: 'suez', status: 'watch', score: 0.4 },
    { chokepointId: 'hormuz', status: 'disrupted', score: 0.9 },
    { chokepointId: 'panama', status: 'calm', score: 0.05 },
  ]);
  assert.ok(ctx.includes('hormuz'));
  assert.ok(ctx.includes('suez'));
  assert.ok(!ctx.includes('panama'), 'calm excluded');
  assert.ok(ctx.indexOf('hormuz') < ctx.indexOf('suez'), 'sorted by score desc');
});

test('buildIntelContext: empty inputs → empty string', () => {
  assert.equal(buildIntelContext([], [], [], [], []), '');
});

test('generateInsights: serves cached batch without calling the LLM (cache short-circuit)', async () => {
  // No OPENAI key set: a valid cached 'intel' batch must short-circuit before pickProvider/complete.
  _resetDbForTesting();
  await migrate();
  const now = Date.now();
  await saveBriefing({
    domain: 'intel',
    body_md: JSON.stringify([{ id: 'c', title: 'Cached', category: 'energia', triggers: [], consequences: ['x'], affected: [], severity: 'alta', confidence: 'media' }]),
    model: 'test', created_at: now, valid_until: now + 3_600_000,
  });
  const r = await generateInsights();
  assert.equal(r.length, 1, 'returns the cached batch');
  assert.equal(r[0].title, 'Cached');
});
