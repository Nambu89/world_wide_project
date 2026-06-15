/**
 * cii-config.test.ts — Tests de invariantes del paquete @www/core-cii
 *
 * Criterios gradeables (no vibes):
 * 1. Invariante de suma: EVENT_WEIGHTS suma EXACTAMENTE 1.0.
 * 2. decayWeight(0) === 1 (evento hoy = peso pleno).
 * 3. decayWeight(DECAY_HALF_LIFE_MS) ≈ 0.5 (tolerancia 1e-9).
 * 4. normalizeCountryKey('JA','gdelt') === normalizeCountryKey('Japan','usgs') === 'Japan'.
 * 5. FIPS desconocido → '' (motor lo descarta).
 * 6. FIPS '' → '' (raw vacío → descartado).
 * 7. CH → 'China' (NO 'Switzerland') — trampa crítica FIPS vs ISO.
 * 8. COMPOSITE.BASELINE_W + COMPOSITE.EVENT_W === 1.0.
 * 9. SOCIAL_MIX.EVENTS_W + SOCIAL_MIX.GKG_W === 1.0.
 * 10. Todos los COUNTRY_COEFFS tienen baselineRisk en [0,100] y eventMultiplier > 0.
 * 11. COMPONENT_REGISTRY tiene exactamente 4 entradas (una por CiiComponentKey).
 * 12. Los pesos de COMPONENT_REGISTRY coinciden con EVENT_WEIGHTS.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_WEIGHTS,
  COMPOSITE,
  SOCIAL_MIX,
  DECAY_HALF_LIFE_MS,
  decayWeight,
  COUNTRY_COEFFS,
  DEFAULT_COEFF,
  COMPONENT_REGISTRY,
  normalizeCountryKey,
} from '../src/index.js';

// ─── 1. Invariante de suma EVENT_WEIGHTS ─────────────────────────────────────

describe('EVENT_WEIGHTS invariants', () => {
  it('suma exactamente 1.0', () => {
    const sum = Object.values(EVENT_WEIGHTS).reduce((acc, w) => acc + w, 0);
    // Igualdad exacta: los pesos son fracciones decimales con representación
    // exacta en IEEE 754 (0.25 + 0.30 + 0.20 + 0.25 = 1.00).
    assert.strictEqual(sum, 1.0, `Expected 1.0, got ${sum}`);
  });

  it('tiene exactamente 4 componentes', () => {
    assert.strictEqual(Object.keys(EVENT_WEIGHTS).length, 4);
  });

  it('todos los pesos son positivos', () => {
    for (const [key, w] of Object.entries(EVENT_WEIGHTS)) {
      assert.ok(w > 0, `Peso "${key}" debe ser > 0, got ${w}`);
    }
  });
});

// ─── 2. Invariante COMPOSITE ──────────────────────────────────────────────────

describe('COMPOSITE invariants', () => {
  it('BASELINE_W + EVENT_W === 1.0', () => {
    const sum = COMPOSITE.BASELINE_W + COMPOSITE.EVENT_W;
    assert.strictEqual(sum, 1.0, `Expected 1.0, got ${sum}`);
  });

  it('BASELINE_W = 0.4, EVENT_W = 0.6', () => {
    assert.strictEqual(COMPOSITE.BASELINE_W, 0.4);
    assert.strictEqual(COMPOSITE.EVENT_W, 0.6);
  });
});

// ─── 3. Invariante SOCIAL_MIX ────────────────────────────────────────────────

describe('SOCIAL_MIX invariants', () => {
  it('EVENTS_W + GKG_W === 1.0', () => {
    const sum = SOCIAL_MIX.EVENTS_W + SOCIAL_MIX.GKG_W;
    assert.strictEqual(sum, 1.0, `Expected 1.0, got ${sum}`);
  });
});

// ─── 4 + 5. decayWeight ───────────────────────────────────────────────────────

describe('decayWeight', () => {
  it('decayWeight(0) === 1 (evento actual = peso pleno)', () => {
    assert.strictEqual(decayWeight(0), 1);
  });

  it('decayWeight(DECAY_HALF_LIFE_MS) ≈ 0.5 (tolerancia 1e-9)', () => {
    const result = decayWeight(DECAY_HALF_LIFE_MS);
    assert.ok(
      Math.abs(result - 0.5) < 1e-9,
      `Expected ≈0.5, got ${result} (diff=${Math.abs(result - 0.5)})`,
    );
  });

  it('decayWeight negativo → 1 (clamp a edad 0)', () => {
    assert.strictEqual(decayWeight(-1000), 1);
  });

  it('decayWeight muy grande → cercano a 0', () => {
    const result = decayWeight(DECAY_HALF_LIFE_MS * 100);
    assert.ok(result < 1e-25, `Expected nearly 0, got ${result}`);
  });

  it('decayWeight es decreciente', () => {
    const a = decayWeight(0);
    const b = decayWeight(DECAY_HALF_LIFE_MS / 2);
    const c = decayWeight(DECAY_HALF_LIFE_MS);
    assert.ok(a > b, 'decayWeight(0) debe ser > decayWeight(HalfLife/2)');
    assert.ok(b > c, 'decayWeight(HalfLife/2) debe ser > decayWeight(HalfLife)');
  });
});

// ─── 6. normalizeCountryKey — GDELT FIPS ─────────────────────────────────────

describe('normalizeCountryKey — GDELT', () => {
  it('JA → Japan (FIPS≠ISO)', () => {
    assert.strictEqual(normalizeCountryKey('JA', 'gdelt'), 'Japan');
  });

  it('CH → China (NO Switzerland — trampa crítica FIPS vs ISO)', () => {
    assert.strictEqual(normalizeCountryKey('CH', 'gdelt'), 'China');
  });

  it('SZ → Switzerland (FIPS SZ = Switzerland, no CH)', () => {
    assert.strictEqual(normalizeCountryKey('SZ', 'gdelt'), 'Switzerland');
  });

  it('UK → United Kingdom (FIPS UK = UK, ISO GB)', () => {
    assert.strictEqual(normalizeCountryKey('UK', 'gdelt'), 'United Kingdom');
  });

  it('GM → Germany (FIPS GM, ISO DE)', () => {
    assert.strictEqual(normalizeCountryKey('GM', 'gdelt'), 'Germany');
  });

  it('RS → Russia (FIPS RS, ISO RU)', () => {
    assert.strictEqual(normalizeCountryKey('RS', 'gdelt'), 'Russia');
  });

  it('KS → South Korea (FIPS KS, ISO KR)', () => {
    assert.strictEqual(normalizeCountryKey('KS', 'gdelt'), 'South Korea');
  });

  it('IZ → Iraq (FIPS IZ, ISO IQ)', () => {
    assert.strictEqual(normalizeCountryKey('IZ', 'gdelt'), 'Iraq');
  });

  it('SF → South Africa (FIPS SF, ISO ZA)', () => {
    assert.strictEqual(normalizeCountryKey('SF', 'gdelt'), 'South Africa');
  });

  it('AS → Australia (FIPS AS, ISO AU — otra trampa)', () => {
    assert.strictEqual(normalizeCountryKey('AS', 'gdelt'), 'Australia');
  });

  it('AU → Austria (FIPS AU = Austria, ISO AT — inversa de la trampa)', () => {
    assert.strictEqual(normalizeCountryKey('AU', 'gdelt'), 'Austria');
  });

  it('EZ → Czech Republic (FIPS EZ, ISO CZ)', () => {
    assert.strictEqual(normalizeCountryKey('EZ', 'gdelt'), 'Czech Republic');
  });

  it('UP → Ukraine (FIPS UP, ISO UA)', () => {
    assert.strictEqual(normalizeCountryKey('UP', 'gdelt'), 'Ukraine');
  });

  it('SP → Spain (FIPS SP, ISO ES)', () => {
    assert.strictEqual(normalizeCountryKey('SP', 'gdelt'), 'Spain');
  });

  it('CI → Chile (FIPS CI, ISO CL)', () => {
    assert.strictEqual(normalizeCountryKey('CI', 'gdelt'), 'Chile');
  });

  it('FIPS desconocido → "" (motor descarta)', () => {
    assert.strictEqual(normalizeCountryKey('XX', 'gdelt'), '');
  });

  it('raw vacío → ""', () => {
    assert.strictEqual(normalizeCountryKey('', 'gdelt'), '');
  });

  it('raw solo espacios → ""', () => {
    assert.strictEqual(normalizeCountryKey('   ', 'gdelt'), '');
  });

  // Cobertura ampliada (PM, tras smoke en vivo: ~50 FIPS faltaban → hotspots descartados).
  // Hotspots de conflicto y trampas FIPS≠ISO que GDELT produce en vivo.
  it('cubre hotspots de conflicto que GDELT produce en vivo', () => {
    const expected: Record<string, string> = {
      SY: 'Syria', AF: 'Afghanistan', LE: 'Lebanon', SO: 'Somalia', SU: 'Sudan',
      CG: 'Congo (Kinshasa)', AE: 'United Arab Emirates', CE: 'Sri Lanka',
      RP: 'Philippines', KZ: 'Kazakhstan', NP: 'Nepal', ZI: 'Zimbabwe',
    };
    for (const [fips, name] of Object.entries(expected)) {
      assert.strictEqual(normalizeCountryKey(fips, 'gdelt'), name, `${fips} → ${name}`);
    }
  });

  it('trampas FIPS≠ISO de la cobertura ampliada', () => {
    assert.strictEqual(normalizeCountryKey('CD', 'gdelt'), 'Chad');        // no Trinidad (TD)
    assert.strictEqual(normalizeCountryKey('SG', 'gdelt'), 'Senegal');     // no Singapore (ISO SG)
    assert.strictEqual(normalizeCountryKey('BN', 'gdelt'), 'Benin');       // no Brunei (ISO BN)
    assert.strictEqual(normalizeCountryKey('ES', 'gdelt'), 'El Salvador'); // no Spain (ISO ES)
    assert.strictEqual(normalizeCountryKey('WA', 'gdelt'), 'Namibia');     // FIPS WA = Namibia
  });
});

// ─── 7. normalizeCountryKey — USGS / EONET ───────────────────────────────────

describe('normalizeCountryKey — USGS/EONET', () => {
  it('Japan (usgs) → Japan', () => {
    assert.strictEqual(normalizeCountryKey('Japan', 'usgs'), 'Japan');
  });

  it('Japan (eonet) → Japan', () => {
    assert.strictEqual(normalizeCountryKey('Japan', 'eonet'), 'Japan');
  });

  it('normalizeCountryKey("JA","gdelt") === normalizeCountryKey("Japan","usgs")', () => {
    assert.strictEqual(
      normalizeCountryKey('JA', 'gdelt'),
      normalizeCountryKey('Japan', 'usgs'),
    );
  });

  it('alias "Czechia" → Czech Republic', () => {
    assert.strictEqual(normalizeCountryKey('Czechia', 'usgs'), 'Czech Republic');
  });

  it('alias "United States of America" → United States', () => {
    assert.strictEqual(normalizeCountryKey('United States of America', 'usgs'), 'United States');
  });

  it('alias "Türkiye" → Turkey', () => {
    assert.strictEqual(normalizeCountryKey('Türkiye', 'usgs'), 'Turkey');
  });

  it('raw vacío usgs → ""', () => {
    assert.strictEqual(normalizeCountryKey('', 'usgs'), '');
  });
});

// ─── 8. COUNTRY_COEFFS sanity ────────────────────────────────────────────────

describe('COUNTRY_COEFFS sanity', () => {
  it('tiene al menos 60 países', () => {
    const count = Object.keys(COUNTRY_COEFFS).length;
    assert.ok(count >= 60, `Expected >=60 countries, got ${count}`);
  });

  it('todos los baselineRisk están en [0,100]', () => {
    for (const [country, coeff] of Object.entries(COUNTRY_COEFFS)) {
      assert.ok(
        coeff.baselineRisk >= 0 && coeff.baselineRisk <= 100,
        `${country}: baselineRisk=${coeff.baselineRisk} fuera de [0,100]`,
      );
    }
  });

  it('todos los eventMultiplier son positivos', () => {
    for (const [country, coeff] of Object.entries(COUNTRY_COEFFS)) {
      assert.ok(
        coeff.eventMultiplier > 0,
        `${country}: eventMultiplier=${coeff.eventMultiplier} debe ser > 0`,
      );
    }
  });

  it('DEFAULT_COEFF tiene valores razonables', () => {
    assert.ok(DEFAULT_COEFF.baselineRisk >= 0 && DEFAULT_COEFF.baselineRisk <= 100);
    assert.strictEqual(DEFAULT_COEFF.eventMultiplier, 1.0);
  });

  it('China está en COUNTRY_COEFFS y es la clave exacta', () => {
    assert.ok('China' in COUNTRY_COEFFS, 'China debe estar en COUNTRY_COEFFS');
  });

  it('Switzerland está en COUNTRY_COEFFS (distinto de China)', () => {
    assert.ok('Switzerland' in COUNTRY_COEFFS);
    assert.notEqual(
      COUNTRY_COEFFS['Switzerland'],
      COUNTRY_COEFFS['China'],
    );
  });
});

// ─── 9. COMPONENT_REGISTRY ────────────────────────────────────────────────────

describe('COMPONENT_REGISTRY', () => {
  it('tiene exactamente 4 entradas', () => {
    assert.strictEqual(COMPONENT_REGISTRY.length, 4);
  });

  it('cubre las 4 CiiComponentKeys', () => {
    const keys = new Set(COMPONENT_REGISTRY.map((e) => e.key));
    assert.ok(keys.has('conflict'));
    assert.ok(keys.has('economic'));
    assert.ok(keys.has('political'));
    assert.ok(keys.has('social'));
  });

  it('los pesos del registry coinciden con EVENT_WEIGHTS', () => {
    for (const entry of COMPONENT_REGISTRY) {
      assert.strictEqual(
        entry.weight,
        EVENT_WEIGHTS[entry.key],
        `Registry[${entry.key}].weight=${entry.weight} != EVENT_WEIGHTS[${entry.key}]=${EVENT_WEIGHTS[entry.key]}`,
      );
    }
  });

  it('la suma de pesos del registry es 1.0', () => {
    const sum = COMPONENT_REGISTRY.reduce((acc, e) => acc + e.weight, 0);
    assert.strictEqual(sum, 1.0, `Expected 1.0, got ${sum}`);
  });
});
