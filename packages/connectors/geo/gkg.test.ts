// packages/connectors/geo/gkg.test.ts
//
// Tests para el conector GDELT GKG v2 (T-17) — backbone del Radar Geoeconómico.
// Sin red: usa stubs de globalThis.fetch y fixtures en memoria (igual que gdelt.test.ts).
//
// Cubre (acceptance T-17):
//   1. Sin red / HTTP no-OK / 304 → fetchGkg() degrada gracioso (vacío) sin lanzar.
//   2. parseLastupdateGkg — extrae la línea que termina en '.gkg.csv.zip'; null si no hay.
//   3. parseGkgCsvRows — fixture 27-col → SignalRow con tone, themes, geo best-effort,
//      título de PAGE_TITLE, sections vía classify() (theme / keyword / entity).
//   4. Fila con !=27 columnas se descarta + loggea (no rompe el batch).
//   5. Artículo con 0 secciones se descarta (D-203).
//   6. fetchGkg end-to-end (ZIP deflate desde fixture .zip) → SignalRow correcto
//      (cubre la extracción ZIP reusando extractZipFirstEntry de ./zip.ts).

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  fetchGkg,
  parseLastupdateGkg,
  parseGkgCsvRows,
} from "./gkg.js";

// ─── Stub de fetch ─────────────────────────────────────────────────────────────

type FetchStub = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

