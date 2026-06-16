// packages/connectors/finance/sanctions.test.ts
//
// Tests de unidad para el conector sanctions.ts.
// Runner: node:test (sin red — fetch mockeado globalmente).
// Contrato verificado:
//   1. fetchSanctions() NUNCA lanza — siempre devuelve ConnectorResult.
//   2. Parseo CSV quote-aware: comas dentro de campos entrecomillados.
//   3. Agregación correcta por país (ISO-2 → Intl.DisplayNames + CANONICAL_ALIASES).
//   4. W3: deriva el índice de `countries` del header (robusto a reordenación).
//   5. ISO basura / vacío → drop gracioso (no contamina el resultado).
//   6. HTTP fail / timeout / CSV malformado → ConnectorResult vacío, sin throw.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ─── Fixtures CSV ─────────────────────────────────────────────────────────────

// Fixture mínimo: header + 3 filas.
// Fila 1: name con coma dentro de quotes, countries = "ru"
// Fila 2: multi-país "ru;kp"
// Fila 3: alias CD → "Congo (Kinshasa)"
// Fila 4: ISO basura "zz" → debe dropearse
const FIXTURE_CSV_STANDARD = [
  'id,schema,name,aliases,birth_date,countries,addresses,identifiers,sanctions,phones,emails,program_ids,dataset,first_seen,last_seen,last_change',
  '"ent-001","Person","Smith, John","",,"ru","addr1","","SDN",,,"IRAN",us_ofac_sdn,2020-01-01,2024-01-01,2024-01-01',
  '"ent-002","Entity","NK Corp","",,"ru;kp","","","SDN",,,"DPRK",us_ofac_sdn,2021-01-01,2024-01-01,2024-01-01',
  '"ent-003","Entity","Congo Firm","",,"cd","","","SDN",,,"DPRK",us_ofac_sdn,2021-01-01,2024-01-01,2024-01-01',
  '"ent-004","Entity","Bad ISO","",,"zz","","","SDN",,,"DPRK",us_ofac_sdn,2021-01-01,2024-01-01,2024-01-01',
].join('\n');

// Fixture W3: columna countries en posición diferente (reordenada).
// El conector debe derivar el índice del header, no hardcodearlo.
const FIXTURE_CSV_REORDERED = [
  'id,schema,name,countries,aliases,birth_date,addresses', // countries en pos 3 (no 5)
  '"ent-001","Person","Smith","ir","","",""',
  '"ent-002","Entity","Corp","ir;sy","","",""',
].join('\n');

// Fixture de CSV malformado (header sin columna countries).
const FIXTURE_CSV_NO_COUNTRIES = [
  'id,schema,name,aliases',
  '"ent-001","Person","Smith","alias1"',
].join('\n');

// Fixture vacío.
const FIXTURE_CSV_EMPTY = '';

// ─── Mock global de fetch ─────────────────────────────────────────────────────

type FetchBehavior = 'ok-standard' | 'ok-reordered' | 'fail-network' | 'fail-status' | 'bad-csv';

let _behavior: FetchBehavior = 'ok-standard';

const originalFetch = globalThis.fetch;

