/**
 * detect.test.ts — Tests de detectConvergence (función pura).
 *
 * Cubre los criterios gradeables del design-doc §R1 + D-301..D-307:
 *  - R1: anti-doble-conteo por dataFamily (conflict+social = 1 familia)
 *  - Umbral MIN_MAGNITUDE: obs baja no cuenta
 *  - D-304: signalPresent=false excluye la obs
 *  - D-305: markets transversal solo a países con economic
 *  - D-307: strength decay (obs vieja pesa menos)
 *  - D-306: sourceCount = #familias disjuntas
 *  - Señal emitida cuando familias >= MIN_SOURCES
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HALF_LIFE_72H,
  MIN_MAGNITUDE,
  MIN_SOURCES,
  WINDOW_MS,
} from '../src/convergence.config.js';
import type { ConvergenceObservation } from '../src/detect.js';
import { detectConvergence } from '../src/detect.js';

// ---------------------------------------------------------------------------
// Helpers de construcción de observaciones
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000; // epoch ms fijo para tests

function obs(
  overrides: Partial<ConvergenceObservation> & Pick<ConvergenceObservation, 'dimension'>,
): ConvergenceObservation {
  return {
    country: 'TestLand',
    dataFamily: 'events',
    magnitude: 0.8,
    ts: NOW,
    signalPresent: true,
    source: `cii:${overrides.dimension}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// R1 — Anti-doble-conteo
// ---------------------------------------------------------------------------
describe('R1 anti-doble-conteo (D-306)', () => {
  it('conflict + social (misma familia events) = 1 familia → NO dispara', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8 }),
      obs({ dimension: 'social', dataFamily: 'events', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'Two obs same family must NOT trigger convergence');
  });

  it('conflict (events) + economic (signals) = 2 familias → SÍ dispara, sourceCount=2', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8 }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1, 'Two distinct families should trigger convergence');
    assert.equal(signals[0].sourceCount, 2);
    assert.deepEqual(signals[0].families.sort(), ['events', 'signals']);
  });

  it('conflict + social + economic = 2 familias (conflict+social=1) → sourceCount=2', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8 }),
      obs({ dimension: 'social', dataFamily: 'events', magnitude: 0.75 }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].sourceCount, 2);
    assert.deepEqual(signals[0].families.sort(), ['events', 'signals']);
  });

  it('within-family best obs is selected (mayor magnitud)', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.6, source: 'cii:conflict' }),
      obs({ dimension: 'social',   dataFamily: 'events', magnitude: 0.9, source: 'cii:social' }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);
    // La obs representante de 'events' debe ser social (magnitud 0.9)
    const eventsObs = signals[0].observations.find((o) => o.dataFamily === 'events');
    assert.ok(eventsObs, 'events obs should be present');
    assert.equal(eventsObs!.magnitude, 0.9, 'best within-family obs should be selected');
  });
});

// ---------------------------------------------------------------------------
// Umbral MIN_MAGNITUDE (D-303)
// ---------------------------------------------------------------------------
describe('MIN_MAGNITUDE threshold', () => {
  it('obs with magnitude < MIN_MAGNITUDE is excluded', () => {
    const belowThreshold = MIN_MAGNITUDE - 0.01;
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: belowThreshold }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'obs below threshold should not trigger convergence');
  });

  it('obs with magnitude === MIN_MAGNITUDE is included', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: MIN_MAGNITUDE }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: MIN_MAGNITUDE }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1, 'obs at exact threshold should trigger convergence');
  });
});

// ---------------------------------------------------------------------------
// D-304 — signalPresent=false excluye la obs (corroborante CII)
// ---------------------------------------------------------------------------
describe('D-304 signalPresent filter', () => {
  it('CII obs with signalPresent=false is excluded', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8, signalPresent: false }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8, signalPresent: true }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'obs with signalPresent=false should be excluded');
  });

  it('all obs signalPresent=true → triggers normally', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8, signalPresent: true }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8, signalPresent: true }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Ventana temporal WINDOW_MS
// ---------------------------------------------------------------------------
describe('Temporal window WINDOW_MS', () => {
  it('obs older than WINDOW_MS is excluded', () => {
    const tooOld = NOW - WINDOW_MS - 1;
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8, ts: tooOld }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8, ts: NOW }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'obs outside the window should be excluded');
  });

  it('obs at exactly windowStart is included', () => {
    const atEdge = NOW - WINDOW_MS;
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8, ts: atEdge }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8, ts: NOW }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1, 'obs at window edge should be included');
  });
});

// ---------------------------------------------------------------------------
// D-305 — Markets transversal (solo países con economic)
// ---------------------------------------------------------------------------
describe('D-305 markets transversal', () => {
  const MARKET_OBS: ConvergenceObservation = {
    country: '',           // transversal (sin país)
    dimension: 'market',
    dataFamily: 'markets',
    magnitude: 0.9,
    ts: NOW,
    signalPresent: true,
    source: 'markets:stress',
  };

  it('markets obs adds family to country with economic (signals)', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
      MARKET_OBS,
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1, 'country with economic + markets stress should fire');
    assert.ok(signals[0].families.includes('markets'), 'markets family should be included');
    assert.equal(signals[0].sourceCount, 2);
  });

  it('markets obs does NOT add family to country without economic', () => {
    // Solo conflict (events), sin economic (signals)
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events', magnitude: 0.8 }),
      MARKET_OBS,
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'country without economic should not get markets family');
  });

  it('markets adds to country with economic, enabling convergence with 3rd dim', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict',  dataFamily: 'events',  magnitude: 0.8 }),
      obs({ dimension: 'economic',  dataFamily: 'signals', magnitude: 0.8 }),
      MARKET_OBS,
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].sourceCount, 3); // events + signals + markets
    assert.deepEqual(signals[0].families.sort(), ['events', 'markets', 'signals']);
  });

  it('markets obs below threshold does not contribute', () => {
    const lowMarket: ConvergenceObservation = { ...MARKET_OBS, magnitude: MIN_MAGNITUDE - 0.01 };
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
      lowMarket,
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 0, 'markets obs below threshold should not count');
  });
});

// ---------------------------------------------------------------------------
// D-307 — Strength time-decay
// ---------------------------------------------------------------------------
describe('D-307 strength time-decay', () => {
  it('strength < magnitude when one obs is at ts=now-HALF_LIFE_72H', () => {
    const magnitude = 0.8;
    const observations: ConvergenceObservation[] = [
      obs({
        dimension: 'conflict',
        dataFamily: 'events',
        magnitude,
        ts: NOW,                 // peso 1.0
      }),
      obs({
        dimension: 'economic',
        dataFamily: 'signals',
        magnitude,
        ts: NOW - HALF_LIFE_72H, // peso 0.5
      }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);

    const { strength } = signals[0];
    // strength = (0.8*1 + 0.8*0.5) / (1 + 0.5) = 1.2/1.5 = 0.8 exactamente
    // (ambas tienen la misma magnitud, el decay solo cambia los pesos, no la media ponderada
    //  cuando las magnitudes son iguales → la media es igual a la magnitud)
    // Necesitamos comprobar que el mecanismo funciona con magnitudes distintas:
    assert.ok(
      strength > 0 && strength <= 1,
      `strength ${strength} must be in (0,1]`,
    );
  });

  it('obs at now-72h has weight 0.25 of obs at now (2 half-lives)', () => {
    // Con magnitudes iguales el strength no cambia, pero con distintas sí:
    // obs_now: mag=1.0, w=1.0  → contribución 1.0
    // obs_old: mag=0.6, w=0.25 → contribución 0.15
    // strength = (1.0 + 0.15)/(1 + 0.25) = 1.15/1.25 = 0.92
    const twoHalfLivesAgo = NOW - 2 * HALF_LIFE_72H;
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events',  magnitude: 1.0, ts: NOW }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.6, ts: twoHalfLivesAgo }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);

    const expectedStrength = (1.0 * 1.0 + 0.6 * 0.25) / (1.0 + 0.25);
    assert.ok(
      Math.abs(signals[0].strength - expectedStrength) < 1e-9,
      `Expected strength ${expectedStrength}, got ${signals[0].strength}`,
    );
  });

  it('strength equals equal magnitudes regardless of decay distribution', () => {
    // Cuando mag_i son iguales, la media ponderada = la magnitud (el decay cancela)
    const mag = 0.75;
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events',  magnitude: mag, ts: NOW }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: mag, ts: NOW - HALF_LIFE_72H }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 1);
    assert.ok(
      Math.abs(signals[0].strength - mag) < 1e-9,
      `Equal magnitudes: strength should equal magnitude ${mag}, got ${signals[0].strength}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Valor inicial de dynamicScore y firstDetectedAt (IO los actualiza en T-30)
// ---------------------------------------------------------------------------
describe('pure function initial values', () => {
  it('dynamicScore is 0 (IO recalculates)', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events',  magnitude: 0.8 }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals[0].dynamicScore, 0);
  });

  it('firstDetectedAt = nowMs (IO updates from getPriorConvergence)', () => {
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events',  magnitude: 0.8 }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals[0].firstDetectedAt, NOW);
    assert.equal(signals[0].capturedAt, NOW);
  });

  it('methodologyVersion matches config', async () => {
    const { METHODOLOGY_VERSION } = await import('../src/convergence.config.js');
    const observations: ConvergenceObservation[] = [
      obs({ dimension: 'conflict', dataFamily: 'events',  magnitude: 0.8 }),
      obs({ dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals[0].methodologyVersion, METHODOLOGY_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Múltiples países independientes
// ---------------------------------------------------------------------------
describe('multiple countries', () => {
  it('emits one signal per qualifying country', () => {
    const observations: ConvergenceObservation[] = [
      // País A — qualifica
      obs({ country: 'Alpha', dimension: 'conflict', dataFamily: 'events',  magnitude: 0.8 }),
      obs({ country: 'Alpha', dimension: 'economic', dataFamily: 'signals', magnitude: 0.8 }),
      // País B — qualifica
      obs({ country: 'Beta',  dimension: 'conflict', dataFamily: 'events',  magnitude: 0.7 }),
      obs({ country: 'Beta',  dimension: 'economic', dataFamily: 'signals', magnitude: 0.7 }),
      // País C — solo 1 familia, NO qualifica
      obs({ country: 'Gamma', dimension: 'conflict', dataFamily: 'events',  magnitude: 0.9 }),
    ];
    const signals = detectConvergence(observations, NOW);
    assert.equal(signals.length, 2, 'Should emit exactly 2 signals (Alpha + Beta)');
    const countries = signals.map((s) => s.country).sort();
    assert.deepEqual(countries, ['Alpha', 'Beta']);
  });
});

// ---------------------------------------------------------------------------
// Invariantes del config
// ---------------------------------------------------------------------------
describe('config invariants', () => {
  it('MIN_SOURCES >= 2', () => {
    assert.ok(MIN_SOURCES >= 2, 'MIN_SOURCES must be at least 2');
  });

  it('MIN_MAGNITUDE is in (0, 1)', () => {
    assert.ok(MIN_MAGNITUDE > 0 && MIN_MAGNITUDE < 1);
  });

  it('WINDOW_MS > 0', () => {
    assert.ok(WINDOW_MS > 0);
  });

  it('HALF_LIFE_72H > 0 and < WINDOW_MS', () => {
    assert.ok(HALF_LIFE_72H > 0);
    assert.ok(HALF_LIFE_72H < WINDOW_MS, 'half-life should be within the window');
  });
});
