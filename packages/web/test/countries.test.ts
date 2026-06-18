// packages/web/test/countries.test.ts
// node:test runner — executed via: node --import tsx --test packages/web/test/countries.test.ts
// Pure (Intl-only) — no DOM, no bundler imports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localizeCountry } from '../src/i18n/countries.ts';

test('localizeCountry: direct DisplayNames match → ES', () => {
  assert.equal(localizeCountry('Japan'), 'Japón');
});

test('localizeCountry: alias-resolved name → ES', () => {
  assert.equal(localizeCountry('Russia'), 'Rusia');
});

test('localizeCountry: unknown name → fallback to input', () => {
  assert.equal(localizeCountry('Wakanda'), 'Wakanda');
});

test('localizeCountry: empty string → empty', () => {
  assert.equal(localizeCountry(''), '');
});
