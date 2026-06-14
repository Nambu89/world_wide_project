// packages/connectors/geo/eonet.test.ts
//
// Tests unitarios de fetchEonet() y del mapper interno.
// Sin red: se monkey-patchea globalThis.fetch para inyectar fixtures o simular fallos.

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchEonet, _resetCache } from "./eonet.js";

// ─── Fixture GeoJSON EONET (subset realista con múltiples categorías) ─────────

const FIXTURE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    // wildfire (wildfires)
    {
      id: "EONET_1001",
      title: "Big Sur Fire",
      categories: [{ id: "wildfires", title: "Wildfires" }],
      sources: [{ id: "PDC", url: "https://example.com/wildfire/1001" }],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [-121.5, 36.2],
            date: "2026-06-10T12:00:00Z",
            magnitudeValue: 15000,
            magnitudeUnit: "acres",
          },
        ],
      },
      closed: null,
    },
    // volcano (volcanoes)
    {
      id: "EONET_1002",
      title: "Kilauea Activity",
      categories: [{ id: "volcanoes", title: "Volcanoes" }],
      sources: [{ id: "HVO", url: "https://example.com/volcano/1002" }],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [-155.3, 19.4],
            date: "2026-06-11T08:00:00Z",
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      },
      closed: null,
    },
    // storm (severeStorms)
    {
      id: "EONET_1003",
      title: "Typhoon Khanun",
      categories: [{ id: "severeStorms", title: "Severe Storms" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [125.0, 18.0],
            date: "2026-06-12T00:00:00Z",
            magnitudeValue: 920,
            magnitudeUnit: "mb",
          },
        ],
      },
      closed: null,
    },
    // flood (floods)
    {
      id: "EONET_1004",
      title: "Amazon Basin Flood",
      categories: [{ id: "floods", title: "Floods" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [-60.0, -3.5],
            date: "2026-06-09T00:00:00Z",
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      },
      closed: null,
    },
    // landslide (landslides)
    {
      id: "EONET_1005",
      title: "Nepal Landslide",
      categories: [{ id: "landslides", title: "Landslides" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [84.0, 28.0],
            date: "2026-06-08T06:00:00Z",
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      },
      closed: null,
    },
    // drought (drought)
    {
      id: "EONET_1006",
      title: "Sahel Drought",
      categories: [{ id: "drought", title: "Drought" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [15.0, 14.0],
            date: "2026-05-01T00:00:00Z",
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      },
      closed: null,
    },
    // tempExtreme (tempExtremes)
    {
      id: "EONET_1007",
      title: "Extreme Heat Pakistan",
      categories: [{ id: "tempExtremes", title: "Temperature Extremes" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [68.0, 30.0],
            date: "2026-06-01T00:00:00Z",
            magnitudeValue: null,
            magnitudeUnit: null,
          },
        ],
      },
      closed: null,
    },
    // earthquake EONET → DEBE DESCARTARSE (USGS es la fuente sísmica)
    {
      id: "EONET_9001",
      title: "M 5.2 - Off Coast Oregon",
      categories: [{ id: "earthquakes", title: "Earthquakes" }],
      sources: [],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [-125.0, 44.0],
            date: "2026-06-13T10:00:00Z",
            magnitudeValue: 5.2,
            magnitudeUnit: "Mw",
          },
        ],
      },
      closed: null,
    },
    // Evento CERRADO (closed != null) → se incluye, estado en raw_json
    {
      id: "EONET_1008",
      title: "Closed Wildfire",
      categories: [{ id: "wildfires", title: "Wildfires" }],
      sources: [{ id: "PDC", url: "https://example.com/wildfire/1008" }],
      geometry: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: [-118.0, 34.0],
            date: "2026-05-20T00:00:00Z",
            magnitudeValue: 500,
            magnitudeUnit: "acres",
          },
        ],
      },
      closed: "2026-06-01T00:00:00Z",
    },
  ],
};

// ─── Helper: monkey-patch fetch ───────────────────────────────────────────────

type FetchLike = typeof globalThis.fetch;

let originalFetch: FetchLike;

