// packages/connectors/geo/gdelt.test.ts
//
// Tests para el conector GDELT raw Events CSV (T-10c) — REESCRITURA.
// Sin red: usa stubs de globalThis.fetch y fixtures en memoria.
//
// Cubre:
//   1. Vacío gracioso sin red (sin lanzar)
//   2. HTTP no-OK en lastupdate.txt → vacío gracioso
//   3. 304 en lastupdate.txt → stale/vacío sin lanzar
//   4. parseLastupdateTxt — extrae URL export.CSV.zip
//   5. extractZipFirstEntry — deflate fixture correcto
//   6. extractZipFirstEntry — stored (método 0) fixture correcto
//   7. ZIP firma inválida → null sin lanzar
//   8. ZIP método desconocido → null sin lanzar
//   9. parseGdeltCsvRows — mapeo correcto a EventRow (61 cols tab-sep)
//      - lat/lon de ActionGeo (no centroide-país)
//      - severity ∈ [0,100]
//      - event_type ∈ {conflict, protest}
//      - fila con !=61 cols descartada + warn loggeado
//   10. fetchGdelt end-to-end ZIP deflate → EventRow correcto
//   11. fetchGdelt end-to-end ZIP stored → EventRow correcto
//   12. fetchGdelt ZIP inválido → vacío gracioso sin lanzar

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { deflateRawSync } from "node:zlib";

// ─── Stub de fetch ─────────────────────────────────────────────────────────────

type FetchStub = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

