// packages/connectors/geo/usgs.test.ts
//
// Tests para el conector USGS earthquakes (T-10a).
// Sin red: usa stubs de globalThis.fetch para aislar el upstream.
// Verifica: EventRow correcto, vacío gracioso sin lanzar, dedup de feeds.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

// ─── Stub de fetch ─────────────────────────────────────────────────────────────
// Sobrescribimos globalThis.fetch antes de importar el módulo bajo test.
// El módulo usa la referencia global al momento del fetch — el stub funciona
// incluso si el módulo cachea AbortSignal.timeout (los stubs se aplican antes).

type FetchStub = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;

function makeFetchStub(handler: FetchStub) {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ─── GeoJSON fixtures ──────────────────────────────────────────────────────────

const FEATURE_CALIFORNIA: Record<string, unknown> = {
  id: "us7000test01",
  type: "Feature",
  properties: {
    place: "Southern California",
    time: 1718000000000,
    mag: 6.5,
    sig: 650,
    alert: "yellow",
    tsunami: 0,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test01",
    status: "reviewed",
    mmi: 5.2,
    cdi: 4.8,
  },
  geometry: {
    type: "Point",
    // GeoJSON USGS: [lon, lat, depth]
    coordinates: [-118.2437, 34.0522, 10.0],
  },
};

const FEATURE_JAPAN: Record<string, unknown> = {
  id: "us7000test02",
  type: "Feature",
  properties: {
    place: "Honshu, Japan",
    time: 1717990000000,
    mag: 7.1,
    sig: 800,
    alert: "orange",
    tsunami: 1,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test02",
    status: "automatic",
    mmi: 7.0,
    cdi: 6.5,
  },
  geometry: {
    type: "Point",
    coordinates: [139.6917, 35.6895, 35.0],
  },
};

// Feature sin ID (debe descartarse silenciosamente)
const FEATURE_NO_ID: Record<string, unknown> = {
  type: "Feature",
  properties: { place: "Unknown", mag: 2.0, sig: 50 },
  geometry: { type: "Point", coordinates: [0, 0, 5] },
};

function makeGeoJson(features: unknown[]) {
  return JSON.stringify({
    type: "FeatureCollection",
    features,
  });
}

function makeResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Last-Modified": "Sun, 09 Jun 2024 12:00:00 GMT",
    },
  });
}

