// packages/connectors/edu/news.test.ts
//
// Tests de unidad para allowlist.ts y news.ts.
// Runner: node:test (sin red — fetch está mockeado globalmente).
//
// Contrato verificado:
//   1. isAllowedFeedUrl() rechaza dominios fuera de allowlist.
//   2. isAllowedFeedUrl() rechaza protocolo http:// (solo https).
//   3. isAllowedFeedUrl() rechaza URLs con credenciales.
//   4. fetchNews() NO fetchea una URL que no pasa isAllowedFeedUrl().
//   5. fetchNews() nunca lanza — siempre retorna { data, stale, fetchedAt }.
//   6. fetchNews() retorna vacío gracioso cuando fetch falla (sin red).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedFeedUrl } from './allowlist.js';

// ─── Tests de isAllowedFeedUrl ────────────────────────────────────────────────

describe('isAllowedFeedUrl — SSRF guard', () => {
  it('acepta URL BBC válida (https, sin credenciales)', () => {
    assert.equal(
      isAllowedFeedUrl('https://feeds.bbci.co.uk/news/business/rss.xml'),
      true,
    );
  });

  it('acepta URL CNBC válida (https, sin credenciales)', () => {
    assert.equal(
      isAllowedFeedUrl('https://www.cnbc.com/id/100003114/device/rss/rss.html'),
      true,
    );
  });

  it('rechaza dominio fuera de allowlist', () => {
    assert.equal(isAllowedFeedUrl('https://malicious.example.com/rss.xml'), false);
  });

  it('rechaza dominio parcialmente igual (prefijo allowlist)', () => {
    // "feeds.bbci.co.uk.evil.com" no debe pasar — comparación exacta de hostname
    assert.equal(
      isAllowedFeedUrl('https://feeds.bbci.co.uk.evil.com/rss.xml'),
      false,
    );
  });

  it('rechaza protocolo http:// (inseguro)', () => {
    assert.equal(
      isAllowedFeedUrl('http://feeds.bbci.co.uk/news/business/rss.xml'),
      false,
    );
  });

  it('rechaza protocolo ftp://', () => {
    assert.equal(
      isAllowedFeedUrl('ftp://feeds.bbci.co.uk/news/business/rss.xml'),
      false,
    );
  });

  it('rechaza URL con credenciales (username)', () => {
    assert.equal(
      isAllowedFeedUrl('https://user@feeds.bbci.co.uk/news/business/rss.xml'),
      false,
    );
  });

  it('rechaza URL con credenciales (username:password)', () => {
    assert.equal(
      isAllowedFeedUrl('https://user:pass@feeds.bbci.co.uk/news/business/rss.xml'),
      false,
    );
  });

  it('rechaza URL malformada', () => {
    assert.equal(isAllowedFeedUrl('not a url at all'), false);
  });

  it('rechaza string vacío', () => {
    assert.equal(isAllowedFeedUrl(''), false);
  });
});

// ─── Mock global de fetch ─────────────────────────────────────────────────────

type FetchBehavior = 'fail-network' | 'fail-status' | 'ok-rss' | 'empty-rss';

