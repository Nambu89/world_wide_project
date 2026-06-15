// packages/core/signals/test/observe.test.ts
// Tests del orquestador IO detectAllConvergence (T-30) con DB :memory:.
//
// Cubre: armado de observaciones desde CII components + markets transversal (D-305),
// anti-doble-conteo end-to-end, firstDetectedAt/dynamicScore vs getPriorConvergence
// (D-309), y retorno gracioso con CII vacío.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// La DB de test es :memory: (NO la de producción). Debe fijarse antes de usar el store.
process.env['LIBSQL_URL'] = ':memory:';

import {
  _resetDbForTesting,
  migrate,
  insertCiiSnapshots,
  insertMarketSnapshots,
  insertConvergenceSignals,
  type CiiSnapshotRow,
  type MarketSnapshot,
} from '@www/store';

import { detectAllConvergence } from '../src/observe.js';

const NOW = 1_750_000_000_000; // epoch ms fijo (determinismo)

// ── Helpers de siembra ──────────────────────────────────────────────────────

function ciiRow(
  country: string,
  comps: { key: string; score: number; signalPresent: boolean }[],
  capturedAt = NOW,
): CiiSnapshotRow {
  return {
    country,
    composite: 50,
    baselineRisk: 30,
    eventScore: 60,
    dynamicScore: 0,
    trend: 'stable',
    methodologyVersion: 'cii-core-1',
    componentsJson: JSON.stringify(comps),
    capturedAt,
  };
}

function mkt(symbol: string, changePct: number, capturedAt = NOW): MarketSnapshot {
  return {
    source: 'yahoo-v8',
    symbol,
    asset_class: 'equity',
    price: 100,
    change_pct: changePct,
    captured_at: capturedAt,
  };
}

/** Mercado en estrés risk-off pleno: cada símbolo se mueve +5 en su dirección de estrés. */
function strongRiskOffMarkets(capturedAt = NOW): MarketSnapshot[] {
  return [
    mkt('SPY', -5, capturedAt),
    mkt('QQQ', -5, capturedAt),
    mkt('BTC-USD', -5, capturedAt),
    mkt('ETH-USD', -5, capturedAt),
    mkt('GLD', 5, capturedAt),
    mkt('DX-Y.NYB', 5, capturedAt),
    mkt('EURUSD=X', -5, capturedAt),
  ];
}

function families(row: { familiesJson: string }): string[] {
  return JSON.parse(row.familiesJson) as string[];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('detectAllConvergence (T-30 orquestador IO)', () => {
  beforeEach(async () => {
    _resetDbForTesting();
    await migrate();
  });

  test('CII vacío → [] (retorno gracioso)', async () => {
    const rows = await detectAllConvergence(NOW);
    assert.equal(rows.length, 0);
  });

  test('conflict + economic CII (signalPresent) en un país → 1 señal sourceCount=2 (events×signals)', async () => {
    await insertCiiSnapshots([
      ciiRow('Testland', [
        { key: 'conflict', score: 70, signalPresent: true },
        { key: 'economic', score: 70, signalPresent: true },
      ]),
    ]);

    const rows = await detectAllConvergence(NOW);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.country, 'Testland');
    assert.equal(rows[0]!.sourceCount, 2);
    assert.deepEqual(families(rows[0]!), ['events', 'signals']);
    // magnitud por-dimensión (GAP-2): conflict 70/80=0.875, economic 70/7.6→clamp 1.0
    // strength = media sin decay (ts=now) = (0.875 + 1.0)/2 = 0.9375
    assert.ok(Math.abs(rows[0]!.strength - 0.9375) < 1e-9, `strength=${rows[0]!.strength}`);
    // serie nueva: sin prior
    assert.equal(rows[0]!.dynamicScore, 0);
    assert.equal(rows[0]!.firstDetectedAt, NOW);
    assert.equal(rows[0]!.methodologyVersion, 'conv-core-2');
  });

  test('un componente CII con signalPresent=false NO cuenta (D-304) → sin señal', async () => {
    await insertCiiSnapshots([
      ciiRow('Floorland', [
        { key: 'conflict', score: 90, signalPresent: false }, // floor sin datos
        { key: 'economic', score: 70, signalPresent: true },
      ]),
    ]);

    const rows = await detectAllConvergence(NOW);
    // Solo economic cuenta → 1 familia (signals) → sin convergencia
    assert.equal(rows.length, 0);
  });

  test('markets en estrés añade familia a país con economic activo; NO a país solo-conflict (D-305)', async () => {
    await insertCiiSnapshots([
      ciiRow('EconLand', [{ key: 'economic', score: 70, signalPresent: true }]), // solo signals
      ciiRow('WarLand', [{ key: 'conflict', score: 70, signalPresent: true }]), // solo events
    ]);
    await insertMarketSnapshots(strongRiskOffMarkets());

    const rows = await detectAllConvergence(NOW);

    const econ = rows.find((r) => r.country === 'EconLand');
    const war = rows.find((r) => r.country === 'WarLand');

    // EconLand: signals (economic) + markets = 2 familias → señal
    assert.ok(econ, 'EconLand debe disparar (economic + markets)');
    assert.equal(econ!.sourceCount, 2);
    assert.deepEqual(families(econ!), ['markets', 'signals']);

    // WarLand: solo events (conflict); markets NO se atribuye a no-economic → sin señal
    assert.equal(war, undefined);
  });

  test('firstDetectedAt se hereda del prior y dynamicScore = delta de strength (D-309)', async () => {
    // Prior: misma (country, familyset) con strength 0.5, detectado mucho antes.
    await insertConvergenceSignals([
      {
        country: 'Testland',
        familiesJson: JSON.stringify(['events', 'signals']),
        dimensionsJson: JSON.stringify(['conflict', 'economic']),
        componentsJson: '[]',
        strength: 0.5,
        sourceCount: 2,
        dynamicScore: 0,
        methodologyVersion: 'conv-core-1',
        firstDetectedAt: NOW - 100_000,
        capturedAt: NOW - 100_000,
      },
    ]);
    await insertCiiSnapshots([
      ciiRow('Testland', [
        { key: 'conflict', score: 70, signalPresent: true },
        { key: 'economic', score: 70, signalPresent: true },
      ]),
    ]);

    const rows = await detectAllConvergence(NOW);
    assert.equal(rows.length, 1);
    // hereda el firstDetectedAt del prior
    assert.equal(rows[0]!.firstDetectedAt, NOW - 100_000);
    // dynamicScore = strength_now (0.9375) - strength_prior (0.5) = 0.4375
    assert.ok(Math.abs(rows[0]!.dynamicScore! - 0.4375) < 1e-9, `dynamicScore=${rows[0]!.dynamicScore}`);
  });

  test('conflict + social (ambos familia events) NO disparan solos (anti-doble-conteo D-306)', async () => {
    await insertCiiSnapshots([
      ciiRow('OneFamilyLand', [
        { key: 'conflict', score: 80, signalPresent: true },
        { key: 'social', score: 80, signalPresent: true },
      ]),
    ]);

    const rows = await detectAllConvergence(NOW);
    // 2 componentes pero 1 sola familia (events) → no convergencia
    assert.equal(rows.length, 0);
  });
});
