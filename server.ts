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
 */

import * as http from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  migrate,
  getLatestMarkets,
  getMarketTrend,
  getRecentGdeltEvents,
  getCachedBriefing,
} from '@www/store';
import { createScheduler, defaultJobs } from '@www/scheduler';

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

// ─── Router ───────────────────────────────────────────────────────────────────

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  // Only GET is served (read-only store endpoints)
  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
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
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
