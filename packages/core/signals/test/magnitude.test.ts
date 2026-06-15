/**
 * magnitude.test.ts — Tests de los mapeadores de magnitud (pura).
 *
 * Cubre:
 *  - clamp01: bordes y valores fuera de rango
 *  - ciiMagnitude: lineal + clamp
 *  - marketRiskOff: direccional, símbolos desconocidos ignorados
 *  - marketVol: dispersión intra-ventana
 *  - marketStress: max(riskOff, vol), rango [0,1]
 *  - Invariante de MARKET_REF: pesos suman 1.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MARKET_REF, RISKOFF_REF, VOL_REF } from '../src/convergence.config.js';
import {
  ciiMagnitude,
  clamp01,
  marketRiskOff,
  marketStress,
  marketVol,
} from '../src/magnitude.js';

// ---------------------------------------------------------------------------
// Invariante: pesos de MARKET_REF suman 1.0
// ---------------------------------------------------------------------------
describe('MARKET_REF invariant', () => {
  it('weights sum to 1.0', () => {
    const sum = Object.values(MARKET_REF).reduce((acc, r) => acc + r.w, 0);
    // tolerancia de punto flotante
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `Sum of weights = ${sum}, expected 1.0`);
  });
});

// ---------------------------------------------------------------------------
// clamp01
// ---------------------------------------------------------------------------
describe('clamp01', () => {
  it('returns value as-is when in [0,1]', () => {
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(0), 0);
    assert.equal(clamp01(1), 1);
  });

  it('clamps negative to 0', () => {
    assert.equal(clamp01(-5), 0);
  });

  it('clamps > 1 to 1', () => {
    assert.equal(clamp01(99), 1);
  });
});

// ---------------------------------------------------------------------------
// ciiMagnitude
// ---------------------------------------------------------------------------
describe('ciiMagnitude (normalizada por-dimensión, GAP-2)', () => {
  it('conflict: 0 → 0, escala 80 → score 40 = 0.5, score 80 = 1', () => {
    assert.equal(ciiMagnitude(0, 'conflict'), 0);
    assert.equal(ciiMagnitude(40, 'conflict'), 0.5);
    assert.equal(ciiMagnitude(80, 'conflict'), 1);
  });

  it('economic: escala 7.6 → score 3.8 = 0.5, score 7.6 = 1 (signals corre diminuto)', () => {
    assert.ok(Math.abs(ciiMagnitude(3.8, 'economic') - 0.5) < 1e-9);
    assert.equal(ciiMagnitude(7.6, 'economic'), 1);
  });

  it('political: escala 7.6 → score 7.6 = 1', () => {
    assert.equal(ciiMagnitude(7.6, 'political'), 1);
  });

  it('clamps por encima de la escala a 1', () => {
    assert.equal(ciiMagnitude(200, 'conflict'), 1);
    assert.equal(ciiMagnitude(50, 'economic'), 1);
  });

  it('clamps negativo a 0', () => {
    assert.equal(ciiMagnitude(-10, 'conflict'), 0);
  });
});

// ---------------------------------------------------------------------------
// marketRiskOff — direccional
// ---------------------------------------------------------------------------
describe('marketRiskOff', () => {
  it('SPY -3% + GLD +3% → high riskOff', () => {
    // SPY dir=-1 → estrés cuando baja (contribuye w*-1*(-3) = 0.20*3 = 0.60)
    // GLD dir=+1 → estrés cuando sube (contribuye w*1*(3) = 0.15*3 = 0.45)
    // composite = 1.05 → riskOff = clamp01(1.05/3.0) ≈ 0.35
    const result = marketRiskOff([
      { symbol: 'SPY', changePct: -3 },
      { symbol: 'GLD', changePct: 3 },
    ]);
    assert.ok(result > 0, 'riskOff should be positive under stress');
    assert.ok(result <= 1, 'riskOff should be <= 1');
  });

  it('SPY +3% + GLD -3% → ~0 riskOff (risk-on rally)', () => {
    // SPY dir=-1 → buen signo (contribuye w*-1*(+3) = -0.60, negativo)
    // GLD dir=+1 → venta de refugio (contribuye w*1*(-3) = -0.45, negativo)
    // composite negativo → clamp01 → 0
    const result = marketRiskOff([
      { symbol: 'SPY', changePct: 3 },
      { symbol: 'GLD', changePct: -3 },
    ]);
    assert.equal(result, 0, 'risk-on rally should produce riskOff = 0');
  });

  it('unknown symbols are ignored', () => {
    const result = marketRiskOff([{ symbol: 'TSLA', changePct: -10 }]);
    assert.equal(result, 0, 'unknown symbol should not contribute');
  });

  it('empty array → 0', () => {
    assert.equal(marketRiskOff([]), 0);
  });

  it('result is in [0,1]', () => {
    // Todos risk-off extremo
    const extreme = Object.entries(MARKET_REF).map(([symbol, ref]) => ({
      symbol,
      changePct: ref.dir === -1 ? -20 : 20,
    }));
    const result = marketRiskOff(extreme);
    assert.ok(result >= 0 && result <= 1, `Expected [0,1], got ${result}`);
    assert.equal(result, 1, 'Maximum stress should saturate to 1');
  });

  it('all risk-on → 0', () => {
    // Movimientos contrarios al estrés
    const calmMarket = Object.entries(MARKET_REF).map(([symbol, ref]) => ({
      symbol,
      changePct: ref.dir === -1 ? 5 : -5,
    }));
    assert.equal(marketRiskOff(calmMarket), 0);
  });
});

// ---------------------------------------------------------------------------
// marketVol
// ---------------------------------------------------------------------------
describe('marketVol', () => {
  it('empty trend → 0', () => {
    assert.equal(marketVol({}), 0);
  });

  it('single-point series → 0 dispersion', () => {
    const result = marketVol({ 'SPY': [1.0] });
    assert.equal(result, 0);
  });

  it('high spread → positive vol', () => {
    // dispersión de 4 puntos / VOL_REF(2) = 2 → clamp → 1
    const result = marketVol({ 'SPY': [-2, 2] });
    assert.ok(result > 0, 'high spread should give positive vol');
    assert.ok(result <= 1);
  });

  it('vol >= RISKOFF_REF / VOL_REF → saturates to 1', () => {
    // dispersión muy alta
    const result = marketVol({ 'GLD': [-10, 10] });
    assert.equal(result, 1);
  });

  it('symbols not in MARKET_REF are ignored', () => {
    const result = marketVol({ 'TSLA': [-5, 5] });
    assert.equal(result, 0);
  });

  it('result is in [0,1]', () => {
    const trend = { 'SPY': [-1, 0, 1], 'GLD': [0, 0.5] };
    const result = marketVol(trend);
    assert.ok(result >= 0 && result <= 1);
  });
});

// ---------------------------------------------------------------------------
// marketStress — max(riskOff, vol)
// ---------------------------------------------------------------------------
describe('marketStress', () => {
  it('is in [0,1] for any input', () => {
    const result = marketStress(
      [{ symbol: 'SPY', changePct: -1 }],
      { 'GLD': [0, 1] },
    );
    assert.ok(result >= 0 && result <= 1, `Expected [0,1], got ${result}`);
  });

  it('equals max of riskOff and vol', () => {
    const latest = [{ symbol: 'SPY', changePct: -5 }];
    const trend = { 'GLD': [0, 0.1] };
    const ro = marketRiskOff(latest);
    const vol = marketVol(trend);
    const expected = clamp01(Math.max(ro, vol));
    assert.equal(marketStress(latest, trend), expected);
  });

  it('with no data → 0', () => {
    assert.equal(marketStress([], {}), 0);
  });

  it('saturates to 1 under extreme stress', () => {
    const extreme = [
      { symbol: 'SPY', changePct: -50 },
      { symbol: 'GLD', changePct: 50 },
    ];
    const result = marketStress(extreme, {});
    assert.equal(result, 1);
  });
});

// ---------------------------------------------------------------------------
// Referencia de normalización
// ---------------------------------------------------------------------------
describe('RISKOFF_REF and VOL_REF', () => {
  it('RISKOFF_REF is positive', () => {
    assert.ok(RISKOFF_REF > 0);
  });
  it('VOL_REF is positive', () => {
    assert.ok(VOL_REF > 0);
  });
});
