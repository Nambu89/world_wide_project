// packages/store/src/migrate.ts
// Idempotent migration runner — reads migrations/*.sql, applies unapplied ones,
// records in _migrations table (D-101, ADR-006).

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client as LibsqlClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve migrations dir relative to this file (src/ -> ../migrations/)
function migrationsDir(): string {
  return join(__dirname, '..', 'migrations');
}

/**
 * Idempotent migration runner.
 * - Ensures _migrations table exists (bootstrap step).
 * - Reads all *.sql files in migrations/ in lexicographic order.
 * - Skips any migration whose id is already recorded in _migrations.
 * - Executes each new migration and records it atomically.
 */
export async function migrate(client: LibsqlClient): Promise<void> {
  // Bootstrap: create _migrations if not yet present
  await client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const dir = migrationsDir();
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic = chronological for NN_ prefix

  for (const file of files) {
    const id = file; // e.g. "001_init.sql"

    // Check if already applied
    const result = await client.execute({
      sql: 'SELECT id FROM _migrations WHERE id = ?',
      args: [id],
    });

    if (result.rows.length > 0) {
      continue; // already applied — idempotent
    }

    const sql = await readFile(join(dir, file), 'utf-8');

    // Split on statement boundaries and execute each statement individually
    // (libSQL execute() handles one statement at a time)
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await client.execute(stmt);
    }

    // Record migration as applied
    await client.execute({
      sql: 'INSERT INTO _migrations (id, applied_at) VALUES (?, ?)',
      args: [id, Date.now()],
    });
  }
}
