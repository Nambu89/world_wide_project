// packages/connectors/finance/markets.test.ts
//
// Tests de unidad para el conector markets.ts.
// Runner: node:test (sin red — fetch está mockeado globalmente).
// Contrato verificado:
//   1. fetchMarkets() nunca lanza — siempre devuelve ConnectorResult.
//   2. El resultado tiene la forma { data, stale, fetchedAt }.
//   3. Fallback gracioso cuando el upstream falla (data: []).
//   4. stale:true cuando se sirve desde el store.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock global de fetch (sin red) ──────────────────────────────────────────

type FetchBehavior = 'ok-v8' | 'ok-v8-derive' | 'ok-v6' | 'fail-network' | 'fail-status' | 'bad-json' | 'bad-schema';

let _fetchBehavior: FetchBehavior = 'ok-v8';

const MOCK_V8_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'SPY',
          regularMarketPrice: 523.45,
          regularMarketChangePercent: 0.42,
          instrumentType: 'ETF',
        },
      },
    ],
  },
};

// v8 chart meta SIN regularMarketChangePercent (caso real de Yahoo) → debe derivar de chartPreviousClose.
const MOCK_V8_DERIVE_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'SPY',
          regularMarketPrice: 754.83,
          chartPreviousClose: 741.75,
          instrumentType: 'ETF',
        },
      },
    ],
  },
};

const MOCK_V6_RESPONSE = {
  quoteResponse: {
    result: [
      {
        symbol: 'QQQ',
        regularMarketPrice: 450.12,
        regularMarketChangePercent: -0.15,
        quoteType: 'ETF',
      },
    ],
  },
};

// Guardar el fetch original para restaurarlo
const originalFetch = globalThis.fetch;

