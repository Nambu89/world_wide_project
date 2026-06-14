/**
 * severity.test.ts — Tests gradeables para el normalizador de severity.
 *
 * Criterios verificados (criterios explícitos, no vibes):
 * - Toda salida ∈ [0,100] con inputs extremos (clamp duro verificado)
 * - M-grande con alert='red' + tsunami → severity alta (>= 85)
 * - Ruido sísmico (mag 0.x, sin alert) → severity baja (< 20)
 * - GDELT QuadClass=4 > QuadClass=1
 * - Sin import de @www/store (funciones puras)
 * - Sin dependencia nueva (solo uso de Node built-ins)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { severityUsgs, severityEonet, severityGdelt } from './severity.ts';

// ─── Helper ──────────────────────────────────────────────────────────────────

function assertInRange(val: number, label: string): void {
  assert.ok(
    val >= 0 && val <= 100,
    `${label}: ${val} fuera de [0,100]`,
  );
}

// ─── severityUsgs ─────────────────────────────────────────────────────────────

describe('severityUsgs', () => {
  it('devuelve 0 con todos los parámetros ausentes', () => {
    const s = severityUsgs({});
    assert.strictEqual(s, 0);
  });

  it('clamp duro: sig muy alto no supera 100', () => {
    const s = severityUsgs({ sig: 99999 });
    assertInRange(s, 'sig extremo');
    assert.ok(s <= 100);
  });

  it('clamp duro: mag negativa → 0 (no negativo)', () => {
    const s = severityUsgs({ mag: -5 });
    assert.strictEqual(s, 0);
  });

  it('ruido sísmico (mag 0.2, sin alert) → severity baja (< 20)', () => {
    const s = severityUsgs({ mag: 0.2 });
    assertInRange(s, 'ruido sísmico');
    assert.ok(s < 20, `Se esperaba < 20, got ${s}`);
  });

  it('M grande (mag 7.5) sin alert → severity moderada-alta (>= 60)', () => {
    const s = severityUsgs({ mag: 7.5 });
    assertInRange(s, 'M7.5 sin alert');
    assert.ok(s >= 60, `Se esperaba >= 60, got ${s}`);
  });

  it('alert=red sin otros factores → severity >= 85 (piso PAGER)', () => {
    const s = severityUsgs({ alert: 'red' });
    assertInRange(s, 'alert=red');
    assert.ok(s >= 85, `Se esperaba >= 85, got ${s}`);
  });

  it('alert=orange → severity >= 65', () => {
    const s = severityUsgs({ alert: 'orange' });
    assertInRange(s, 'alert=orange');
    assert.ok(s >= 65, `Se esperaba >= 65, got ${s}`);
  });

  it('alert=yellow → severity >= 40', () => {
    const s = severityUsgs({ alert: 'yellow' });
    assertInRange(s, 'alert=yellow');
    assert.ok(s >= 40, `Se esperaba >= 40, got ${s}`);
  });

  it('M-grande con alert=red + tsunami → severity alta (>= 85, clamped a 100)', () => {
    const s = severityUsgs({ mag: 9.0, sig: 900, alert: 'red', tsunami: 1 });
    assertInRange(s, 'M9 + red + tsunami');
    // base = min(900/10, 90) = 90; floor red = 85; max(90,85)=90; +10 tsunami = 100
    assert.ok(s >= 85, `Se esperaba >= 85, got ${s}`);
  });

  it('tsunami boost añade puntos (comparado con mismo sin tsunami)', () => {
    const sinTsunami = severityUsgs({ mag: 6.0 });
    const conTsunami = severityUsgs({ mag: 6.0, tsunami: 1 });
    assert.ok(conTsunami > sinTsunami, `Con tsunami (${conTsunami}) debe ser > sin tsunami (${sinTsunami})`);
  });

  it('sig prevalece sobre mag cuando ambos están presentes', () => {
    // sig=10 → base 1; mag=9.0 → daría 90 si se usara. Con sig presente debe usar sig.
    const s = severityUsgs({ sig: 10, mag: 9.0 });
    // Si usara sig: base = 10/10 = 1; si usara mag: base = 90. El resultado < 50 confirma que se usó sig.
    assert.ok(s < 50, `Si prevalece sig (10): base=1, resultado < 50, got ${s}`);
  });

  it('alert case-insensitive (RED = red)', () => {
    const lower = severityUsgs({ alert: 'red' });
    const upper = severityUsgs({ alert: 'RED' });
    assert.strictEqual(lower, upper);
  });

  it('salida en [0,100] con inputs extremos aleatorios', () => {
    const cases: Array<Parameters<typeof severityUsgs>[0]> = [
      { mag: 0, sig: 0, alert: 'green', tsunami: 0 },
      { mag: 10, sig: 2000, alert: 'red', tsunami: 1 },
      { mag: -100, sig: -500, alert: 'purple', tsunami: 99 },
      { sig: 0, alert: 'orange' },
      { tsunami: 1 },
    ];
    for (const c of cases) {
      assertInRange(severityUsgs(c), JSON.stringify(c));
    }
  });
});

// ─── severityEonet ────────────────────────────────────────────────────────────

describe('severityEonet', () => {
  it('categoría desconocida → valor de fallback en [0,100]', () => {
    const s = severityEonet('unknownCategory');
    assertInRange(s, 'categoría desconocida');
  });

  it('volcano sin magnitudeValue → base 55 (solo base, sin componente log)', () => {
    const s = severityEonet('volcano');
    assertInRange(s, 'volcano sin mag');
    assert.strictEqual(s, 55);
  });

  it('wildfire con acres muy altos → severity alta (>= 60)', () => {
    const s = severityEonet('wildfire', 500_000, 'Acres');
    assertInRange(s, 'wildfire grande');
    assert.ok(s >= 60, `Se esperaba >= 60, got ${s}`);
  });

  it('wildfire con acres bajos → severity baja que wildfire con acres altos', () => {
    const sLow = severityEonet('wildfire', 100, 'Acres');
    const sHigh = severityEonet('wildfire', 800_000, 'Acres');
    assertInRange(sLow, 'wildfire pequeño');
    assertInRange(sHigh, 'wildfire grande');
    assert.ok(sHigh > sLow, `wildfire grande (${sHigh}) debe ser > pequeño (${sLow})`);
  });

  it('severeStorm con mb bajo (tifón intenso) → mayor que con mb alto (débil)', () => {
    // mb bajo = presión baja = tormenta intensa
    const intense = severityEonet('severeStorm', 900, 'mb');
    const weak = severityEonet('severeStorm', 1005, 'mb');
    assertInRange(intense, 'storm intenso');
    assertInRange(weak, 'storm débil');
    assert.ok(intense > weak, `storm intenso (${intense}) debe ser > débil (${weak})`);
  });

  it('dustHaze (categoría baja) → severity < volcano', () => {
    const dust = severityEonet('dustHaze');
    const vol = severityEonet('volcano');
    assertInRange(dust, 'dustHaze');
    assert.ok(dust < vol, `dustHaze (${dust}) debe ser < volcano (${vol})`);
  });

  it('magnitudeValue=0 → sin componente log (igual que sin magnitudeValue)', () => {
    const sinMag = severityEonet('flood');
    const conCero = severityEonet('flood', 0, 'Acres');
    // Con magnitudeValue=0 logNorm devuelve 0; debe ser igual al base
    assert.strictEqual(sinMag, conCero);
  });

  it('clamp duro: categoría alta + magnitudeValue extremo no supera 100', () => {
    const s = severityEonet('volcano', 9_999_999_999, 'Acres');
    assertInRange(s, 'volcano extremo');
    assert.ok(s <= 100);
  });

  it('salida en [0,100] con combinaciones extremas', () => {
    const cases: Array<Parameters<typeof severityEonet>> = [
      ['wildfire', undefined, undefined],
      ['wildfire', 0, 'Acres'],
      ['wildfire', 1_000_000, 'Acres'],
      ['severeStorm', 870, 'mb'],
      ['severeStorm', 1020, 'mb'],
      ['flood', 999999, 'km²'],
      ['drought', 10, 'default'],
    ];
    for (const [et, mv, mu] of cases) {
      assertInRange(severityEonet(et, mv, mu), `${et}/${mv}/${mu}`);
    }
  });
});

// ─── severityGdelt ────────────────────────────────────────────────────────────

describe('severityGdelt', () => {
  it('sin parámetros → valor de fallback en [0,100]', () => {
    const s = severityGdelt({});
    assertInRange(s, 'sin parámetros');
  });

  it('QuadClass=1 (verbal-coop) → severity baja (base 10)', () => {
    const s = severityGdelt({ quadClass: 1, goldstein: 0, avgTone: 0 });
    assertInRange(s, 'QuadClass=1');
    assert.strictEqual(s, 10);
  });

  it('QuadClass=4 (material-conflict) > QuadClass=1 con mismos Goldstein/Tone', () => {
    const s1 = severityGdelt({ quadClass: 1, goldstein: 0, avgTone: 0 });
    const s4 = severityGdelt({ quadClass: 4, goldstein: 0, avgTone: 0 });
    assertInRange(s1, 'QC1');
    assertInRange(s4, 'QC4');
    assert.ok(s4 > s1, `QuadClass=4 (${s4}) debe ser > QuadClass=1 (${s1})`);
  });

  it('QuadClass=3 (verbal-conf) < QuadClass=4 (material-conf)', () => {
    const s3 = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: 0 });
    const s4 = severityGdelt({ quadClass: 4, goldstein: 0, avgTone: 0 });
    assert.ok(s4 > s3, `QC4 (${s4}) debe ser > QC3 (${s3})`);
  });

  it('Goldstein muy negativo (-10) añade puntos vs Goldstein neutro (0)', () => {
    const neutral = severityGdelt({ quadClass: 4, goldstein: 0, avgTone: 0 });
    const maxConflict = severityGdelt({ quadClass: 4, goldstein: -10, avgTone: 0 });
    assertInRange(neutral, 'goldstein=0');
    assertInRange(maxConflict, 'goldstein=-10');
    assert.ok(maxConflict > neutral, `Goldstein -10 (${maxConflict}) debe ser > 0 (${neutral})`);
  });

  it('Goldstein positivo no añade puntos sobre base (solo negativo contribuye)', () => {
    const neutral = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: 0 });
    const positive = severityGdelt({ quadClass: 3, goldstein: 10, avgTone: 0 });
    assert.strictEqual(neutral, positive, 'Goldstein positivo no debe cambiar severity');
  });

  it('AvgTone muy negativo añade puntos vs AvgTone neutro', () => {
    const neutral = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: 0 });
    const hostile = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: -50 });
    assertInRange(hostile, 'avgTone=-50');
    assert.ok(hostile > neutral, `AvgTone hostil (${hostile}) debe ser > neutro (${neutral})`);
  });

  it('AvgTone positivo no añade puntos (solo negativo contribuye)', () => {
    const neutral = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: 0 });
    const positive = severityGdelt({ quadClass: 3, goldstein: 0, avgTone: 50 });
    assert.strictEqual(neutral, positive, 'AvgTone positivo no debe cambiar severity');
  });

  it('clamp duro: QuadClass=4 + Goldstein=-10 + AvgTone=-100 no supera 100', () => {
    const s = severityGdelt({ quadClass: 4, goldstein: -10, avgTone: -100 });
    assertInRange(s, 'extremo máximo');
    assert.ok(s <= 100);
  });

  it('clamp duro: valores negativos extremos no van bajo 0', () => {
    // QuadClass fuera de rango con Goldstein/Tone positivos → base fallback=20
    const s = severityGdelt({ quadClass: -99, goldstein: 100, avgTone: 100 });
    assertInRange(s, 'extremo mínimo');
    assert.ok(s >= 0);
  });

  it('salida en [0,100] con inputs extremos aleatorios', () => {
    const cases: Array<Parameters<typeof severityGdelt>[0]> = [
      { quadClass: 1, goldstein: 10, avgTone: 100 },
      { quadClass: 4, goldstein: -10, avgTone: -100 },
      { quadClass: 0, goldstein: -999, avgTone: -999 },
      { quadClass: 5, goldstein: 999, avgTone: 999 },
      {},
    ];
    for (const c of cases) {
      assertInRange(severityGdelt(c), JSON.stringify(c));
    }
  });
});

// ─── Comparación cross-source (escenarios narrativos) ─────────────────────────

describe('comparación cross-source (criterios narrativos)', () => {
  it('M9 + red + tsunami > ruido sísmico M0.2 (señal vs ruido)', () => {
    const big = severityUsgs({ mag: 9.0, sig: 900, alert: 'red', tsunami: 1 });
    const noise = severityUsgs({ mag: 0.2 });
    assert.ok(big > noise, `Gran sismo (${big}) debe ser > ruido (${noise})`);
  });

  it('wildfire masivo > incendio pequeño', () => {
    const large = severityEonet('wildfire', 900_000, 'Acres');
    const small = severityEonet('wildfire', 50, 'Acres');
    assert.ok(large > small, `Incendio masivo (${large}) debe ser > pequeño (${small})`);
  });

  it('GDELT QuadClass=4 + Goldstein=-8 + AvgTone=-30 > QuadClass=1', () => {
    const conflict = severityGdelt({ quadClass: 4, goldstein: -8, avgTone: -30 });
    const coop = severityGdelt({ quadClass: 1, goldstein: 5, avgTone: 10 });
    assert.ok(conflict > coop, `Conflicto material (${conflict}) debe ser > cooperación (${coop})`);
  });
});