before(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetCache();
});

function mockFetchOk(body: unknown): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function mockFetchStatus(status: number): void {
  globalThis.fetch = async () =>
    new Response("error", { status });
}

function mockFetchThrow(msg: string): void {
  globalThis.fetch = async () => {
    throw new Error(msg);
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchEonet — mapeo de categorías", () => {
  it("mapea wildfires → wildfire", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1001");
    assert.ok(row, "debe existir una fila para EONET_1001");
    assert.equal(row.eventType, "wildfire");
    assert.equal(row.category, "natural");
    assert.equal(row.source, "eonet");
  });

  it("mapea volcanoes → volcano", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1002");
    assert.ok(row, "debe existir una fila para EONET_1002");
    assert.equal(row.eventType, "volcano");
  });

  it("mapea severeStorms → storm", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1003");
    assert.ok(row, "debe existir una fila para EONET_1003");
    assert.equal(row.eventType, "storm");
  });

  it("mapea floods → flood", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1004");
    assert.ok(row);
    assert.equal(row.eventType, "flood");
  });

  it("mapea landslides → landslide", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1005");
    assert.ok(row);
    assert.equal(row.eventType, "landslide");
  });

  it("mapea drought → drought", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1006");
    assert.ok(row);
    assert.equal(row.eventType, "drought");
  });

  it("mapea tempExtremes → tempExtreme", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1007");
    assert.ok(row);
    assert.equal(row.eventType, "tempExtreme");
  });
});

describe("fetchEonet — descarte de earthquakes", () => {
  it("descarta earthquakes EONET (USGS es la fuente sísmica)", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const earthquake = result.data.find((r) => r.sourceEventId === "EONET_9001");
    assert.equal(earthquake, undefined, "no debe haber fila para el evento sísmico EONET");
  });
});

describe("fetchEonet — severity", () => {
  it("severity ∈ [0,100] para todos los eventos", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    assert.ok(result.data.length > 0, "debe haber datos");
    for (const row of result.data) {
      assert.ok(
        row.severity !== null && row.severity >= 0 && row.severity <= 100,
        `severity fuera de rango para ${row.sourceEventId}: ${row.severity}`,
      );
    }
  });

  it("wildfire con magnitudeValue grande tiene severity mayor al wildfire pequeño", async () => {
    // EONET_1001 tiene 15000 acres (grande), EONET_1008 tiene 500 acres (pequeño)
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const big = result.data.find((r) => r.sourceEventId === "EONET_1001");
    const small = result.data.find((r) => r.sourceEventId === "EONET_1008");
    assert.ok(big && small, "deben existir ambas filas");
    assert.ok(
      big.severity! > small.severity!,
      `severity grande (${big.severity}) debería ser > pequeño (${small.severity})`,
    );
  });
});

describe("fetchEonet — eventos abiertos y cerrados", () => {
  it("incluye eventos cerrados (closed != null) con estado en raw_json", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const closed = result.data.find((r) => r.sourceEventId === "EONET_1008");
    assert.ok(closed, "el evento cerrado debe estar presente");
    assert.equal(closed.eventType, "wildfire");

    // raw_json debe contener la fecha de cierre
    const raw = JSON.parse(closed.rawJson!);
    assert.ok(raw.closed, "raw_json debe tener closed no null");
    assert.equal(raw.closed, "2026-06-01T00:00:00Z");
  });

  it("incluye eventos abiertos (closed === null) con closed null en raw_json", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const open = result.data.find((r) => r.sourceEventId === "EONET_1002");
    assert.ok(open, "el evento abierto debe estar presente");
    const raw = JSON.parse(open.rawJson!);
    assert.equal(raw.closed, null);
  });
});