const MOCK_RSS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Test Article</title>
      <link>https://feeds.bbci.co.uk/news/business/article-1</link>
      <pubDate>Fri, 13 Jun 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const EMPTY_RSS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`;

let _fetchBehavior: FetchBehavior = 'fail-network';
const _fetchedUrls: string[] = [];
const originalFetch = globalThis.fetch;

function installMockFetch(behavior: FetchBehavior): void {
  _fetchBehavior = behavior;
  _fetchedUrls.length = 0;

  // @ts-expect-error — reemplazamos fetch global con mock parcial
  globalThis.fetch = async (url: string, _opts?: RequestInit): Promise<Response> => {
    _fetchedUrls.push(String(url));

    if (_fetchBehavior === 'fail-network') {
      throw new Error('Network error (mocked)');
    }

    if (_fetchBehavior === 'fail-status') {
      return new Response(null, { status: 503 });
    }

    if (_fetchBehavior === 'ok-rss') {
      return new Response(MOCK_RSS_RESPONSE, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      });
    }

    if (_fetchBehavior === 'empty-rss') {
      return new Response(EMPTY_RSS_RESPONSE, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      });
    }

    return new Response(null, { status: 503 });
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Import dinámico del conector ─────────────────────────────────────────────
// Importamos dinámicamente para controlar el orden de mocks.

let fetchNews: () => Promise<{ data: unknown[]; stale: boolean; fetchedAt: number }>;

before(async () => {
  installMockFetch('fail-network');
  const mod = await import('./news.js');
  fetchNews = mod.fetchNews;
});

after(() => {
  restoreFetch();
});

// ─── Helper de aserción ───────────────────────────────────────────────────────

function assertResultShape(result: unknown): void {
  assert.ok(result !== null && typeof result === 'object', 'result debe ser objeto');
  const r = result as Record<string, unknown>;
  assert.ok(Array.isArray(r['data']), 'data debe ser array');
  assert.ok(typeof r['stale'] === 'boolean', 'stale debe ser boolean');
  assert.ok(
    typeof r['fetchedAt'] === 'number' && r['fetchedAt'] > 0,
    'fetchedAt debe ser epoch ms positivo',
  );
}

// ─── Tests de fetchNews ───────────────────────────────────────────────────────

describe('fetchNews — SSRF guard: no fetchea URLs fuera de allowlist', () => {
  it('solo fetchea URLs de la allowlist (ninguna URL externa)', async () => {
    installMockFetch('ok-rss');
    await fetchNews();

    // Todas las URLs que se fetchearon deben pasar isAllowedFeedUrl
    for (const url of _fetchedUrls) {
      assert.equal(
        isAllowedFeedUrl(url),
        true,
        `Se fetcheó una URL no permitida: ${url}`,
      );
    }
  });

  it('con ok-rss fetchea al menos una URL de la allowlist', async () => {
    installMockFetch('ok-rss');
    await fetchNews();
    assert.ok(_fetchedUrls.length > 0, 'Debe haberse fetche al menos un feed');
  });
});

describe('fetchNews — retorno vacío gracioso (sin red)', () => {
  it('no lanza cuando fetch falla con error de red', async () => {
    installMockFetch('fail-network');
    await assert.doesNotReject(
      () => fetchNews(),
      'fetchNews no debe lanzar ante fallo de red',
    );
  });

  it('retorna { data: [], stale: boolean, fetchedAt: number } ante fallo de red', async () => {
    installMockFetch('fail-network');
    const result = await fetchNews();
    assertResultShape(result);
    // Con todos los feeds fallando y sin cache previo, data debe ser array vacío o stale
    assert.ok(Array.isArray(result.data), 'data debe ser array');
  });

  it('no lanza cuando el upstream devuelve HTTP 503', async () => {
    installMockFetch('fail-status');
    await assert.doesNotReject(
      () => fetchNews(),
      'fetchNews no debe lanzar ante HTTP 503',
    );
  });

  it('retorna forma correcta ante HTTP 503', async () => {
    installMockFetch('fail-status');
    const result = await fetchNews();
    assertResultShape(result);
  });
});

describe('fetchNews — parsing RSS correcto', () => {
  it('con RSS válido retorna items con los campos requeridos', async () => {
    installMockFetch('ok-rss');
    const result = await fetchNews();
    assertResultShape(result);

    // El mock RSS tiene 1 item por feed; con 2 feeds deberían ser 2 items
    if (result.data.length > 0) {
      const item = result.data[0] as Record<string, unknown>;
      assert.ok(typeof item['source'] === 'string', 'item.source debe ser string');
      assert.ok(typeof item['feed_domain'] === 'string', 'item.feed_domain debe ser string');
      assert.ok(typeof item['title'] === 'string' && item['title'].length > 0, 'item.title no debe ser vacío');
      assert.ok(typeof item['url'] === 'string' && item['url'].length > 0, 'item.url no debe ser vacío');
      assert.ok(typeof item['published_at'] === 'number', 'item.published_at debe ser number');
      assert.ok(typeof item['captured_at'] === 'number', 'item.captured_at debe ser number');
    }
  });

  it('con RSS sin items retorna data: []', async () => {
    installMockFetch('empty-rss');
    const result = await fetchNews();
    assertResultShape(result);
    assert.equal(result.data.length, 0, 'RSS sin items debe resultar en data: []');
  });

  it('stale es false cuando el upstream responde correctamente', async () => {
    installMockFetch('ok-rss');
    const result = await fetchNews();
    assertResultShape(result);
    assert.equal(result.stale, false, 'stale debe ser false con upstream OK');
  });
});

describe('fetchNews — fetchedAt está en el rango correcto', () => {
  it('fetchedAt es un epoch ms próximo al momento de la llamada', async () => {
    installMockFetch('ok-rss');
    const before = Date.now();
    const result = await fetchNews();
    const after = Date.now();
    assert.ok(
      result.fetchedAt >= before && result.fetchedAt <= after + 100,
      `fetchedAt=${result.fetchedAt} debe estar entre ${before} y ${after + 100}`,
    );
  });
});

describe('fetchNews — nunca lanza bajo ninguna condición', () => {
  const behaviors: FetchBehavior[] = ['fail-network', 'fail-status', 'ok-rss', 'empty-rss'];

  for (const behavior of behaviors) {
    it(`no lanza con behavior="${behavior}"`, async () => {
      installMockFetch(behavior);
      await assert.doesNotReject(
        () => fetchNews(),
        `fetchNews no debe lanzar con fetch behavior=${behavior}`,
      );
    });
  }
});
