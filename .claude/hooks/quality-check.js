#!/usr/bin/env node
/**
 * quality-check.js — PostToolUse hook (Node, no external deps).
 *
 * world_wide_project port of the proven TaxIA quality-check hook.
 *
 * MODE: WARN (exit 0 ALWAYS). It surfaces TypeScript errors after an edit but
 * never blocks — the implementing agent's own auto-verification protocol already
 * runs `pnpm -w build` / `tsc --noEmit`. This hook is a fast early-warning.
 *
 * Trigger: PostToolUse on Write|Edit|MultiEdit when the edited path is a
 * `.ts` / `.tsx` file under `packages/web/src`.
 *
 * Generalized from TaxIA: points at `packages/web` (the Vite+React+MapLibre
 * package) instead of `frontend/`, and uses the package's own tsconfig.
 *
 * To flip this hook to BLOCKING on type errors (when it matures), change the
 * `process.exit(0)` in the error branch to `process.exit(2)`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// --- Config (kept in sync with hooks/frontend/hook-config.json) ---------------
const FRONTEND_DIR = 'packages/web';
const SRC_PREFIX = path.join(FRONTEND_DIR, 'src');
const TSC_TIMEOUT_MS = 30000;
const MAX_ERROR_LINES = 10;
const CACHE_FILE = '.tsconfig-hash-cache.json';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

/** Resolve the project root (CLAUDE_PROJECT_DIR if present, else cwd). */
function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Normalize a possibly-absolute path to be relative to the project root. */
function toRel(root, p) {
  if (!p) return '';
  let rel = p;
  try {
    if (path.isAbsolute(p)) {
      rel = path.relative(root, p);
    }
  } catch (_e) {
    rel = p;
  }
  return rel.split(path.sep).join('/');
}

function main() {
  let event = {};
  try {
    const raw = readStdin();
    event = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    // Cannot parse the event — WARN mode means we just bow out quietly.
    process.exit(0);
  }

  const toolName =
    event.tool_name || (event.tool && event.tool.name) || event.toolName || '';
  if (!/^(Write|Edit|MultiEdit)$/.test(toolName)) {
    process.exit(0);
  }

  const input = event.tool_input || event.input || event.params || {};
  const editedPath =
    input.file_path || input.path || input.filePath || (input.edits && input.edits[0] && input.edits[0].file_path) || '';

  const root = projectRoot();
  const rel = toRel(root, editedPath);

  // Only act on .ts/.tsx under packages/web/src
  const isTs = /\.(ts|tsx)$/i.test(rel);
  const underSrc = rel.startsWith(SRC_PREFIX.split(path.sep).join('/')) || rel.startsWith('packages/web/src');
  if (!isTs || !underSrc) {
    process.exit(0);
  }

  const feDir = path.join(root, FRONTEND_DIR);
  const tsconfigPath = path.join(feDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    // No tsconfig yet (early in project life) — nothing to check.
    process.exit(0);
  }

  // Cache: skip redundant runs while tsconfig is unchanged AND no error was
  // previously surfaced. We hash the tsconfig contents; on change we always run.
  let cache = {};
  const cachePath = path.join(feDir, CACHE_FILE);
  try {
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (_e) {
    cache = {};
  }

  let tsconfigHash = '';
  try {
    tsconfigHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(tsconfigPath))
      .digest('hex');
  } catch (_e) {
    tsconfigHash = String(Date.now());
  }

  // Run `tsc --noEmit` (project mode). windowsHide keeps it quiet on win32.
  let tscOutput = '';
  let tscFailed = false;
  try {
    execSync('npx --no-install tsc --noEmit -p tsconfig.json', {
      cwd: feDir,
      timeout: TSC_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (e) {
    tscFailed = true;
    tscOutput = ((e.stdout || '') + '\n' + (e.stderr || '')).trim();
  }

  // Persist cache (best-effort).
  try {
    cache.tsconfigHash = tsconfigHash;
    cache.lastRun = new Date().toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch (_e) {
    /* ignore cache write failures */
  }

  if (!tscFailed) {
    // Clean — stay silent in WARN mode.
    process.exit(0);
  }

  // Filter tsc output to lines mentioning the file the agent just edited.
  const baseName = rel.split('/').pop();
  const allLines = tscOutput.split(/\r?\n/).filter((l) => /error TS\d+/i.test(l));
  const fileLines = allLines.filter((l) => l.includes(rel) || (baseName && l.includes(baseName)));

  let msg;
  if (fileLines.length > 0) {
    const shown = fileLines.slice(0, MAX_ERROR_LINES);
    const more = fileLines.length - shown.length;
    msg =
      `[quality-check] tsc --noEmit encontro ${fileLines.length} error(es) de tipos en ${rel}:\n` +
      shown.join('\n') +
      (more > 0 ? `\n... +${more} mas` : '');
  } else if (allLines.length > 0) {
    msg =
      `[quality-check] tsc --noEmit encontro ${allLines.length} error(es) de tipos en packages/web ` +
      `(ninguno directamente en ${rel}). Revisa antes de declarar la tarea hecha.`;
  } else {
    msg =
      `[quality-check] tsc --noEmit fallo en packages/web. Salida:\n` + tscOutput.slice(0, 1500);
  }

  // WARN mode: emit context for the agent, but never block.
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: msg,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.stderr.write(msg + '\n');
  process.exit(0);
}

main();
