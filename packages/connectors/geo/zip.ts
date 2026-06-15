// packages/connectors/geo/zip.ts
//
// Utilidad ZIP zero-dep compartida por los conectores GDELT Events y GKG.
//
// Extrae la primera entrada de un archivo PKZIP (método deflate=8 o stored=0)
// usando solo node:zlib (inflateRawSync) — sin dependencias nativas.
//
// Origen: extraído de gdelt.ts (T-17 refactor) para reutilización en gkg.ts.
//
// C-4 ZIP zero-dep: parse manual del local-file-header (offsets PKZIP codebook).
// Si el método de compresión no es deflate (8) ni stored (0) → devuelve null
// (nunca lanza; el PM evalúa dep fflate MIT si se confirma el problema).
//
// PKZIP local-file-header layout (offsets en el buffer):
//   Offset 0:  4 bytes — firma "PK\x03\x04"
//   Offset 8:  2 bytes uint16 LE — método de compresión (8 = deflate, 0 = stored)
//   Offset 18: 4 bytes uint32 LE — compressed size
//   Offset 26: 2 bytes uint16 LE — filename length
//   Offset 28: 2 bytes uint16 LE — extra field length
//   Offset 30: <filename_len> bytes — filename
//   Offset 30 + filename_len: <extra_len> bytes — extra field
//   Offset 30 + filename_len + extra_len: <compressed_size> bytes — datos comprimidos

import { inflateRawSync } from "node:zlib";

/**
 * Extrae la primera entrada de un buffer PKZIP.
 * Soporta método deflate (8) y stored (0).
 * Devuelve null en cualquier error — NUNCA lanza.
 */
export function extractZipFirstEntry(buf: Buffer): Buffer | null {
  // Necesitamos al menos 30 bytes para el header fijo
  if (buf.length < 30) {
    console.error("[zip] ZIP demasiado pequeño para tener local-file-header");
    return null;
  }

  // Validar firma PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    console.error("[zip] ZIP: firma inválida — no es PKZIP local-file-header");
    return null;
  }

  // Método de compresión @offset 8, uint16 LE
  const method = buf.readUInt16LE(8);

  if (method === 0) {
    // Stored: los datos van directos, compressed_size == uncompressed_size
    const compressedSize = buf.readUInt32LE(18);
    const filenameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const dataOffset = 30 + filenameLen + extraLen;
    if (dataOffset + compressedSize > buf.length) {
      console.error("[zip] ZIP stored: buffer insuficiente para los datos");
      return null;
    }
    return buf.subarray(dataOffset, dataOffset + compressedSize);
  }

  if (method === 8) {
    // Deflate
    const compressedSize = buf.readUInt32LE(18);
    const filenameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const dataOffset = 30 + filenameLen + extraLen;

    if (dataOffset + compressedSize > buf.length) {
      console.error("[zip] ZIP: buffer insuficiente para los datos comprimidos");
      return null;
    }

    const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

    try {
      return inflateRawSync(compressedData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zip] inflateRawSync falló: ${msg}`);
      return null;
    }
  }

  // Método desconocido → ESCOTILLA: reportar y devolver null
  console.error(
    `[zip] ZIP: método de compresión desconocido ${method} (esperado 8=deflate o 0=stored). ` +
      "BLOCKED: dep fflate MIT requiere ADR del PM — no se añade automáticamente."
  );
  return null;
}
