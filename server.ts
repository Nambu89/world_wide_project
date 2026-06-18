/**
 * server.ts — world_wide_project backend singleton
 *
 * Boot order (ADR-004/G-7):
 *   1. migrate()                         — idempotent schema sync
 *   2. createScheduler(defaultJobs()).start() — background jobs
 *   3. HTTP server listening             — serve UI read-only endpoints
 *
 * Middleware pipeline (normative order):
 *   origin-check → CORS → rate-limit → SSRF-guard → route
 *
 * Endpoints (read-only from store — UI NEVER calls upstream):
 *   GET /api/health
 *   GET /api/markets
 *   GET /api/markets/:symbol
 *   GET /api/gdelt
 *   GET /api/briefing
 *   GET /api/events/:source/:id   (T-12 — detail; more specific, checked first)
 *   GET /api/events               (T-12 — list with filters)
 *   GET /api/signals/trend        (T-19 — section trend; more specific, checked first)
 *   GET /api/signals              (T-19 — list with filters)
 *   GET /api/cii/:country         (T-25 — country CII trend; more specific, checked first)
 *   GET /api/cii                  (T-25 — latest CII snapshot per country + centroids)
 *   GET /api/convergence          (T-33 — latest convergence signal per country + centroids)
 *   POST /api/translate           (Slice D / ADR-018 — SOLE write/LLM exception; cache-first on-demand translation)
 */

import * as http from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  migrate,
  getLatestMarkets,
  getMarketTrend,
  getRecentGdeltEvents,
  getCachedBriefing,
  getEvents,
  getEvent,
  getSignals,
  getSignalTrend,
  getLatestCii,
  getCiiTrend,
  getLatestConvergence,
  getLatestSanctions,
  getLatestChokepointStatus,
  getTranslation,
  putTranslation,
} from '@www/store';
import type { EventFilter, Section, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow } from '@www/store';
import { COUNTRY_CENTROIDS } from './packages/connectors/geo/country-centroids.js';
import { createScheduler, defaultJobs } from '@www/scheduler';
import { CHOKEPOINTS } from '@www/core-signals';
import { parseInsights, complete } from '@www/core-ai';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppOptions {
  /** Port to listen on. 0 = OS-assigned ephemeral port (useful in tests). */
  port?: number;
  /** If false, scheduler is NOT started (for tests). Default: true. */
  startScheduler?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORT = Number(process.env['PORT'] ?? 8787);

/** Allowed origins for CORS / origin-check. */
const ALLOWED_ORIGINS: Set<string> = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
]);

/**
 * Rate-limit: max requests per window per IP.
 * In-memory, resets on server restart (intentional for MVP lean stack).
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120;          // 120 req/min per IP

/** Default sparkline lookback when `since` querystring is absent. */
const DEFAULT_TREND_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Valid Section values for /api/signals and /api/signals/trend (T-19).
 * Must stay in sync with Section type in @www/store/types.ts.
 */
const VALID_SECTIONS: Set<Section> = new Set([
  'political_instability',
  'commodities_energy',
  'critical_minerals',
  'semis_ai_tech',
  'digital_infra_cyber',
  'trade_sanctions',
]);

// ─── Rate-limit store (in-memory) ────────────────────────────────────────────

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateEntry>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── Middleware helpers ───────────────────────────────────────────────────────

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function getOrigin(req: http.IncomingMessage): string | undefined {
  const origin = req.headers['origin'];
  return typeof origin === 'string' ? origin : undefined;
}

/**
 * SSRF-guard: validate that a URL string resolves to a non-private host.
 * In the MVP all API endpoints are read-only from the store; no route
 * dynamically resolves user-supplied URLs. This guard is present defensively
 * and rejects any attempt to forward a user-supplied URL to an upstream.
 *
 * Returns { safe: true } if the URL is within the allowed-origin set,
 * or { safe: false, reason } otherwise.
 */
