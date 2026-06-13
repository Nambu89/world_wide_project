// packages/connectors/edu/allowlist.ts
//
// SSRF-safe allowlist para feeds RSS de noticias educativas/financieras.
// Mecanismo: cada URL de feed se valida contra esta lista antes de cualquier fetch.
// Si la URL no pasa isAllowedFeedUrl(), se DESCARTA — nunca se fetchea (R-7 SSRF).
//
// Feeds y licencias:
//   - feeds.bbci.co.uk  — BBC RSS, uso personal permitido (no redistribución comercial).
//     Ref: https://www.bbc.co.uk/usingthebbc/terms/
//   - www.cnbc.com       — CNBC RSS, uso personal permitido.
//     Ref: https://www.cnbc.com/site-map/ (RSS endpoint público)
//
// Nota: feeds marcados CC-BY requieren atribución en la UI.
// Esta lista es configurable y se refina en iteraciones posteriores.
// El mecanismo SSRF-safe (validación de hostname exacto + https + sin credenciales)
// es lo que garantiza seguridad independientemente de qué feeds estén en la lista.

export const FEED_ALLOWLIST: ReadonlyArray<{
  domain: string;
  url: string;
  license: string;
}> = [
  {
    domain: 'feeds.bbci.co.uk',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    license: 'BBC RSS personal use',
  },
  {
    domain: 'www.cnbc.com',
    url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    license: 'CNBC RSS personal use',
  },
];

/**
 * Valida que una URL es segura para fetch:
 *   1. Protocolo estrictamente https.
 *   2. Hostname exactamente igual a un domain de la allowlist (sin subdominios extra).
 *   3. Sin credenciales en la URL (username / password).
 *
 * Retorna false para cualquier URL malformada o no permitida.
 * Usar SIEMPRE antes de hacer fetch a una URL de feed (R-7 SSRF).
 */
export function isAllowedFeedUrl(u: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }

  // Protocolo: solo https
  if (parsed.protocol !== 'https:') return false;

  // Sin credenciales en la URL (SSRF / credential-leaking)
  if (parsed.username !== '' || parsed.password !== '') return false;

  // Hostname exacto contra la allowlist (no prefijo, no sufijo, comparación estricta)
  const allowed = FEED_ALLOWLIST.some(
    (entry) => entry.domain === parsed.hostname,
  );

  return allowed;
}