describe("fetchEonet — coords y campos", () => {
  it("lat/lon extraídos correctamente de coordinates [lon, lat]", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1001");
    assert.ok(row);
    // coordinates: [-121.5, 36.2] → lon=-121.5, lat=36.2
    assert.equal(row.lon, -121.5);
    assert.equal(row.lat, 36.2);
  });

  it("url extraída desde sources[0].url", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1001");
    assert.ok(row);
    assert.equal(row.url, "https://example.com/wildfire/1001");
  });

  it("title extraído del feature.title", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1001");
    assert.ok(row);
    assert.equal(row.title, "Big Sur Fire");
  });

  it("occurredAt es epoch ms de geometry[0].date", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const row = result.data.find((r) => r.sourceEventId === "EONET_1001");
    assert.ok(row);
    const expected = Date.parse("2026-06-10T12:00:00Z");
    assert.equal(row.occurredAt, expected);
  });

  it("sourceEventId = id del feature (p.ej. EONET_1002)", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const ids = result.data.map((r) => r.sourceEventId);
    assert.ok(ids.includes("EONET_1002"));
  });
});

describe("fetchEonet — fallbacks sin red", () => {
  it("sin red (fetch lanza Error) → retorna vacío gracioso sin lanzar", async () => {
    mockFetchThrow("Network error: ECONNREFUSED");
    let result: Awaited<ReturnType<typeof fetchEonet>> | undefined;
    let threw = false;
    try {
      result = await fetchEonet();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "fetchEonet NO debe lanzar hacia arriba");
    assert.ok(result, "debe retornar un resultado");
    assert.deepEqual(result!.data, [], "data debe ser array vacío");
  });

  it("HTTP 503 → retorna vacío gracioso sin lanzar", async () => {
    mockFetchStatus(503);
    let result: Awaited<ReturnType<typeof fetchEonet>> | undefined;
    let threw = false;
    try {
      result = await fetchEonet();
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.deepEqual(result!.data, []);
  });

  it("HTTP 404 → retorna vacío gracioso sin lanzar", async () => {
    mockFetchStatus(404);
    let result: Awaited<ReturnType<typeof fetchEonet>> | undefined;
    let threw = false;
    try {
      result = await fetchEonet();
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.deepEqual(result!.data, []);
  });

  it("respuesta con shape inválido → retorna vacío gracioso sin lanzar", async () => {
    mockFetchOk({ not: "geojson" });
    let result: Awaited<ReturnType<typeof fetchEonet>> | undefined;
    let threw = false;
    try {
      result = await fetchEonet();
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.deepEqual(result!.data, []);
  });

  it("stale: sirve datos cacheados si fetch falla tras éxito previo", async () => {
    // Primera llamada OK — llena lastGood
    mockFetchOk(FIXTURE_GEOJSON);
    const first = await fetchEonet();
    assert.ok(first.data.length > 0, "primer fetch debe tener datos");

    // Ahora parchamos fetch para que falle — SIN llamar _resetCache (conservamos lastGood).
    // afterEach lo limpiará al terminar este test.
    globalThis.fetch = async () => {
      throw new Error("simulated network fail");
    };

    const second = await fetchEonet();
    // lastGood tiene datos recientes (dentro de 1h) → stale=true
    assert.equal(second.stale, true, "segunda llamada fallida debería ser stale");
    assert.ok(second.data.length > 0, "stale debe tener datos del caché");
  });
});

describe("fetchEonet — resultado general", () => {
  it("fetchedAt es un timestamp epoch ms razonable", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const before = Date.now();
    const result = await fetchEonet();
    const after = Date.now();
    assert.ok(result.fetchedAt >= before && result.fetchedAt <= after);
  });

  it("stale=false en fetch exitoso", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    assert.equal(result.stale, false);
  });

  it("data es array (nunca null/undefined)", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    assert.ok(Array.isArray(result.data));
  });

  it("los 7 tipos soportados están presentes en el fixture (sin earthquakes)", async () => {
    mockFetchOk(FIXTURE_GEOJSON);
    const result = await fetchEonet();
    const types = new Set(result.data.map((r) => r.eventType));
    const expected = ["wildfire", "volcano", "storm", "flood", "landslide", "drought", "tempExtreme"];
    for (const t of expected) {
      assert.ok(types.has(t), `falta event_type: ${t}`);
    }
    assert.ok(!types.has("earthquake"), "earthquake no debe estar en los datos");
  });
});