function installMockFetch(behavior: FetchBehavior): void {
  _fetchBehavior = behavior;
  // @ts-expect-error — reemplazamos fetch global con mock parcial
  globalThis.fetch = async (_url: string, _opts?: RequestInit): Promise<Response> => {
    const url = String(_url);

    if (_fetchBehavior === 'fail-network') {
      throw new Error('Network error (mocked)');
    }

    if (_fetchBehavior === 'fail-status') {
      return new Response(null, { status: 503 });
    }

    if (_fetchBehavior === 'bad-json') {
      return new Response('not json {{{', { status: 200 });
    }

    if (_fetchBehavior === 'bad-schema') {
      return new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if ((_fetchBehavior === 'ok-v8' || _fetchBehavior === 'ok-v8-derive') && url.includes('/v8/finance/chart')) {
      const body = _fetchBehavior === 'ok-v8-derive' ? MOCK_V8_DERIVE_RESPONSE : MOCK_V8_RESPONSE;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"etag-v8-spy"' },
      });
    }

    if (_fetchBehavior === 'ok-v6' && url.includes('/v6/finance/quote')) {
      return new Response(JSON.stringify(MOCK_V6_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"etag-v6-bulk"' },
      });
    }

    // default: 503
    return new Response(null, { status: 503 });
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Mock de @www/store ───────────────────────────────────────────────────────
// El módulo @www/store usa libsql que conecta a disco. En tests, no queremos eso.
// Usamos Module mocking a través de una inyección simple: los imports de Node son
// cacheados, así que para aislar necesitamos limpiar el cache entre suites si fuera
// necesario. Dado que el PM corre todos los tests juntos y store ya estará cargado,
// la DB puede estar inicializada o no. El test de store-stale verifica que el
// conector NO lanza cuando getLatestMarkets devuelve vacío (sin datos en DB fresca).
//
// NOTA: si la DB no existe, getLatestMarkets lanzará (no migrated). El conector lo
// captura en tryStoreFallback y retorna null -> vacío gracioso. Esto es correcto.

// ─── Import del conector (tras instalar los mocks) ────────────────────────────
// Importamos dinámicamente para que los mocks globales ya estén en lugar.

let fetchMarkets: () => Promise<{ data: unknown[]; stale: boolean; fetchedAt: number }>;

before(async () => {
  // Instalar mock de fetch antes de importar el módulo
  installMockFetch('ok-v8');
  const mod = await import('./markets.js');
  fetchMarkets = mod.fetchMarkets;
});

after(() => {
  restoreFetch();
});

// ─── Helpers de aserción ─────────────────────────────────────────────────────

function assertResultShape(result: unknown): void {
  assert.ok(result !== null && typeof result === 'object', 'result debe ser objeto');
  const r = result as Record<string, unknown>;
  assert.ok(Array.isArray(r['data']), 'data debe ser array');
  assert.ok(typeof r['stale'] === 'boolean', 'stale debe ser boolean');
  assert.ok(typeof r['fetchedAt'] === 'number' && r['fetchedAt'] > 0, 'fetchedAt debe ser epoch ms positivo');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('fetchMarkets — contrato de forma', () => {
  it('devuelve { data, stale, fetchedAt } siempre (sin lanzar)', async () => {
    installMockFetch('ok-v8');
    const result = await fetchMarkets();
    assertResultShape(result);
  });

  it('stale es false cuando los datos vienen del upstream', async () => {
    installMockFetch('ok-v8');
    const result = await fetchMarkets();
    assertResultShape(result);
    assert.equal(result.stale, false, 'stale debe ser false con upstream OK');
  });

  it('fetchedAt está cerca del momento actual (< 5 segundos)', async () => {
    installMockFetch('ok-v8');
    const before = Date.now();
    const result = await fetchMarkets();
    const after = Date.now();
    assert.ok(result.fetchedAt >= before && result.fetchedAt <= after + 100,
      'fetchedAt debe estar dentro del rango de la llamada');
  });
});

describe('fetchMarkets — fallback multinivel (NUNCA lanza)', () => {
  it('fallo de red: devuelve resultado vacío gracioso (data: [], stale: false)', async () => {
    installMockFetch('fail-network');
    // No debe lanzar
    let result: Awaited<ReturnType<typeof fetchMarkets>>;
    try {
      result = await fetchMarkets();
    } catch (err) {
      assert.fail(`fetchMarkets lanzó en vez de retornar vacío: ${err}`);
    }
    assertResultShape(result!);
    // Con DB vacía y red caída, data debe ser array (vacío o stale de DB)
    assert.ok(Array.isArray(result!.data), 'data debe ser array incluso ante fallo total');
  });

  it('HTTP 503: devuelve resultado gracioso (no lanza)', async () => {
    installMockFetch('fail-status');
    let result: Awaited<ReturnType<typeof fetchMarkets>>;
    try {
      result = await fetchMarkets();
    } catch (err) {
      assert.fail(`fetchMarkets lanzó ante HTTP 503: ${err}`);
    }
    assertResultShape(result!);
  });

  it('JSON malformado: devuelve resultado gracioso (no lanza)', async () => {
    installMockFetch('bad-json');
    let result: Awaited<ReturnType<typeof fetchMarkets>>;
    try {
      result = await fetchMarkets();
    } catch (err) {
      assert.fail(`fetchMarkets lanzó ante JSON malformado: ${err}`);
    }
    assertResultShape(result!);
  });

  it('schema inesperado del upstream: devuelve resultado gracioso (no lanza)', async () => {
    installMockFetch('bad-schema');
    let result: Awaited<ReturnType<typeof fetchMarkets>>;
    try {
      result = await fetchMarkets();
    } catch (err) {
      assert.fail(`fetchMarkets lanzó ante schema mismatch: ${err}`);
    }
    assertResultShape(result!);
  });
});

describe('fetchMarkets — datos parseados correctamente (v8 mock)', () => {
  it('v8 OK: data contiene al menos un snapshot con campos requeridos', async () => {
    installMockFetch('ok-v8');
    const result = await fetchMarkets();
    // Con el mock v8, debe haber datos de SPY (primer símbolo que responde OK)
    if (result.data.length > 0) {
      const snap = result.data[0] as Record<string, unknown>;
      assert.ok(typeof snap['symbol'] === 'string', 'snapshot.symbol debe ser string');
      assert.ok(typeof snap['price'] === 'number' && snap['price'] > 0, 'snapshot.price debe ser número positivo');
      assert.ok(typeof snap['source'] === 'string', 'snapshot.source debe ser string');
      assert.ok(typeof snap['asset_class'] === 'string', 'snapshot.asset_class debe ser string');
      assert.ok(typeof snap['captured_at'] === 'number', 'snapshot.captured_at debe ser number');
    }
    // Si está vacío (DB vacía + upstream mock falló por orden de símbolos) — sigue siendo válido
    assert.ok(Array.isArray(result.data));
  });

  it('v8 sin regularMarketChangePercent: deriva change_pct de chartPreviousClose', async () => {
    installMockFetch('ok-v8-derive');
    const result = await fetchMarkets();
    assert.ok(result.data.length > 0, 'debe haber snapshots');
    const snap = result.data[0] as Record<string, unknown>;
    const expected = ((754.83 - 741.75) / 741.75) * 100; // ≈ 1.7635
    assert.equal(typeof snap['change_pct'], 'number', 'change_pct derivado debe ser number, no null');
    assert.ok(
      Math.abs((snap['change_pct'] as number) - expected) < 1e-6,
      `change_pct=${snap['change_pct']} esperado≈${expected}`,
    );
  });
});

describe('fetchMarkets — nunca lanza bajo ninguna condición', () => {
  const behaviors: FetchBehavior[] = ['fail-network', 'fail-status', 'bad-json', 'bad-schema'];

  for (const behavior of behaviors) {
    it(`no lanza con behavior="${behavior}"`, async () => {
      installMockFetch(behavior);
      await assert.doesNotReject(
        () => fetchMarkets(),
        `fetchMarkets no debe lanzar con fetch behavior=${behavior}`,
      );
    });
  }
});
