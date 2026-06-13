// packages/connectors/geo/gdelt.test.ts
// node:test — NO network access (fetch mockeado en todos los casos)
//
// Verifica:
//  1. Respuesta DOC válida → mapea a GdeltEvent con event_id, centroide correcto para país conocido
//  2. País desconocido / sin sourcecountry → lat/lon null
//  3. Fallo de red / HTTP error → vacío gracioso sin throw

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Stub local de GdeltEvent (misma forma que @www/store — evita resolver la dep)
// ---------------------------------------------------------------------------
interface GdeltEvent {
  source: string;
  event_id: string;
  category: string | null;
  severity: number | null;
  lat: number | null;
  lon: number | null;
  captured_at: number;
}

// ---------------------------------------------------------------------------
// fetch mock infrastructure
// ---------------------------------------------------------------------------

type MockFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const originalFetch = globalThis.fetch;

function installMock(fn: MockFetchFn): void {
  // @ts-ignore — reemplazamos global para aislamiento de tests
  globalThis.fetch = fn;
}

function restoreFetch(): void {
  // @ts-ignore
  globalThis.fetch = originalFetch;
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Payload mock DOC 2.0 API — forma real de la respuesta
// ---------------------------------------------------------------------------

const MOCK_DOC_VALID = {
  articles: [
    {
      url: "https://example.com/article/us-economy-2026",
      title: "US Economy Shows Growth",
      seendate: "20260613T120000Z",
      domain: "example.com",
      language: "English",
      sourcecountry: "United States",
    },
    {
      url: "https://es.example.com/articulo/economia-espana",
      title: "Economía española en alza",
      seendate: "20260613T110000Z",
      domain: "es.example.com",
      language: "Spanish",
      sourcecountry: "Spain",
    },
    {
      // País no conocido en el mapa de centroides
      url: "https://zz.example.com/unknown-country",
      title: "Economy news from unknown country",
      seendate: "20260613T100000Z",
      domain: "zz.example.com",
      language: "English",
      sourcecountry: "Ruritania",
    },
    {
      // Sin sourcecountry
      url: "https://nocontry.example.com/article",
      title: "Global markets update",
      seendate: "20260613T090000Z",
      domain: "nocontry.example.com",
      language: "English",
      // sourcecountry ausente deliberadamente
    },
  ],
};

// ---------------------------------------------------------------------------
// Import del conector (una sola vez — single-flight se resetea con los mocks)
// ---------------------------------------------------------------------------
import { fetchGdelt } from "./gdelt.js";

// ---------------------------------------------------------------------------
// Suite 1: fallo de red → vacío gracioso
// ---------------------------------------------------------------------------

describe("fetchGdelt — fallo de red", () => {
  before(() => {
    installMock(() => Promise.reject(new Error("network unavailable")));
  });

  after(() => {
    restoreFetch();
  });

  it("retorna data=[] cuando fetch lanza", async () => {
    const result = await fetchGdelt();
    assert.ok(Array.isArray(result.data), "data debe ser array");
    assert.equal(result.data.length, 0, "data debe estar vacío en fallo");
    assert.equal(typeof result.fetchedAt, "number", "fetchedAt debe ser number");
    assert.equal(typeof result.stale, "boolean", "stale debe ser boolean");
  });

  it("nunca lanza — fetchGdelt siempre resuelve", async () => {
    let threw = false;
    try {
      await fetchGdelt();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "fetchGdelt no debe lanzar nunca");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: HTTP error → vacío gracioso
// ---------------------------------------------------------------------------

describe("fetchGdelt — HTTP error (503)", () => {
  before(() => {
    installMock(() => Promise.resolve(new Response(null, { status: 503 })));
  });

  after(() => {
    restoreFetch();
  });

  it("retorna vacío gracioso en HTTP 503", async () => {
    const result = await fetchGdelt();
    assert.equal(result.data.length, 0);
    assert.equal(result.stale, false);
  });

  it("nunca lanza en HTTP error", async () => {
    let threw = false;
    try {
      await fetchGdelt();
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: HTTP 404 (endpoint GEO muerto) → vacío gracioso
// ---------------------------------------------------------------------------

describe("fetchGdelt — HTTP 404 (simula GEO API muerta)", () => {
  before(() => {
    installMock(() => Promise.resolve(new Response(null, { status: 404 })));
  });

  after(() => {
    restoreFetch();
  });

  it("retorna vacío gracioso en HTTP 404", async () => {
    const result = await fetchGdelt();
    assert.equal(result.data.length, 0);
    assert.equal(result.stale, false);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: respuesta DOC válida → mapeo correcto
// ---------------------------------------------------------------------------

describe("fetchGdelt — respuesta DOC 2.0 válida", () => {
  before(() => {
    installMock(() => Promise.resolve(makeJsonResponse(MOCK_DOC_VALID)));
  });

  after(() => {
    restoreFetch();
  });

  it("retorna 4 eventos mapeados", async () => {
    const result = await fetchGdelt();
    assert.equal(result.data.length, 4, "debe haber 4 eventos");
    assert.equal(result.stale, false);
  });

  it("todos los eventos tienen source='gdelt'", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal(ev.source, "gdelt");
    }
  });

  it("event_id empieza por 'gdelt_' y es string no vacío", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal(typeof ev.event_id, "string");
      assert.match(ev.event_id, /^gdelt_/);
      assert.ok(ev.event_id.length > 6, "event_id no debe ser stub vacío");
    }
  });

  it("United States → centroide correcto (lat≈38.9, lon≈-77.0)", async () => {
    const result = await fetchGdelt();
    const ev = result.data[0] as GdeltEvent;
    assert.ok(ev.lat !== null, "lat no debe ser null para United States");
    assert.ok(ev.lon !== null, "lon no debe ser null para United States");
    // Tolerancia ±0.5 grados (son centroides aproximados)
    assert.ok(Math.abs((ev.lat as number) - 38.9) < 0.5, `lat esperado ~38.9, recibido ${ev.lat}`);
    assert.ok(Math.abs((ev.lon as number) - (-77.0)) < 0.5, `lon esperado ~-77.0, recibido ${ev.lon}`);
  });

  it("Spain → centroide correcto (lat≈40.5, lon≈-3.7)", async () => {
    const result = await fetchGdelt();
    const ev = result.data[1] as GdeltEvent;
    assert.ok(ev.lat !== null, "lat no debe ser null para Spain");
    assert.ok(ev.lon !== null, "lon no debe ser null para Spain");
    assert.ok(Math.abs((ev.lat as number) - 40.5) < 0.5, `lat esperado ~40.5, recibido ${ev.lat}`);
    assert.ok(Math.abs((ev.lon as number) - (-3.7)) < 0.5, `lon esperado ~-3.7, recibido ${ev.lon}`);
  });

  it("país desconocido (Ruritania) → lat=null, lon=null", async () => {
    const result = await fetchGdelt();
    const ev = result.data[2] as GdeltEvent;
    assert.equal(ev.lat, null, "país desconocido debe producir lat=null");
    assert.equal(ev.lon, null, "país desconocido debe producir lon=null");
  });

  it("artículo sin sourcecountry → lat=null, lon=null", async () => {
    const result = await fetchGdelt();
    const ev = result.data[3] as GdeltEvent;
    assert.equal(ev.lat, null, "sin sourcecountry debe producir lat=null");
    assert.equal(ev.lon, null, "sin sourcecountry debe producir lon=null");
  });

  it("severity=null (artlist no da tono)", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal(ev.severity, null, "severity debe ser null con artlist");
    }
  });

  it("captured_at es timestamp reciente", async () => {
    const before = Date.now();
    const result = await fetchGdelt();
    const after = Date.now();
    for (const ev of result.data as GdeltEvent[]) {
      assert.ok(
        (ev as GdeltEvent).captured_at >= before - 100 &&
          (ev as GdeltEvent).captured_at <= after + 100,
        `captured_at fuera de rango: ${(ev as GdeltEvent).captured_at}`
      );
    }
  });

  it("category usa domain cuando está presente", async () => {
    const result = await fetchGdelt();
    const ev = result.data[0] as GdeltEvent;
    // Primer artículo tiene domain="example.com"
    assert.equal(ev.category, "example.com");
  });
});

// ---------------------------------------------------------------------------
// Suite 5: JSON malformado (schema mismatch) → vacío gracioso
// ---------------------------------------------------------------------------

describe("fetchGdelt — JSON malformado / sin articles", () => {
  before(() => {
    installMock(() =>
      Promise.resolve(makeJsonResponse({ wrong: "shape", items: [] }))
    );
  });

  after(() => {
    restoreFetch();
  });

  it("vacío gracioso en schema mismatch — nunca lanza", async () => {
    let threw = false;
    let result: Awaited<ReturnType<typeof fetchGdelt>> | undefined;
    try {
      result = await fetchGdelt();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "fetchGdelt no debe lanzar en schema mismatch");
    assert.ok(result !== undefined);
    assert.ok(Array.isArray(result!.data), "data debe ser array");
    assert.ok(typeof result!.stale === "boolean");
    assert.ok(typeof result!.fetchedAt === "number");
  });
});