function makeFetchStub(handler: FetchStub): void {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Fixture CSV GKG (TAB-separated, 27 columnas, sin header) ─────────────────
//
// Índices usados por gkg.ts:
//   0=GKGRECORDID, 1=DATE(YYYYMMDDHHMMSS), 4=SOURCEURL, 7=V1Themes(;),
//   9=V2Locations('tipo#nombre#cc#adm1#lat#lon#featureid' sep ';'),
//   11=V2Persons(;), 12=V2Organizations(;), 15=V2Tone(coma; AvgTone 1º),
//   26=V2ExtrasXML(<PAGE_TITLE>…</PAGE_TITLE>)

function makeGkgRow(overrides: Partial<Record<number, string>> = {}): string {
  const cols: string[] = Array.from({ length: 27 }, () => "");
  // Defaults: artículo de inestabilidad política (theme fuerte) en Kyiv, Ucrania.
  cols[0]  = "20240614120000-1";
  cols[1]  = "20240614120000";
  cols[4]  = "https://example.com/news/1";
  cols[7]  = "WB_2462_POLITICAL_VIOLENCE_AND_WAR;EPU_POLICY_POLICY";
  // 1ª entrada tipo 1 (país, se ignora en la 1ª pasada); 2ª tipo 4 (coords ciudad reales).
  cols[9]  =
    "1#Ukraine#UP#UP#49.0#32.0#-1234;4#Kyiv, Ukraine#UP#UP02#50.45#30.52#703448";
  cols[11] = "Vladimir Putin;Volodymyr Zelenskyy";
  cols[12] = "United Nations;NATO";
  cols[15] = "-5.2,1.5,6.7,8.2,20.5,2.1,250";
  cols[26] = "<PAGE_TITLE>Conflict escalates in eastern region</PAGE_TITLE>";
  for (const [idx, val] of Object.entries(overrides)) {
    cols[Number(idx)] = val;
  }
  return cols.join("\t");
}

// ─── Fixture ZIP en memoria (PKZIP método 8 = deflate) ───────────────────────
// Mismo layout local-file-header que gdelt.test.ts; filename '.gkg.csv'.

function buildZipDeflate(content: string): Buffer {
  const raw = Buffer.from(content, "utf-8");
  const compressed = deflateRawSync(raw);

  const filename = Buffer.from("20240614120000.gkg.csv");
  const filenameLen = filename.length;
  const compressedSize = compressed.length;

  const header = Buffer.alloc(30 + filenameLen);
  header[0] = 0x50; header[1] = 0x4b; header[2] = 0x03; header[3] = 0x04;
  header.writeUInt16LE(0x0014, 4);    // version
  header.writeUInt16LE(0x0000, 6);    // flags
  header.writeUInt16LE(8, 8);         // method = deflate
  header.writeUInt16LE(0, 10);        // mod_time
  header.writeUInt16LE(0, 12);        // mod_date
  header.writeUInt32LE(0, 14);        // crc32 (no verificado)
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(filenameLen, 26);
  header.writeUInt16LE(0, 28);        // extra_len
  filename.copy(header, 30);

  return Buffer.concat([header, compressed]);
}

// ─── Stub completo: lastupdate.txt → URL .gkg.csv.zip → ZIP ──────────────────

const FAKE_GKG_ZIP_URL =
  "http://data.gdeltproject.org/gdeltv2/20240614120000.gkg.csv.zip";

function makeLastupdateTxt(): string {
  return [
    "111 aaa http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip",
    "222 bbb http://data.gdeltproject.org/gdeltv2/20240614120000.mentions.CSV.zip",
    `333 ccc ${FAKE_GKG_ZIP_URL}`,
  ].join("\n");
}

function makeFullStub(csvContent: string): FetchStub {
  const zipBuffer = buildZipDeflate(csvContent);
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
    if (urlStr.includes(".gkg.csv.zip")) {
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

describe("gkg connector — T-17", () => {

  // ── 1. Sin red → vacío gracioso sin lanzar ───────────────────────────────
  // (Va PRIMERO: aún no se ha poblado lastGood, así serveStaleOrEmpty → vacío.)
  describe("sin red — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() => Promise.reject(new Error("Network failure (test stub)")));
    });
    after(restoreFetch);

    it("devuelve data:[] y no lanza ante error de red", async () => {
      const result = await fetchGkg();
      assert.ok(Array.isArray(result.data), "data debe ser array");
      assert.deepEqual(result.data, [], "data debe estar vacío");
      assert.equal(typeof result.fetchedAt, "number");
      assert.equal(typeof result.stale, "boolean");
    });
  });

  // ── 2. HTTP 500 en lastupdate.txt → vacío gracioso ───────────────────────
  describe("HTTP 500 en lastupdate.txt — vacío gracioso sin lanzar", () => {
    before(() => {
      makeFetchStub(() =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 }))
      );
    });
    after(restoreFetch);

    it("devuelve data:[] ante 500", async () => {
      const result = await fetchGkg();
      assert.ok(Array.isArray(result.data));
      assert.equal(result.data.length, 0);
    });
  });

  // ── 3. 304 Not Modified → sin lanzar ─────────────────────────────────────
  describe("304 Not Modified en lastupdate.txt — sin lanzar", () => {
    before(() => {
      makeFetchStub(() => Promise.resolve(new Response("", { status: 304 })));
    });
    after(restoreFetch);

    it("no lanza ante 304; devuelve array", async () => {
      let threw = false;
      let result: { data: unknown[]; stale: boolean; fetchedAt: number } | undefined;
      try {
        result = await fetchGkg();
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "fetchGkg no debe lanzar ante 304");
      assert.ok(Array.isArray(result?.data));
    });
  });

  // ── 4. parseLastupdateGkg ─────────────────────────────────────────────────
  describe("parseLastupdateGkg — extrae URL .gkg.csv.zip", () => {
    it("extrae la línea que termina en .gkg.csv.zip (no export/mentions)", () => {
      const url = parseLastupdateGkg(makeLastupdateTxt());
      assert.equal(url, FAKE_GKG_ZIP_URL);
    });

    it("devuelve null si no hay línea .gkg.csv.zip", () => {
      const text =
        "111 aaa http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip";
      assert.equal(parseLastupdateGkg(text), null);
    });

    it("tolera espacios extra entre campos", () => {
      const text = `333   ccc   ${FAKE_GKG_ZIP_URL}`;
      assert.equal(parseLastupdateGkg(text), FAKE_GKG_ZIP_URL);
    });
  });

  // ── 5. parseGkgCsvRows — mapeo a SignalRow (theme) ───────────────────────
  describe("parseGkgCsvRows — fixture 27-col → SignalRow", () => {
    const capturedAt = 1_718_000_000_000;

    it("mapea una fila de inestabilidad política (theme) completa", () => {
      const rows = parseGkgCsvRows(makeGkgRow(), capturedAt);
      assert.equal(rows.length, 1, "debe producir 1 SignalRow");
      const r = rows[0]!;

      assert.equal(r.source, "gkg");
      assert.equal(r.signalId, "20240614120000-1");
      assert.equal(r.url, "https://example.com/news/1");
      assert.equal(r.title, "Conflict escalates in eastern region");
      assert.equal(r.capturedAt, capturedAt);

      // occurredAt = epoch ms de 2024-06-14T12:00:00Z
      assert.equal(r.occurredAt, Date.UTC(2024, 5, 14, 12, 0, 0));

      // tone = AvgTone (1er valor de V2Tone)
      assert.equal(r.tone, -5.2);

      // themes/persons/organizations = strings ;-joined crudos (auditoría)
      assert.equal(r.themes, "WB_2462_POLITICAL_VIOLENCE_AND_WAR;EPU_POLICY_POLICY");
      assert.equal(r.persons, "Vladimir Putin;Volodymyr Zelenskyy");
      assert.equal(r.organizations, "United Nations;NATO");

      // geo best-effort: prefiere tipo 3/4 (Kyiv) sobre el tipo 1 (país)
      assert.equal(r.lat, 50.45);
      assert.equal(r.lon, 30.52);
      assert.equal(r.country, "UP");

      // sections vía classify() → political_instability matchedBy theme
      const pol = r.sections.find((s) => s.section === "political_instability");
      assert.ok(pol, "debe asignar political_instability");
      assert.equal(pol!.matchedBy, "theme");

      // raw_json incluye V2Tone completo + matchedBy (auditoría D-203)
      const raw = JSON.parse(r.rawJson!);
      assert.equal(raw.v2Tone, "-5.2,1.5,6.7,8.2,20.5,2.1,250");
      assert.ok(Array.isArray(raw.matchedBy));
      assert.ok(raw.matchedBy.some((m: { section: string }) => m.section === "political_instability"));
    });

    it("clasifica por keyword: 'rare earth' → critical_minerals", () => {
      const row = makeGkgRow({
        0: "20240614120000-2",
        7: "",  // sin themes: fuerza match por keyword del título
        9: "",  // sin geo
        11: "",
        12: "",
        26: "<PAGE_TITLE>China announces rare earth export curbs</PAGE_TITLE>",
      });
      const rows = parseGkgCsvRows(row, capturedAt);
      assert.equal(rows.length, 1);
      const cm = rows[0]!.sections.find((s) => s.section === "critical_minerals");
      assert.ok(cm, "debe asignar critical_minerals por keyword");
      assert.equal(cm!.matchedBy, "keyword");
      assert.equal(rows[0]!.lat, null, "sin geo → lat null");
    });

    it("clasifica por entity: organización 'TSMC' → semis_ai_tech", () => {
      const row = makeGkgRow({
        0: "20240614120000-3",
        7: "",
        9: "",
        11: "",
        12: "TSMC",
        26: "<PAGE_TITLE>Quarterly earnings report</PAGE_TITLE>",
      });
      const rows = parseGkgCsvRows(row, capturedAt);
      assert.equal(rows.length, 1);
      const semis = rows[0]!.sections.find((s) => s.section === "semis_ai_tech");
      assert.ok(semis, "debe asignar semis_ai_tech por entity");
      assert.equal(semis!.matchedBy, "entity");
    });

    it("descarta una fila con !=27 columnas sin romper el batch", () => {
      const good = makeGkgRow({ 0: "ok-1" });
      const bad = Array.from({ length: 20 }, () => "x").join("\t"); // 20 cols
      const csv = [good, bad].join("\n");
      const rows = parseGkgCsvRows(csv, capturedAt);
      // solo la buena sobrevive; la mala se descarta + loggea
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.signalId, "ok-1");
    });

    it("descarta artículos con 0 secciones (D-203)", () => {
      const row = makeGkgRow({
        0: "no-section-1",
        7: "",  // sin themes que matcheen
        9: "",
        11: "",
        12: "",
        26: "<PAGE_TITLE>Local weekend sports recap</PAGE_TITLE>",
      });
      const rows = parseGkgCsvRows(row, capturedAt);
      assert.equal(rows.length, 0, "0 secciones → descartado");
    });

    it("devuelve [] ante CSV vacío", () => {
      assert.deepEqual(parseGkgCsvRows("", capturedAt), []);
    });
  });

  // ── 6. fetchGkg end-to-end (ZIP deflate) → SignalRow ─────────────────────
  // (Va AL FINAL: pobla lastGood; no debe contaminar los tests de vacío.)
  describe("fetchGkg end-to-end — ZIP deflate desde fixture → SignalRow", () => {
    before(() => {
      makeFetchStub(makeFullStub(makeGkgRow()));
    });
    after(restoreFetch);

    it("descomprime el .gkg.csv.zip y parsea a SignalRow", async () => {
      const result = await fetchGkg();
      assert.equal(result.stale, false);
      assert.equal(result.data.length, 1, "1 artículo clasificado");
      const r = result.data[0]!;
      assert.equal(r.source, "gkg");
      assert.equal(r.signalId, "20240614120000-1");
      assert.equal(r.title, "Conflict escalates in eastern region");
      assert.ok(r.sections.some((s) => s.section === "political_instability"));
    });
  });
});
