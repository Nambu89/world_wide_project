// packages/store/src/db.ts
// Singleton libSQL client — ADR-006: url file:./data/world.db
// PROHIBITION: no better-sqlite3 (different API, native build issues on Windows)

import { createClient } from '@libsql/client';
import type { Client as LibsqlClient } from '@libsql/client';

let _client: LibsqlClient | undefined;

/**
 * Returns the singleton libSQL client.
 * Uses file:./data/world.db by default; pass a custom url for tests.
 */
export function getDb(url?: string): LibsqlClient {
  if (_client !== undefined) return _client;
  const resolved = url ?? (process.env['LIBSQL_URL'] ?? 'file:./data/world.db');
  _client = createClient({ url: resolved });
  return _client;
}

/**
 * Reset the singleton — only for testing purposes.
 * Call this after closing the test DB to allow a fresh client next time.
 */
export function _resetDbForTesting(): void {
  _client = undefined;
}
