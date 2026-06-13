// packages/connectors/geo/gdelt.test.ts
// node:test — no network access required

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal GdeltEvent stub matching @www/store shape so tests run standalone
// ---------------------------------------------------------------------------
interface GdeltEvent {
  source: string;
  event_id: string;
  category: string | null;
  severity: number;
  lat: number;
  lon: number;
  captured_at: number;
}

// ---------------------------------------------------------------------------
// fetch mock infrastructure
// ---------------------------------------------------------------------------

type MockFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

let _mockFetch: MockFetchFn | null = null;

const originalFetch = globalThis.fetch;

function installMock(fn: MockFetchFn): void {
  // @ts-ignore — replacing global for test isolation
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
// Helpers to import the connector fresh per-suite (reset module state)
// We use dynamic import with a cache-bust to get fresh single-flight state.
// ---------------------------------------------------------------------------

// Because node:test doesn't have jest.resetModules, we rely on the fact that
// each top-level describe runs sequentially and we reset lastGood/inFlight
// via module-level variables. Instead of module re-import, we call fetchGdelt
// directly and manage state via the mock.

// Import once; single-flight state is reset between tests by controlling
// the mock so the promise resolves before the next test runs.
import { fetchGdelt } from "./gdelt.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchGdelt — no network (mock fetch)", () => {
  before(() => {
    // Install a mock that rejects (simulates network failure)
    installMock(() => Promise.reject(new Error("network unavailable")));
  });

  after(() => {
    restoreFetch();
  });

  it("returns empty gracious result when fetch throws (no upstream)", async () => {
    const result = await fetchGdelt();
    assert.equal(Array.isArray(result.data), true, "data must be an array");
    assert.equal(result.data.length, 0, "data must be empty on failure");
    assert.equal(typeof result.fetchedAt, "number", "fetchedAt must be a number");
    assert.equal(typeof result.stale, "boolean", "stale must be boolean");
  });

  it("never throws — result is always a ConnectorResult", async () => {
    let threw = false;
    try {
      await fetchGdelt();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "fetchGdelt must never throw");
  });
});

describe("fetchGdelt — HTTP error response", () => {
  before(() => {
    installMock(() => Promise.resolve(new Response(null, { status: 503 })));
  });

  after(() => {
    restoreFetch();
  });

  it("returns empty gracious result on HTTP 503", async () => {
    const result = await fetchGdelt();
    assert.equal(result.data.length, 0);
    assert.equal(result.stale, false);
  });
});

describe("fetchGdelt — valid GeoJSON response", () => {
  const mockGeoJson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [-3.7038, 40.4168], // [lon, lat] — Madrid
        },
        properties: {
          name: "Madrid Economy",
          count: 42,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [2.3522, 48.8566], // [lon, lat] — Paris
        },
        properties: {
          name: "Paris Market",
          count: 17,
        },
      },
    ],
  };

  before(() => {
    installMock(() => Promise.resolve(makeJsonResponse(mockGeoJson)));
  });

  after(() => {
    restoreFetch();
  });

  it("maps GeoJSON features to GdeltEvent with correct lat/lon", async () => {
    const result = await fetchGdelt();
    assert.equal(result.data.length, 2, "should produce 2 events");
    assert.equal(result.stale, false);

    const madrid = result.data[0] as GdeltEvent;
    // coordinates are [lon, lat] — lat must be 40.4168, lon must be -3.7038
    assert.equal(madrid.lat, 40.4168, "lat must come from coordinates[1]");
    assert.equal(madrid.lon, -3.7038, "lon must come from coordinates[0]");

    const paris = result.data[1] as GdeltEvent;
    assert.equal(paris.lat, 48.8566);
    assert.equal(paris.lon, 2.3522);
  });

  it("sets source='gdelt' on every event", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal(ev.source, "gdelt");
    }
  });

  it("derives severity from count property", async () => {
    const result = await fetchGdelt();
    const madrid = result.data[0] as GdeltEvent;
    assert.equal(madrid.severity, 42);
    const paris = result.data[1] as GdeltEvent;
    assert.equal(paris.severity, 17);
  });

  it("generates a stable event_id string", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal(typeof ev.event_id, "string");
      assert.match(ev.event_id, /^gdelt_/);
    }
  });

  it("sets category to 'economic'", async () => {
    const result = await fetchGdelt();
    for (const ev of result.data as GdeltEvent[]) {
      assert.equal((ev as GdeltEvent).category, "economic");
    }
  });

  it("sets captured_at as a recent timestamp", async () => {
    const before = Date.now();
    const result = await fetchGdelt();
    const after = Date.now();
    for (const ev of result.data as GdeltEvent[]) {
      assert.ok(
        (ev as GdeltEvent).captured_at >= before &&
          (ev as GdeltEvent).captured_at <= after,
        "captured_at must be a recent timestamp"
      );
    }
  });
});

describe("fetchGdelt — malformed JSON response", () => {
  before(() => {
    // Missing 'type: FeatureCollection' — schema mismatch
    installMock(() =>
      Promise.resolve(
        makeJsonResponse({ wrong: "shape", items: [] })
      )
    );
  });

  after(() => {
    restoreFetch();
  });

  it("returns gracious result on schema mismatch (empty or stale — never throws)", async () => {
    // The connector may serve stale data if a prior successful fetch populated lastGood
    // (serve-stale pattern is intentional per osiris connector-pattern).
    // What matters: never throws, always returns ConnectorResult shape.
    let threw = false;
    let result: Awaited<ReturnType<typeof fetchGdelt>> | undefined;
    try {
      result = await fetchGdelt();
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "fetchGdelt must never throw");
    assert.ok(result !== undefined, "result must be defined");
    assert.ok(Array.isArray(result!.data), "data must be an array");
    assert.ok(typeof result!.stale === "boolean", "stale must be boolean");
    assert.ok(typeof result!.fetchedAt === "number", "fetchedAt must be number");
  });
});
