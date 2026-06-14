---
name: gdelt-connector-t10c
description: T-10c DONE: gdelt.ts REFACTOR DOC artlist→raw Events CSV, 35/35 verde, keyless, ZIP zero-dep, fetchGdelt() → ConnectorResult<EventRow>.
metadata:
  type: project
---

T-10c completada. gdelt.ts reescrito de GDELT DOC artlist (financiero, centroide-país) a GDELT 2.0 raw Events CSV (conflicto/político, coords del suceso).

**Fuente:** `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` → URL del `export.CSV.zip`.
**ToS verificado:** GDELT open platform, uso libre con citación "Source: The GDELT Project (gdeltproject.org)". Zero-key.

**C-4 ZIP zero-dep implementado:**
- `extractZipFirstEntry(buf: Buffer): Buffer | null` — parse manual del local-file-header PKZIP.
- Soporta método 8 (deflate, via `zlib.inflateRawSync`) y método 0 (stored).
- Método desconocido → devuelve null + log explícito "BLOCKED: dep fflate MIT requiere ADR del PM".
- Firma inválida o buffer pequeño → null sin lanzar.

**CSV parse:**
- TAB-separated, 61 columnas, SIN header, por índice fijo (constantes nombradas).
- R-3: valida exactamente 61 cols; descarta+loggea con console.warn las que no cuadren.
- Filtra filas sin ActionGeo_Lat/Long.
- D-102: EventCode CAMEO 14x → 'protest'; resto → 'conflict' (QuadClass 1/2 baja severity, preservados para CII posterior).

**Mapeo a EventRow:** coords del SUCESO (ActionGeo_Lat/Long), NO centroide-país. country=ActionGeo_CountryCode. severityGdelt({quadClass,goldstein,avgTone}).

**Patrón osiris preservado:** single-flight + serve-stale + ETag/If-None-Match en lastupdate.txt + AbortSignal.timeout(8000) + User-Agent + fallback multinivel (network/HTTP/ZIP/CSV) + retorno vacío gracioso (NUNCA throw).

**Retro-compat:** cambia tipo de ConnectorResult<GdeltEvent> → ConnectorResult<EventRow>. server.ts/briefing.ts no tocados (compatibilidad dada por getRecentGdeltEvents en T-08).

**Tests:** 35/35 verde. gdelt.test.ts reescrito completamente (el antiguo testaba la DOC artlist ya eliminada).

**Why:** ZIP es el formato real de GDELT 2.0 (no gzip); coords del suceso son el diferencial vs DOC artlist que daba centroide-país.
**How to apply:** Si hay que añadir un conector que descargue ZIPs PKZIP, reusar extractZipFirstEntry. Si GDELT cambia el método de compresión (>8), STOP y reportar al PM (fflate MIT requiere ADR).