function makeFetchStub(handler: FetchStub): void {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Importar módulo bajo test ────────────────────────────────────────────────
// Importación estática — el módulo usa globalThis.fetch en el momento del invoke,
// así que los stubs instalados en before() se aplican correctamente.

import {
  fetchGdelt,
  parseLastupdateTxt,
  extractZipFirstEntry,
  parseGdeltCsvRows,
} from "./gdelt.js";

// ─── Fixture CSV (TAB-separated, 61 columnas, sin header) ─────────────────────
//
// Posiciones según GDELT 2.0 Event Codebook. Campos no relevantes = vacíos.
// COL indices: 0=GlobalEventID, 1=SQLDATE, 6=Actor1Name, 16=Actor2Name,
//   26=EventCode, 29=QuadClass, 30=Goldstein, 34=AvgTone,
//   52=ActionGeo_FullName, 53=ActionGeo_CountryCode, 56=ActionGeo_Lat,
//   57=ActionGeo_Long, 60=SOURCEURL

function makeRow(overrides: Partial<Record<number, string>> = {}): string {
  const cols: string[] = Array.from({ length: 61 }, () => "");
  // Defaults: evento de conflicto material en Kyiv, Ucrania
  cols[0]  = "123456789";
  cols[1]  = "20240614";
  cols[6]  = "RUSSIA";
  cols[16] = "UKRAINE";
  cols[26] = "190";         // CAMEO 190 = Use unconventional mass violence
  cols[29] = "4";           // QuadClass 4 = material-conflict
  cols[30] = "-8.0";        // Goldstein negativo → alta severity
  cols[34] = "-12.5";       // AvgTone negativo
  cols[52] = "Kyiv, Ukraine";
  cols[53] = "UP";          // FIPS 10-4 Ukraine
  cols[56] = "50.45";
  cols[57] = "30.52";
  cols[60] = "https://example.com/article/1";
  for (const [idx, val] of Object.entries(overrides)) {
    cols[Number(idx)] = val;
  }
  return cols.join("\t");
}

function makeRowProtest(): string {
  return makeRow({
    0:  "987654321",
    6:  "CITIZENS",
    16: "",
    26: "141",        // CAMEO 14x = protesta (Demonstrate)
    29: "3",          // QuadClass 3 (verbal-conflict; código 14x domina → protest)
    30: "-3.0",
    34: "-5.0",
    52: "Paris, France",
    53: "FR",
    56: "48.8566",
    57: "2.3522",
    60: "https://example.com/protest/1",
  });
}

// ─── Fixture ZIP en memoria ────────────────────────────────────────────────────
//
// Construye un ZIP PKZIP de 1 entrada con método 8 (deflate) usando deflateRawSync.
// Layout del local-file-header:
//   Offset  0:  4B  signature  PK\x03\x04
//   Offset  4:  2B  version    0x14 0x00
//   Offset  6:  2B  flags      0x00 0x00
//   Offset  8:  2B  method     0x08 0x00 (deflate)
//   Offset 10:  2B  mod_time   0x00 0x00
//   Offset 12:  2B  mod_date   0x00 0x00
//   Offset 14:  4B  crc32      0x00 (no verificado)
//   Offset 18:  4B  comp_size  uint32 LE
//   Offset 22:  4B  uncomp_sz  uint32 LE
//   Offset 26:  2B  fname_len  uint16 LE
//   Offset 28:  2B  extra_len  uint16 LE
//   Offset 30:  <fname_len> bytes  filename
//   Offset 30+n: <extra_len> bytes  (0)
//   Offset 30+n+m: <comp_size> bytes  compressed data

function buildZipDeflate(content: string): Buffer {
  const raw = Buffer.from(content, "utf-8");
  const compressed = deflateRawSync(raw);

  const filename = Buffer.from("export.CSV");
  const filenameLen = filename.length;
  const extraLen = 0;
  const compressedSize = compressed.length;

  const header = Buffer.alloc(30 + filenameLen);
  header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
  header.writeUInt16LE(0x0014, 4);    // version
  header.writeUInt16LE(0x0000, 6);    // flags
  header.writeUInt16LE(8, 8);         // method = deflate
  header.writeUInt16LE(0, 10);        // mod_time
  header.writeUInt16LE(0, 12);        // mod_date
  header.writeUInt32LE(0, 14);        // crc32
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(filenameLen, 26);
  header.writeUInt16LE(extraLen, 28);
  filename.copy(header, 30);

  return Buffer.concat([header, compressed]);
}

function buildZipStored(content: string): Buffer {
  const raw = Buffer.from(content, "utf-8");
  const filename = Buffer.from("export.CSV");
  const filenameLen = filename.length;

  const header = Buffer.alloc(30 + filenameLen);
  header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
  header.writeUInt16LE(0x0014, 4);
  header.writeUInt16LE(0x0000, 6);
  header.writeUInt16LE(0, 8);         // method = stored
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(raw.length, 18); // comp_size == uncomp_size (stored)
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(filenameLen, 26);
  header.writeUInt16LE(0, 28);
  filename.copy(header, 30);

  return Buffer.concat([header, raw]);
}

// ─── Stubs de fetch completos (lastupdate.txt → URL → ZIP) ───────────────────

const FAKE_ZIP_URL =
  "http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip";

function makeLastupdateTxt(): string {
  return [
    `1234567890 abcdef1234567890 ${FAKE_ZIP_URL}`,
    "9876543210 0987654321fedcba http://data.gdeltproject.org/gdeltv2/20240614120000.mentions.CSV.zip",
  ].join("\n");
}

function makeFullStub(
  csvContent: string,
  zipBuilder: (s: string) => Buffer = buildZipDeflate
): FetchStub {
  const zipBuffer = zipBuilder(csvContent);
  return (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("lastupdate.txt")) {
      return Promise.resolve(
        new Response(makeLastupdateTxt(), {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      );
    }
    if (urlStr.includes("export.CSV.zip")) {
      // Buffer → Response: usamos Uint8Array para compatibilidad
      return Promise.resolve(
        new Response(new Uint8Array(zipBuffer), {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        })
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("gdelt connector — T-10c", () => {

  // ── 1. Sin red — vacío gracioso ──────────────────────────────────────────
  describe("sin red — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() => Promise.reject(new Error("Network failure (test stub)")));
    });
    after(restoreFetch);

    it("devuelve data:[] y no lanza ante error de red", async () => {
      const result = await fetchGdelt();
      assert.ok(Array.isArray(result.data), "data debe ser array");
      assert.deepEqual(result.data, [], "data debe estar vacío");
      assert.equal(typeof result.fetchedAt, "number");
      assert.equal(typeof result.stale, "boolean");
    });
  });

  // ── 2. HTTP 500 en lastupdate.txt — vacío gracioso ───────────────────────
  describe("HTTP 500 en lastupdate.txt — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 }))
      );
    });
    after(restoreFetch);

    it("devuelve data:[] ante 500", async () => {
      const result = await fetchGdelt();
      assert.ok(Array.isArray(result.data));
      assert.equal(result.data.length, 0);
    });
  });

  // ── 3. 304 en lastupdate.txt — sin lanzar ───────────────────────────────
  describe("304 Not Modified en lastupdate.txt — sin lanzar", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(new Response("", { status: 304 }))
      );
    });
    after(restoreFetch);

    it("no lanza ante 304; devuelve array", async () => {
      let threw = false;
      let result: { data: unknown[]; stale: boolean; fetchedAt: number } | undefined;
      try {
        result = await fetchGdelt();
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "fetchGdelt no debe lanzar ante 304");
      assert.ok(Array.isArray(result?.data));
    });
  });

  // ── 4. parseLastupdateTxt ────────────────────────────────────────────────
  describe("parseLastupdateTxt — extrae URL export.CSV.zip", () => {
    it("extrae URL correcta de un lastupdate.txt típico", () => {
      const text = [
        "123456789 abc123 http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip",
        "789012345 def456 http://data.gdeltproject.org/gdeltv2/20240614120000.mentions.CSV.zip",
        "111222333 ghi789 http://data.gdeltproject.org/gdeltv2/20240614120000.gkg.csv.zip",
      ].join("\n");
      const url = parseLastupdateTxt(text);
      assert.equal(
        url,
        "http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip"
      );
    });

    it("devuelve null si no hay línea export.CSV.zip", () => {
      const url = parseLastupdateTxt("no relevant lines\nanother line");
      assert.equal(url, null);
    });

    it("funciona con espacios extra entre campos", () => {
      const text =
        "123  abc  http://data.gdeltproject.org/gdeltv2/20240614.export.CSV.zip";
      const url = parseLastupdateTxt(text);
      assert.equal(url, "http://data.gdeltproject.org/gdeltv2/20240614.export.CSV.zip");
    });
  });

  // ── 5. extractZipFirstEntry — deflate ────────────────────────────────────
  describe("extractZipFirstEntry — extrae contenido deflate", () => {
    it("extrae contenido correcto de ZIP deflate construido en memoria", () => {
      const content = "Hello GDELT ZIP test 123456789\n";
      const zipBuf = buildZipDeflate(content);
      const extracted = extractZipFirstEntry(zipBuf);
      assert.ok(extracted !== null, "no debe devolver null");
      assert.equal(extracted!.toString("utf-8"), content);
    });

    it("extrae CSV multi-línea sin pérdida", () => {
      const content = makeRow() + "\n" + makeRowProtest() + "\n";
      const zipBuf = buildZipDeflate(content);
      const extracted = extractZipFirstEntry(zipBuf);
      assert.ok(extracted !== null);
      assert.equal(extracted!.toString("utf-8"), content);
    });
  });

  // ── 6. extractZipFirstEntry — stored (método 0) ──────────────────────────
  describe("extractZipFirstEntry — stored (método 0)", () => {
    it("extrae contenido correcto de ZIP stored", () => {
      const content = "Stored content test line\n";
      const zipBuf = buildZipStored(content);
      const extracted = extractZipFirstEntry(zipBuf);
      assert.ok(extracted !== null, "stored no debe devolver null");
      assert.equal(extracted!.toString("utf-8"), content);
    });
  });

  // ── 7. ZIP firma inválida → null sin lanzar ──────────────────────────────
  describe("extractZipFirstEntry — firma inválida → null", () => {
    it("devuelve null ante buffer con firma inválida", () => {
      const invalidZip = Buffer.alloc(32, 0x00); // todo ceros, firma inválida
      let threw = false;
      let result: Buffer | null | undefined;
      try {
        result = extractZipFirstEntry(invalidZip);
      } catch {
        threw = true;
      }
      assert.equal(threw, false);
      assert.equal(result, null);
    });

    it("devuelve null ante buffer demasiado pequeño (<30 bytes)", () => {
      const tiny = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const result = extractZipFirstEntry(tiny);
      assert.equal(result, null);
    });
  });

  // ── 8. ZIP método desconocido → null sin lanzar ──────────────────────────
  describe("extractZipFirstEntry — método desconocido → null", () => {
    it("devuelve null ante método de compresión 12 (BZIP2, no soportado)", () => {
      const buf = Buffer.alloc(40, 0x00);
      buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
      buf.writeUInt16LE(12, 8); // método 12 = BZIP2 (desconocido para el extractor)
      // comp_size=0, fname_len=0, extra_len=0 → dataOffset=30, no hay datos
      let threw = false;
      let result: Buffer | null | undefined;
      try {
        result = extractZipFirstEntry(buf);
      } catch {
        threw = true;
      }
      assert.equal(threw, false);
      assert.equal(result, null);
    });
  });

  // ── 9. parseGdeltCsvRows — mapeo correcto a EventRow ─────────────────────
  describe("parseGdeltCsvRows — mapeo correcto a EventRow", () => {
    const capturedAt = 1718380800000;

    it("fila conflict (QuadClass=4, EventCode=190) → eventType=conflict", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt);
      assert.equal(events.length, 1);
      assert.equal(events[0]!.eventType, "conflict");
      assert.equal(events[0]!.category, "conflict");
      assert.equal(events[0]!.source, "gdelt");
    });

    it("fila protest (EventCode=141, CAMEO 14x) → eventType=protest", () => {
      const events = parseGdeltCsvRows(makeRowProtest(), capturedAt);
      assert.equal(events.length, 1);
      assert.equal(events[0]!.eventType, "protest");
    });

    it("EventCode=140 (CAMEO 14x) → eventType=protest independientemente de QuadClass", () => {
      const row = makeRow({ 26: "140", 29: "4" });
      const events = parseGdeltCsvRows(row, capturedAt);
      assert.equal(events[0]!.eventType, "protest");
    });

    it("QuadClass=3 (verbal-conflict), EventCode no 14x → eventType=conflict", () => {
      const row = makeRow({ 26: "180", 29: "3" });
      const events = parseGdeltCsvRows(row, capturedAt);
      assert.equal(events[0]!.eventType, "conflict");
    });

    it("QuadClass=1 (verbal-coop) → eventType=conflict de baja severity", () => {
      const row = makeRow({ 26: "010", 29: "1", 30: "5.0", 34: "2.0" });
      const events = parseGdeltCsvRows(row, capturedAt);
      assert.equal(events[0]!.eventType, "conflict");
      // QuadClass=1 → base 10; goldstein positivo→0; tono positivo→0; total=10
      assert.ok(
        (events[0]!.severity ?? 999) <= 30,
        `severity esperada baja (<=30), got ${events[0]!.severity}`
      );
    });

    it("severity ∈ [0,100]", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt);
      const s = events[0]!.severity;
      assert.ok(s !== null && s >= 0 && s <= 100, `severity fuera de rango: ${s}`);
    });

    it("lat/lon son los de ActionGeo (no centroide de país)", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt); // lat=50.45, lon=30.52
      const e = events[0]!;
      assert.ok(Math.abs((e.lat ?? 0) - 50.45) < 0.001, `lat esperado ~50.45, got ${e.lat}`);
      assert.ok(Math.abs((e.lon ?? 0) - 30.52) < 0.001, `lon esperado ~30.52, got ${e.lon}`);
    });

    it("country = ActionGeo_CountryCode (no centroide)", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt); // "UP"
      assert.equal(events[0]!.country, "UP");
    });

    it("sourceEventId = GlobalEventID", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt); // "123456789"
      assert.equal(events[0]!.sourceEventId, "123456789");
    });

    it("occurredAt desde SQLDATE YYYYMMDD → epoch ms medianoche UTC", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt); // 20240614
      const expected = Date.UTC(2024, 5, 14); // junio = mes 5 (0-based)
      assert.equal(events[0]!.occurredAt, expected);
    });

    it("url = SOURCEURL", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt);
      assert.equal(events[0]!.url, "https://example.com/article/1");
    });

    it("rawJson incluye eventCode, quadClass, goldstein, avgTone, actor1, actor2, actionGeoFullName", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt);
      const raw = JSON.parse(events[0]!.rawJson ?? "{}");
      assert.ok("eventCode" in raw, "rawJson debe tener eventCode");
      assert.ok("quadClass" in raw, "rawJson debe tener quadClass");
      assert.ok("goldstein" in raw, "rawJson debe tener goldstein");
      assert.ok("avgTone" in raw, "rawJson debe tener avgTone");
      assert.ok("actor1" in raw, "rawJson debe tener actor1");
      assert.ok("actor2" in raw, "rawJson debe tener actor2");
      assert.ok("actionGeoFullName" in raw, "rawJson debe tener actionGeoFullName");
    });

    it("capturedAt = argumento capturedAt", () => {
      const events = parseGdeltCsvRows(makeRow(), capturedAt);
      assert.equal(events[0]!.capturedAt, capturedAt);
    });

    it("fila sin lat/lon de ActionGeo es descartada", () => {
      const row = makeRow({ 56: "", 57: "" });
      const events = parseGdeltCsvRows(row, capturedAt);
      assert.equal(events.length, 0, "fila sin lat/lon debe ser descartada");
    });

    it("fila con !=61 columnas descartada + warn loggeado (no throw)", () => {
      const badRow = makeRow().split("\t").slice(0, 50).join("\t"); // solo 50 cols

      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };

      let threw = false;
      let events: ReturnType<typeof parseGdeltCsvRows> = [];
      try {
        events = parseGdeltCsvRows(badRow, capturedAt);
      } catch {
        threw = true;
      } finally {
        console.warn = originalWarn;
      }

      assert.equal(threw, false, "parseGdeltCsvRows no debe lanzar");
      assert.equal(events.length, 0, "fila con 50 cols debe ser descartada");
      assert.ok(
        warnings.some((w) => w.includes("descartada")),
        `debe loggear warn de descarte; got warnings: [${warnings.join(", ")}]`
      );
    });

    it("múltiples filas: solo las válidas pasan; discards y no-lat filtradas", () => {
      const goodRow1 = makeRow({ 0: "111" });
      const badRow   = makeRow().split("\t").slice(0, 30).join("\t"); // 30 cols
      const goodRow2 = makeRow({ 0: "222", 26: "141", 29: "3", 56: "48.8566", 57: "2.3522" });
      const noLatRow = makeRow({ 0: "333", 56: "", 57: "" });
      const csv = [goodRow1, badRow, goodRow2, noLatRow].join("\n");

      // Silenciamos warn para no contaminar la salida del test runner
      const originalWarn = console.warn;
      console.warn = () => {};
      const events = parseGdeltCsvRows(csv, capturedAt);
      console.warn = originalWarn;

      assert.equal(events.length, 2, `esperados 2 eventos válidos, got ${events.length}`);
      const ids = events.map((e) => e.sourceEventId);
      assert.ok(ids.includes("111"), "goodRow1 debe estar");
      assert.ok(ids.includes("222"), "goodRow2 debe estar");
    });
  });

  // ── 10. fetchGdelt end-to-end — ZIP deflate → EventRow ───────────────────
  describe("fetchGdelt end-to-end — ZIP deflate fixture → EventRow correcto", () => {
    before(() => {
      const csvContent = [makeRow({ 0: "AAA001" }), makeRowProtest()].join("\n");
      makeFetchStub(makeFullStub(csvContent, buildZipDeflate));
    });
    after(restoreFetch);

    it("devuelve EventRows con coords ActionGeo (no centroide de país)", async () => {
      const result = await fetchGdelt();
      assert.ok(result.data.length >= 1, "debe haber al menos 1 EventRow");
      const first = result.data[0]!;
      assert.equal(first.source, "gdelt");
      // lat/lon de ActionGeo, no centroide
      assert.ok(
        first.lat !== null && Math.abs(first.lat - 50.45) < 0.01,
        `lat esperado ~50.45, got ${first.lat}`
      );
      assert.ok(
        first.lon !== null && Math.abs(first.lon - 30.52) < 0.01,
        `lon esperado ~30.52, got ${first.lon}`
      );
    });

    it("severity ∈ [0,100] para todos los EventRow", async () => {
      const result = await fetchGdelt();
      for (const row of result.data) {
        const s = row.severity;
        assert.ok(s !== null && s >= 0 && s <= 100, `severity fuera de rango: ${s}`);
      }
    });

    it("event_type ∈ {conflict, protest}", async () => {
      const result = await fetchGdelt();
      const validTypes = new Set(["conflict", "protest"]);
      for (const row of result.data) {
        assert.ok(validTypes.has(row.eventType), `event_type inválido: ${row.eventType}`);
      }
    });

    it("stale=false en respuesta exitosa", async () => {
      const result = await fetchGdelt();
      assert.equal(result.stale, false);
      assert.ok(result.fetchedAt > 0);
    });

    it("protest row identificado correctamente", async () => {
      const result = await fetchGdelt();
      const protest = result.data.find((r) => r.sourceEventId === "987654321");
      assert.ok(protest, "protest row debe estar presente");
      assert.equal(protest!.eventType, "protest");
    });
  });

  // ── 11. fetchGdelt end-to-end — ZIP stored → EventRow ────────────────────
  describe("fetchGdelt end-to-end — ZIP stored (método 0) → EventRow", () => {
    before(() => {
      const csvContent = makeRow({ 0: "STORED001", 29: "4" });
      makeFetchStub(makeFullStub(csvContent, buildZipStored));
    });
    after(restoreFetch);

    it("ZIP stored produce EventRow correcto", async () => {
      const result = await fetchGdelt();
      assert.ok(result.data.length >= 1, "debe haber al menos 1 EventRow desde ZIP stored");
      assert.equal(result.data[0]!.source, "gdelt");
      assert.equal(result.data[0]!.sourceEventId, "STORED001");
    });
  });

  // ── 12. ZIP inválido en respuesta → vacío gracioso ────────────────────────
  describe("fetchGdelt — ZIP inválido en respuesta → vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("lastupdate.txt")) {
          return Promise.resolve(
            new Response(makeLastupdateTxt(), { status: 200 })
          );
        }
        if (urlStr.includes("export.CSV.zip")) {
          // Buffer inválido (no es PKZIP)
          return Promise.resolve(
            new Response(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00]), {
              status: 200,
              headers: { "Content-Type": "application/zip" },
            })
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      });
    });
    after(restoreFetch);

    it("ZIP inválido produce data vacío o stale sin lanzar", async () => {
      let threw = false;
      let result: { data: unknown[]; stale: boolean; fetchedAt: number } | undefined;
      try {
        result = await fetchGdelt();
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "fetchGdelt no debe lanzar ante ZIP inválido");
      assert.ok(Array.isArray(result?.data), "data debe ser array");
    });
  });

});