function ssrfGuard(rawUrl: string): { safe: true } | { safe: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'unparseable URL' };
  }

  const { hostname } = parsed;

  // Reject loopback / RFC-1918 / link-local / unspecified
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
    /^169\.254\./,
  ];
  for (const pat of privatePatterns) {
    if (pat.test(hostname)) {
      return { safe: false, reason: `private/loopback host: ${hostname}` };
    }
  }

  return { safe: true };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendEmpty(res: http.ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

/**
 * Reads and JSON-parses a request body with a byte cap (Slice D / D-902).
 * Resolves null on parse error, oversized body, or stream error — never rejects.
 */
function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = 4096,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  // Read-only store endpoints are GET. The SOLE exception is POST /api/translate
  // (ADR-018 / D-902): user-initiated, cache-first, bounded on-demand translation.
  if (method !== 'GET' && !(method === 'POST' && pathname === '/api/translate')) {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  // ── POST /api/translate ─────────────────────────────────────────────────────
  // ADR-018 / D-902: ÚNICA excepción a "no LLM on-request". Cache-first; dispara la
  // IA solo en miss; degrada graciosa a { translated: null } si no hay LLM (D-907).
  if (pathname === '/api/translate' && method === 'POST') {
    const body = await readJsonBody(req);
    const text = typeof body?.['text'] === 'string' ? (body['text'] as string).trim() : '';
    if (!text || text.length > 500) {
      sendJson(res, 400, { error: 'text required (1..500 chars)' });
      return;
    }
    const cached = await getTranslation(text);
    if (cached !== null) {
      sendJson(res, 200, { translated: cached });
      return;
    }
    try {
      const prompt = `Traduce al español. Devuelve SOLO la traducción, sin comillas ni preámbulo:\n\n${text}`;
      const out = (await complete(prompt, { temperature: 0, maxTokens: 800 })).trim();
      if (out) await putTranslation(text, out);
      sendJson(res, 200, { translated: out || null });
    } catch {
      sendJson(res, 200, { translated: null });
    }
    return;
  }

  // ── /api/health ────────────────────────────────────────────────────────────
  if (pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', ts: Date.now() });
    return;
  }

  // ── /api/markets/:symbol ───────────────────────────────────────────────────
  const marketTrendMatch = pathname.match(/^\/api\/markets\/([^/]+)$/);
  if (marketTrendMatch) {
    const symbol = decodeURIComponent(marketTrendMatch[1] ?? '');
    const sinceParam = url.searchParams.get('since');
    const sinceMs = sinceParam
      ? Number(sinceParam)
      : Date.now() - DEFAULT_TREND_LOOKBACK_MS;

    if (!symbol) {
      sendJson(res, 400, { error: 'symbol is required' });
      return;
    }

    const trend = await getMarketTrend(symbol, sinceMs);
    sendJson(res, 200, trend);
    return;
  }

  // ── /api/markets ──────────────────────────────────────────────────────────
  if (pathname === '/api/markets') {
    const markets = await getLatestMarkets();
    sendJson(res, 200, markets);
    return;
  }

  // ── /api/gdelt ────────────────────────────────────────────────────────────
  if (pathname === '/api/gdelt') {
    const sinceParam = url.searchParams.get('since');
    const sinceMs = sinceParam
      ? Number(sinceParam)
      : Date.now() - 24 * 60 * 60 * 1000; // default: last 24h
    const events = await getRecentGdeltEvents(sinceMs);
    sendJson(res, 200, events);
    return;
  }

  // ── /api/briefing ─────────────────────────────────────────────────────────
  if (pathname === '/api/briefing') {
    // NEVER fires Anthropic on-request. Only reads cache from store.
    const briefing = await getCachedBriefing('finance', Date.now());
    if (briefing === null) {
      // 200 with null briefing (no content yet — scheduler hasn't run daily job)
      sendJson(res, 200, { briefing: null });
      return;
    }
    sendJson(res, 200, { briefing });
    return;
  }

  // ── /api/insights ─────────────────────────────────────────────────────────
  // SOLO-LECTURA. Returns the latest intel insight batch (briefings domain='intel',
  // body_md = JSON array). Serves the last batch even if stale (nowMs=0). NEVER calls
  // the LLM on-request — generation happens in the scheduler daily job (ADR-004).
  if (pathname === '/api/insights') {
    const cached = await getCachedBriefing('intel', 0);
    const insights = cached ? parseInsights(cached.body_md) : [];
    sendJson(res, 200, {
      insights,
      generatedAt: cached ? cached.created_at : null,
      model: cached ? cached.model : null,
    });
    return;
  }

  // ── /api/events/:source/:id ───────────────────────────────────────────────
  // More specific pattern — checked BEFORE /api/events (list) to avoid shadowing.
  // raw_json is stored as a JSON string in EventRow; parsed here to return a proper
  // JSON object in the response body (field: parsedRawJson). If unparseable, returns
  // the raw string as-is so no information is lost.
  const eventDetailMatch = pathname.match(/^\/api\/events\/([^/]+)\/([^/]+)$/);
  if (eventDetailMatch) {
    const source = decodeURIComponent(eventDetailMatch[1] ?? '');
    const id = decodeURIComponent(eventDetailMatch[2] ?? '');
    const event = await getEvent(source, id);
    if (event === null) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }
    // Parse raw_json string to object so clients receive clean JSON, not an
    // escaped string. If it fails (malformed), send the string as-is.
    let parsedRawJson: unknown = event.rawJson;
    if (typeof event.rawJson === 'string') {
      try {
        parsedRawJson = JSON.parse(event.rawJson) as unknown;
      } catch {
        // keep rawJson as string — not a routing error
      }
    }
    sendJson(res, 200, { ...event, rawJson: parsedRawJson });
    return;
  }

  // ── /api/events ──────────────────────────────────────────────────────────
  // D-107/ADR-004: SOLO-LECTURA. Never fires connectors on-request.
  // Parses querystring into EventFilter; absent params are omitted (not set to undefined).
  if (pathname === '/api/events') {
    const filter: EventFilter = {};

    const typeParam = url.searchParams.get('type');
    if (typeParam !== null) filter.type = typeParam;

    const categoryParam = url.searchParams.get('category');
    if (categoryParam === 'natural' || categoryParam === 'conflict') {
      filter.category = categoryParam;
    }

    const sinceParam = url.searchParams.get('since');
    if (sinceParam !== null) {
      const sinceMs = Number(sinceParam);
      if (Number.isFinite(sinceMs)) filter.sinceMs = sinceMs;
    }

    const minSevParam = url.searchParams.get('minSeverity');
    if (minSevParam !== null) {
      const minSev = Number(minSevParam);
      if (Number.isFinite(minSev)) filter.minSeverity = minSev;
    }

    const limitParam = url.searchParams.get('limit');
    if (limitParam !== null) {
      const limit = Number(limitParam);
      if (Number.isFinite(limit) && limit > 0) filter.limit = Math.floor(limit);
    }

    const bboxParam = url.searchParams.get('bbox');
    if (bboxParam !== null) {
      const parts = bboxParam.split(',').map(Number);
      if (
        parts.length === 4 &&
        parts.every((n) => Number.isFinite(n))
      ) {
        filter.bbox = parts as [number, number, number, number];
      }
      // If not 4 valid floats, bbox is silently ignored (T-12 constraint)
    }

    const events = await getEvents(filter);
    sendJson(res, 200, events);
    return;
  }

  // ── /api/signals/trend ────────────────────────────────────────────────────
  // T-19 — SOLO-LECTURA. Checked BEFORE /api/signals (more specific pathname).
  // section is REQUIRED; since→sinceMs and bucket→bucketMs are optional.
  // NEVER fires connectors on-request (ADR-004/D-007/D-107).
  if (pathname === '/api/signals/trend') {
    const sectionParam = url.searchParams.get('section');
    if (sectionParam === null || !VALID_SECTIONS.has(sectionParam as Section)) {
      sendJson(res, 400, {
        error: 'section is required and must be one of: political_instability, commodities_energy, critical_minerals, semis_ai_tech, digital_infra_cyber, trade_sanctions',
      });
      return;
    }
    const section = sectionParam as Section;

    const trendOpts: { sinceMs?: number; bucketMs?: number } = {};

    const sinceParam = url.searchParams.get('since');
    if (sinceParam !== null) {
      const sinceMs = Number(sinceParam);
      if (Number.isFinite(sinceMs)) trendOpts.sinceMs = sinceMs;
    }

    const bucketParam = url.searchParams.get('bucket');
    if (bucketParam !== null) {
      const bucketMs = Number(bucketParam);
      if (Number.isFinite(bucketMs) && bucketMs > 0) trendOpts.bucketMs = bucketMs;
    }

    const trend = await getSignalTrend(section, trendOpts);
    sendJson(res, 200, trend);
    return;
  }

  // ── /api/signals ──────────────────────────────────────────────────────────
  // T-19 — SOLO-LECTURA. Parses querystring into getSignals opts.
  // section: optional; if present and invalid → 400.
  // NEVER fires connectors on-request (ADR-004/D-007/D-107).
  if (pathname === '/api/signals') {
    const signalOpts: { section?: Section; sinceMs?: number; limit?: number; minToneMag?: number } = {};

    const sectionParam = url.searchParams.get('section');
    if (sectionParam !== null) {
      if (!VALID_SECTIONS.has(sectionParam as Section)) {
        sendJson(res, 400, {
          error: 'section must be one of: political_instability, commodities_energy, critical_minerals, semis_ai_tech, digital_infra_cyber, trade_sanctions',
        });
        return;
      }
      signalOpts.section = sectionParam as Section;
    }

    const sinceParam = url.searchParams.get('since');
    if (sinceParam !== null) {
      const sinceMs = Number(sinceParam);
      if (Number.isFinite(sinceMs)) signalOpts.sinceMs = sinceMs;
    }

    const limitParam = url.searchParams.get('limit');
    if (limitParam !== null) {
      const limit = Number(limitParam);
      if (Number.isFinite(limit) && limit > 0) signalOpts.limit = Math.floor(limit);
    }

    const minToneMagParam = url.searchParams.get('minToneMag');
    if (minToneMagParam !== null) {
      const minToneMag = Number(minToneMagParam);
      if (Number.isFinite(minToneMag)) signalOpts.minToneMag = minToneMag;
    }

    const signals = await getSignals(signalOpts);
    sendJson(res, 200, signals);
    return;
  }

  // ── /api/cii/:country ─────────────────────────────────────────────────────
  // T-25 — SOLO-LECTURA. More specific pattern — checked BEFORE /api/cii (list).
  // Returns CiiSnapshotRow[] trend for the given country (camelCase, no transform).
  // NEVER fires the CII engine on-request (D-212/ADR-004).
  const ciiTrendMatch = pathname.match(/^\/api\/cii\/([^/]+)$/);
  if (ciiTrendMatch) {
    const country = decodeURIComponent(ciiTrendMatch[1] ?? '');
    const sinceParam = url.searchParams.get('since');
    const sinceMs = sinceParam
      ? Number(sinceParam)
      : Date.now() - 30 * 24 * 60 * 60 * 1000; // default: last 30 days

    // Country without data → [] (never 500)
    const trend = await getCiiTrend(country, sinceMs);
    sendJson(res, 200, trend);
    return;
  }

  // ── /api/cii ──────────────────────────────────────────────────────────────
  // T-25 — SOLO-LECTURA. Returns latest CII snapshot per country with lat/lon
  // from COUNTRY_CENTROIDS lookup. Countries without a centroid get lat/lon null
  // (shown in panel only, not on map). Never fires CII engine on-request (D-212/ADR-004).
  if (pathname === '/api/cii') {
    const rows = await getLatestCii();
    const payload = rows.map((row: CiiSnapshotRow) => {
      const centroid = COUNTRY_CENTROIDS[row.country];
      return {
        ...row,
        lat: centroid !== undefined ? centroid.lat : null,
        lon: centroid !== undefined ? centroid.lon : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }

  // ── /api/convergence ──────────────────────────────────────────────────────
  // T-33 — SOLO-LECTURA. Returns latest convergence signal per country with
  // lat/lon from COUNTRY_CENTROIDS lookup. Countries without a centroid get
  // lat/lon null (shown in panel only, not on map).
  // NEVER fires the convergence engine on-request (D-400/D-401/ADR-004).
  if (pathname === '/api/convergence') {
    const rows = await getLatestConvergence();
    const payload = rows.map((row: ConvergenceSignalRow) => {
      const centroid = COUNTRY_CENTROIDS[row.country];
      return {
        ...row,
        lat: centroid !== undefined ? centroid.lat : null,
        lon: centroid !== undefined ? centroid.lon : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }

  // ── /api/chokepoints ──────────────────────────────────────────────────────
  // SOLO-LECTURA. Merges the static CHOKEPOINTS config (geometry + documented
  // impact) with the latest disruption status per chokepoint. A chokepoint with
  // no status snapshot yet defaults to calm/score 0. NEVER fires detection on-request.
  if (pathname === '/api/chokepoints') {
    const statusRows = await getLatestChokepointStatus();
    const byId = new Map(statusRows.map((r) => [r.chokepointId, r]));
    const payload = CHOKEPOINTS.map((cp) => {
      const st = byId.get(cp.id);
      return {
        id: cp.id,
        name: cp.name,
        nameEs: cp.nameEs,
        lat: cp.lat,
        lon: cp.lon,
        commodities: cp.commodities,
        worldShare: cp.worldShare,
        dependentEconomies: cp.dependentEconomies,
        impactEs: cp.impactEs,
        status: st ? st.status : 'calm',
        score: st ? st.score : 0,
        capturedAt: st ? st.capturedAt : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }

  // ── /api/sanctions ──────────────────────────────────────────────────────
  // SOLO-LECTURA. Returns latest OFAC sanctions count per country with lat/lon
  // from COUNTRY_CENTROIDS lookup. Countries without a centroid get lat/lon null
  // (shown in panel only, not on map). NEVER fires the connector on-request (ADR-004).
  if (pathname === '/api/sanctions') {
    const rows = await getLatestSanctions();
    const payload = rows.map((row: SanctionRow) => {
      const centroid = COUNTRY_CENTROIDS[row.country];
      return {
        ...row,
        lat: centroid !== undefined ? centroid.lat : null,
        lon: centroid !== undefined ? centroid.lon : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  sendJson(res, 404, { error: 'Not Found' });
}

// ─── Middleware pipeline ──────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const origin = getOrigin(req);
    const ip = getClientIp(req);

    // ── 1. Origin-check ───────────────────────────────────────────────────────
    // Block cross-origin requests from unknown origins.
    // No-origin requests (curl, server-to-server) are allowed in MVP.
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { error: 'Forbidden: origin not allowed' });
      return;
    }

    // ── 2. CORS ───────────────────────────────────────────────────────────────
    if (origin !== undefined && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204);
      return;
    }

    // ── 3. Rate-limit ─────────────────────────────────────────────────────────
    if (!checkRateLimit(ip)) {
      res.setHeader('Retry-After', String(RATE_LIMIT_WINDOW_MS / 1000));
      sendJson(res, 429, { error: 'Too Many Requests' });
      return;
    }

    // ── 4. SSRF-guard (defensive / non-op for pure-store routes) ─────────────
    // No route in the MVP resolves user-supplied URLs to upstreams.
    // The guard runs as a no-op check on the request URL itself; if somehow
    // a route were to forward a query-param URL to upstream, it MUST call
    // ssrfGuard() first. Exporting the guard makes it available to future routes.
    void ssrfGuard; // reference to prevent tree-shaking; real calls happen in connectors

    // ── 5. Route ──────────────────────────────────────────────────────────────
    await route(req, res);
  } catch (err) {
    console.error('[server] unhandled error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }
}

// ─── App factory ─────────────────────────────────────────────────────────────

/**
 * Creates and (optionally) starts the HTTP server.
 * Exported so tests can call createApp({ startScheduler: false }).
 */
export function createApp(opts: AppOptions = {}): http.Server {
  const server = http.createServer(handleRequest);
  if (opts.startScheduler !== false) {
    // Scheduler is started by the caller after migrate(); not here directly.
    // This flag is checked in start() below. Factory only wires the HTTP server.
  }
  return server;
}

// Export ssrfGuard so connectors and future routes can use it
export { ssrfGuard };

// ─── Production entrypoint ────────────────────────────────────────────────────

async function start(): Promise<void> {
  console.log('[server] starting...');

  // Step 1: migrate (ADR-004/G-7)
  await migrate();
  console.log('[server] migrations complete');

  // Step 2: scheduler
  const scheduler = createScheduler(defaultJobs());
  scheduler.start();
  console.log('[server] scheduler started');

  // Step 3: HTTP server
  const port = DEFAULT_PORT;
  const server = createApp({ startScheduler: false }); // scheduler already started above
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`[server] listening on http://localhost:${boundPort}`);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received — shutting down`);
    scheduler.stop();
    server.close(() => {
      console.log('[server] closed');
      process.exit(0);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// Guard: only run start() when this file is the entrypoint
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  start().catch((err) => {
    console.error('[server] fatal startup error:', err);
    process.exit(1);
  });
}