// ─── Importar módulo bajo test ─────────────────────────────────────────────────
// Se importa dinámicamente para que el stub de fetch ya esté instalado cuando
// el módulo inicialice sus variables de módulo (inFlight, lastGood).
// En la práctica fetchUsgs() llama a fetch en el momento del invoke, así que
// la importación estática también funciona — pero la dinámica es más explícita.
const { fetchUsgs } = await import("./usgs.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("usgs connector — T-10a", () => {

  // ── 1. Vacío gracioso sin red ──────────────────────────────────────────────
  describe("sin red — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() => Promise.reject(new Error("Network failure (test stub)")));
    });
    after(restoreFetch);

    it("devuelve data:[] y no lanza ante error de red", async () => {
      const result = await fetchUsgs();
      assert.deepEqual(result.data, [], "data debe ser array vacío");
      assert.equal(typeof result.fetchedAt, "number", "fetchedAt debe ser number");
      assert.equal(typeof result.stale, "boolean", "stale debe ser boolean");
    });
  });

  // ── 2. HTTP no-OK — vacío gracioso ─────────────────────────────────────────
  describe("HTTP 500 — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() => Promise.resolve(new Response("Internal Server Error", { status: 500 })));
    });
    after(restoreFetch);

    it("devuelve data:[] ante 500", async () => {
      const result = await fetchUsgs();
      assert.deepEqual(result.data, [], "data debe ser array vacío ante 500");
    });
  });

  // ── 3. Fixture GeoJSON → EventRow correctamente tipado ────────────────────
  describe("fixture GeoJSON — mapeo correcto a EventRow", () => {
    before(() => {
      makeFetchStub((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("significant_week")) {
          return Promise.resolve(makeResponse(makeGeoJson([FEATURE_CALIFORNIA])));
        }
        if (urlStr.includes("all_day")) {
          return Promise.resolve(makeResponse(makeGeoJson([FEATURE_JAPAN])));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      });
    });
    after(restoreFetch);

    it("cada EventRow tiene event_type=earthquake, category=natural", async () => {
      const result = await fetchUsgs();
      assert.ok(result.data.length > 0, "debe haber al menos 1 EventRow");
      for (const row of result.data) {
        assert.equal(row.eventType, "earthquake", `eventType debe ser 'earthquake', got '${row.eventType}'`);
        assert.equal(row.category, "natural", `category debe ser 'natural', got '${row.category}'`);
        assert.equal(row.source, "usgs", `source debe ser 'usgs'`);
      }
    });

    it("severity está en [0, 100]", async () => {
      const result = await fetchUsgs();
      for (const row of result.data) {
        const s = row.severity;
        assert.ok(s !== null && s >= 0 && s <= 100, `severity fuera de rango: ${s}`);
      }
    });

    it("lat/lon son las coords del epicentro (no centroide de país)", async () => {
      const result = await fetchUsgs();
      // California: lat=34.0522, lon=-118.2437
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "debe existir la feature California");
      assert.ok(Math.abs((ca.lat ?? 0) - 34.0522) < 0.001, `lat esperado ~34.05, got ${ca.lat}`);
      assert.ok(Math.abs((ca.lon ?? 0) - (-118.2437)) < 0.001, `lon esperado ~-118.24, got ${ca.lon}`);
    });

    it("sourceEventId correcto", async () => {
      const result = await fetchUsgs();
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "sourceEventId us7000test01 presente");
    });

    it("occurredAt viene de properties.time (epoch ms)", async () => {
      const result = await fetchUsgs();
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "feature California presente");
      assert.equal(ca.occurredAt, 1718000000000, "occurredAt debe ser properties.time");
    });

    it("title viene de properties.place", async () => {
      const result = await fetchUsgs();
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "feature California presente");
      assert.equal(ca.title, "Southern California", "title debe ser properties.place");
    });

    it("url viene de properties.url", async () => {
      const result = await fetchUsgs();
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "feature California presente");
      assert.ok(ca.url?.includes("us7000test01"), "url debe contener el id del evento");
    });

    it("rawJson incluye alert, sig, mmi, cdi, tsunami, depth, status", async () => {
      const result = await fetchUsgs();
      const jp = result.data.find((r) => r.sourceEventId === "us7000test02");
      assert.ok(jp, "feature Japan presente");
      const parsed = JSON.parse(jp.rawJson ?? "{}");
      assert.ok("alert" in parsed, "rawJson debe tener alert");
      assert.ok("sig" in parsed, "rawJson debe tener sig");
      assert.ok("mmi" in parsed, "rawJson debe tener mmi");
      assert.ok("cdi" in parsed, "rawJson debe tener cdi");
      assert.ok("tsunami" in parsed, "rawJson debe tener tsunami");
      assert.ok("depth" in parsed, "rawJson debe tener depth");
      assert.ok("status" in parsed, "rawJson debe tener status");
    });
  });

  // ── 4. Dedup de feeds solapados ────────────────────────────────────────────
  describe("dedup — el mismo feature.id en ambos feeds no se duplica", () => {
    before(() => {
      // Ambos feeds devuelven la misma feature
      const duplicatedBody = makeGeoJson([FEATURE_CALIFORNIA]);
      makeFetchStub(() => Promise.resolve(makeResponse(duplicatedBody)));
    });
    after(restoreFetch);

    it("dedup produce un solo EventRow por feature.id", async () => {
      const result = await fetchUsgs();
      const ids = result.data.map((r) => r.sourceEventId);
      const unique = new Set(ids);
      assert.equal(ids.length, unique.size, `IDs duplicados detectados: ${ids.join(", ")}`);
    });
  });

  // ── 5. Feature sin ID — descartada silenciosamente ─────────────────────────
  describe("feature sin id — descartada sin lanzar", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(makeResponse(makeGeoJson([FEATURE_NO_ID, FEATURE_CALIFORNIA])))
      );
    });
    after(restoreFetch);

    it("feature sin id no produce EventRow; la feature con id sí", async () => {
      const result = await fetchUsgs();
      // Solo CALIFORNIA debe aparecer (FEATURE_NO_ID no tiene id → descartado)
      const ca = result.data.find((r) => r.sourceEventId === "us7000test01");
      assert.ok(ca, "California debe estar presente");
      // No debe haber rows con id vacío
      const noId = result.data.filter((r) => !r.sourceEventId);
      assert.equal(noId.length, 0, "no debe haber rows sin sourceEventId");
    });
  });

  // ── 6. Severity PAGER — alerta orange + tsunami da severity alta ───────────
  describe("severity PAGER — alerta orange + tsunami ≥ 65", () => {
    before(() => {
      makeFetchStub((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("significant_week")) {
          return Promise.resolve(makeResponse(makeGeoJson([FEATURE_JAPAN])));
        }
        return Promise.resolve(makeResponse(makeGeoJson([])));
      });
    });
    after(restoreFetch);

    it("Japan (alert=orange, tsunami=1) produce severity >= 75", async () => {
      const result = await fetchUsgs();
      const jp = result.data.find((r) => r.sourceEventId === "us7000test02");
      assert.ok(jp, "feature Japan presente");
      // alert=orange → piso 65, sig=800 → base=80, tsunami +10 → 90, clamp → 90
      assert.ok((jp.severity ?? 0) >= 75, `severity esperada >=75, got ${jp.severity}`);
    });
  });

  // ── 7. stale:false en éxito, datos reales ─────────────────────────────────
  describe("respuesta OK — stale:false", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(makeResponse(makeGeoJson([FEATURE_CALIFORNIA])))
      );
    });
    after(restoreFetch);

    it("stale es false en respuesta exitosa", async () => {
      const result = await fetchUsgs();
      assert.equal(result.stale, false, "stale debe ser false en éxito");
      assert.ok(result.fetchedAt > 0, "fetchedAt debe ser timestamp positivo");
    });
  });

  // ── 8. JSON malformado — vacío gracioso ────────────────────────────────────
  describe("JSON malformado — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(new Response("not-json{{", { status: 200, headers: { "Content-Type": "application/json" } }))
      );
    });
    after(restoreFetch);

    it("JSON inválido produce data:[] sin lanzar", async () => {
      let threw = false;
      let result;
      try {
        result = await fetchUsgs();
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "fetchUsgs no debe lanzar ante JSON inválido");
      // Si ambos feeds fallan al parsear, puede devolver stale o vacío
      assert.ok(Array.isArray(result?.data), "data debe ser array");
    });
  });

});
