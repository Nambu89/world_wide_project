// @www/connectors — barrel público del paquete de conectores.
// Layout canónico (CLAUDE.md): packages/connectors/{finance,geo,edu}/<source>.ts
// Conectores keyless patrón osiris (T-03a/b/c): fetch + User-Agent + AbortSignal.timeout(8000)
// + fallback multinivel + retorno vacío gracioso + cache/ETag.
export { fetchMarkets } from './finance/markets.js';
export { fetchGdelt } from './geo/gdelt.js';
export { fetchNews } from './edu/news.js';
export type { ConnectorResult } from './finance/markets.js';