function installMock(behavior: FetchBehavior): void {
  _behavior = behavior;
  // @ts-expect-error — reemplazamos fetch global con mock parcial
  globalThis.fetch = async (_url: string, _opts?: RequestInit): Promise<Response> => {
    if (_behavior === 'fail-network') {
      throw new Error('Network error (mocked)');
    }
    if (_behavior === 'fail-status') {
      return new Response(null, { status: 503 });
    }
    if (_behavior === 'bad-csv') {
      return new Response(FIXTURE_CSV_NO_COUNTRIES, { status: 200 });
    }
    if (_behavior === 'ok-reordered') {
      return new Response(FIXTURE_CSV_REORDERED, { status: 200 });
    }
    // 'ok-standard'
    return new Response(FIXTURE_CSV_STANDARD, { status: 200 });
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Import del módulo bajo test ──────────────────────────────────────────────

let fetchSanctions: () => Promise<{ data: unknown[]; stale: boolean; fetchedAt: number }>;
let parseCsvLine: (line: string) => string[];
let aggregateFromCsv: (csv: string, capturedAt: number) => unknown[];
let isoToName: (iso2: string) => string | null;

before(async () => {
  installMock('ok-standard');
  const mod = await import('./sanctions.js');
  fetchSanctions = mod.fetchSanctions as typeof fetchSanctions;
  parseCsvLine = mod.parseCsvLine;
  aggregateFromCsv = mod.aggregateFromCsv;
  isoToName = mod.isoToName;
});

after(() => {
  restoreFetch();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertResultShape(result: unknown): void {
  assert.ok(result !== null && typeof result === 'object', 'result debe ser objeto');
  const r = result as Record<string, unknown>;
  assert.ok(Array.isArray(r['data']), 'data debe ser array');
  assert.ok(typeof r['stale'] === 'boolean', 'stale debe ser boolean');
  assert.ok(typeof r['fetchedAt'] === 'number' && r['fetchedAt'] > 0, 'fetchedAt debe ser epoch ms positivo');
}

// ─── parseCsvLine — unit tests ────────────────────────────────────────────────

describe('parseCsvLine — parseo quote-aware', () => {
  it('campo simple sin comillas', () => {
    const result = parseCsvLine('a,b,c');
    assert.deepEqual(result, ['a', 'b', 'c']);
  });

  it('campo entrecomillado con coma interna', () => {
    const result = parseCsvLine('"Smith, John","Entity","ru"');
    assert.deepEqual(result, ['Smith, John', 'Entity', 'ru']);
  });

  it('campo vacío entre comas', () => {
    const result = parseCsvLine('a,,c');
    assert.deepEqual(result, ['a', '', 'c']);
  });

  it('campo vacío entre comillas', () => {
    const result = parseCsvLine('"a","","c"');
    assert.deepEqual(result, ['a', '', 'c']);
  });

  it('doble-comilla dentro de campo = escape de comilla', () => {
    const result = parseCsvLine('"say ""hello""",b');
    assert.deepEqual(result, ['say "hello"', 'b']);
  });

  it('campo con punto y coma (no confunde con separador CSV)', () => {
    const result = parseCsvLine('"ent-001","Person","ru;kp"');
    assert.deepEqual(result, ['ent-001', 'Person', 'ru;kp']);
  });
});

// ─── isoToName — unit tests ───────────────────────────────────────────────────

describe('isoToName — ISO-2 → nombre canónico', () => {
  it('ru → Russia', () => {
    assert.equal(isoToName('ru'), 'Russia');
  });

  it('kp → North Korea', () => {
    assert.equal(isoToName('kp'), 'North Korea');
  });

  it('cd → Congo (Kinshasa) (alias canónico del proyecto)', () => {
    assert.equal(isoToName('cd'), 'Congo (Kinshasa)');
  });

  it('cg → Congo (Brazzaville) (alias canónico del proyecto)', () => {
    assert.equal(isoToName('cg'), 'Congo (Brazzaville)');
  });

  it('ps → Palestinian Territories (alias canónico del proyecto)', () => {
    assert.equal(isoToName('ps'), 'Palestinian Territories');
  });

  it('cz → Czech Republic (alias canónico del proyecto)', () => {
    assert.equal(isoToName('cz'), 'Czech Republic');
  });

  it('mm → Myanmar (alias canónico del proyecto)', () => {
    assert.equal(isoToName('mm'), 'Myanmar');
  });

  // Cazados por el smoke EN VIVO (Intl.DisplayNames usa endónimo/SAR que no casa con COUNTRY_CENTROIDS)
  it('tr → Turkey (no "Türkiye")', () => {
    assert.equal(isoToName('tr'), 'Turkey');
  });

  it('hk → Hong Kong (no "Hong Kong SAR China")', () => {
    assert.equal(isoToName('hk'), 'Hong Kong');
  });

  it('ISO basura "zz" → null (drop gracioso)', () => {
    assert.equal(isoToName('zz'), null);
  });

  it('cadena vacía → null (drop gracioso)', () => {
    assert.equal(isoToName(''), null);
  });

  it('código de 3 letras → null (no es ISO-2)', () => {
    assert.equal(isoToName('rus'), null);
  });
});

// ─── aggregateFromCsv — unit tests ────────────────────────────────────────────

describe('aggregateFromCsv — agregación por país', () => {
  it('fixture estándar: conteos correctos', () => {
    const rows = aggregateFromCsv(FIXTURE_CSV_STANDARD, 1000) as Array<{
      country: string; sanctionedCount: number; capturedAt: number
    }>;
    const byCountry = Object.fromEntries(rows.map(r => [r.country, r.sanctionedCount]));

    // ru aparece en ent-001 y ent-002 → 2
    assert.equal(byCountry['Russia'], 2, 'Russia debe tener 2');
    // kp aparece en ent-002 → 1
    assert.equal(byCountry['North Korea'], 1, 'North Korea debe tener 1');
    // cd → Congo (Kinshasa) → 1
    assert.equal(byCountry['Congo (Kinshasa)'], 1, 'Congo (Kinshasa) debe tener 1');
    // zz → drop gracioso, no debe aparecer
    assert.equal(byCountry['zz'], undefined, 'ISO basura zz no debe aparecer');
    // capturedAt propagado
    for (const row of rows) {
      assert.equal(row.capturedAt, 1000, 'capturedAt debe ser el valor pasado');
    }
  });

  it('W3 — header reordenado: conteos correctos igualmente', () => {
    const rows = aggregateFromCsv(FIXTURE_CSV_REORDERED, 2000) as Array<{
      country: string; sanctionedCount: number
    }>;
    const byCountry = Object.fromEntries(rows.map(r => [r.country, r.sanctionedCount]));
    // ir aparece en ent-001 y ent-002 → 2
    assert.equal(byCountry['Iran'], 2, 'Iran debe tener 2 con header reordenado');
    // sy aparece en ent-002 → 1
    assert.equal(byCountry['Syria'], 1, 'Syria debe tener 1 con header reordenado');
  });

  it('CSV sin columna countries → array vacío gracioso', () => {
    const rows = aggregateFromCsv(FIXTURE_CSV_NO_COUNTRIES, 3000);
    assert.deepEqual(rows, []);
  });

  it('CSV vacío → array vacío gracioso', () => {
    const rows = aggregateFromCsv(FIXTURE_CSV_EMPTY, 4000);
    assert.deepEqual(rows, []);
  });
});

// ─── fetchSanctions — contrato de forma ──────────────────────────────────────

describe('fetchSanctions — contrato de forma', () => {
  it('devuelve { data, stale, fetchedAt } siempre (sin lanzar)', async () => {
    installMock('ok-standard');
    const result = await fetchSanctions();
    assertResultShape(result);
  });

  it('stale es false cuando los datos vienen del upstream', async () => {
    installMock('ok-standard');
    const result = await fetchSanctions();
    assertResultShape(result);
    assert.equal(result.stale, false, 'stale debe ser false con upstream OK');
  });

  it('data contiene SanctionRows con campos requeridos', async () => {
    installMock('ok-standard');
    const result = await fetchSanctions();
    assertResultShape(result);
    if (result.data.length > 0) {
      const row = result.data[0] as Record<string, unknown>;
      assert.ok(typeof row['country'] === 'string' && row['country'].length > 0, 'country debe ser string no vacío');
      assert.ok(typeof row['sanctionedCount'] === 'number' && (row['sanctionedCount'] as number) > 0, 'sanctionedCount debe ser número positivo');
      assert.ok(typeof row['capturedAt'] === 'number' && (row['capturedAt'] as number) > 0, 'capturedAt debe ser epoch ms positivo');
    }
  });
});

// ─── fetchSanctions — fallback multinivel (NUNCA lanza) ──────────────────────

describe('fetchSanctions — fallback multinivel (NUNCA lanza)', () => {
  it('fallo de red → resultado vacío gracioso (data: [])', async () => {
    installMock('fail-network');
    let result: Awaited<ReturnType<typeof fetchSanctions>>;
    try {
      result = await fetchSanctions();
    } catch (err) {
      assert.fail(`fetchSanctions lanzó ante fallo de red: ${err}`);
    }
    assertResultShape(result!);
    assert.ok(Array.isArray(result!.data), 'data debe ser array ante fallo de red');
  });

  it('HTTP 503 → resultado vacío gracioso (no lanza)', async () => {
    installMock('fail-status');
    let result: Awaited<ReturnType<typeof fetchSanctions>>;
    try {
      result = await fetchSanctions();
    } catch (err) {
      assert.fail(`fetchSanctions lanzó ante HTTP 503: ${err}`);
    }
    assertResultShape(result!);
  });

  it('CSV sin columna countries → resultado vacío gracioso (no lanza)', async () => {
    installMock('bad-csv');
    let result: Awaited<ReturnType<typeof fetchSanctions>>;
    try {
      result = await fetchSanctions();
    } catch (err) {
      assert.fail(`fetchSanctions lanzó ante CSV sin countries: ${err}`);
    }
    assertResultShape(result!);
  });
});

// ─── fetchSanctions — doesNotReject en todos los modos de fallo ───────────────

describe('fetchSanctions — nunca lanza bajo ninguna condición', () => {
  const failModes: FetchBehavior[] = ['fail-network', 'fail-status', 'bad-csv'];

  for (const mode of failModes) {
    it(`no lanza con behavior="${mode}"`, async () => {
      installMock(mode);
      await assert.doesNotReject(
        () => fetchSanctions(),
        `fetchSanctions no debe lanzar con behavior=${mode}`,
      );
    });
  }
});
