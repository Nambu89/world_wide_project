#!/usr/bin/env node
/**
 * workflow-guard.js — PreToolUse SOFT hook (Node, no external deps).
 *
 * From get-shit-done's workflow-guard. ADVISORY ONLY: it NEVER blocks and
 * fails SILENT on any error — availability over enforcement. It nudges the
 * agent toward the /pm workflow + the RPI quality gates when an Edit/Write
 * happens with no active plan in evidence.
 *
 * Matcher: Edit|Write|MultiEdit
 * Output: exit 0 ALWAYS. When it wants to nudge, it emits
 *   { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }
 * which Claude Code surfaces as extra context (not a denial).
 *
 * Heuristic for "no active plan": there is no plan artifact under plans/ or
 * docs/design/ modified recently, and the edit is to a source file under
 * packages/ or server.ts. This is a gentle reminder, intentionally imprecise.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Has any plan/design artifact been touched in the last N minutes? */
function hasRecentPlan(root) {
  const dirs = [path.join(root, 'plans'), path.join(root, 'docs', 'design')];
  const windowMs = 6 * 60 * 60 * 1000; // 6h — generous; this is only a nudge
  const now = Date.now();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        if (!/\.md$/i.test(e)) continue;
        try {
          const st = fs.statSync(path.join(dir, e));
          if (now - st.mtimeMs < windowMs) return true;
        } catch (_e) {
          /* ignore */
        }
      }
    } catch (_e) {
      /* ignore */
    }
  }
  // implementation_plan.md at root also counts.
  try {
    const ip = path.join(root, 'implementation_plan.md');
    if (fs.existsSync(ip)) {
      const st = fs.statSync(ip);
      if (now - st.mtimeMs < windowMs) return true;
    }
  } catch (_e) {
    /* ignore */
  }
  return false;
}

function nudge(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: message,
    },
  };
  try {
    process.stdout.write(JSON.stringify(out));
  } catch (_e) {
    /* ignore */
  }
  process.exit(0);
}

function main() {
  let event = {};
  try {
    const raw = readStdin();
    event = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    process.exit(0); // fail silent
  }

  try {
    const toolName = event.tool_name || (event.tool && event.tool.name) || '';
    if (!/^(Write|Edit|MultiEdit)$/.test(toolName)) {
      process.exit(0);
    }

    const input = event.tool_input || event.input || {};
    const p = (input.file_path || input.path || '').replace(/\\/g, '/');

    // Only nudge on production source edits.
    const isSource = /(^|\/)packages\//.test(p) || /(^|\/)server\.ts$/.test(p);
    if (!isSource) {
      process.exit(0);
    }

    const root = projectRoot();
    if (hasRecentPlan(root)) {
      process.exit(0); // there is an active plan — no nudge needed
    }

    nudge(
      'workflow-guard (aviso, no bloquea): estas editando codigo de produccion sin un plan ' +
        'reciente en plans/ o docs/design/. El flujo RPI recomienda: /design -> /check-plan (PASS) ' +
        '-> implementar -> /verify (VERIFIED). Activa /pm para orquestar y registrar la decision. ' +
        'Si esto es un fix puntual autorizado, ignora este aviso.'
    );
  } catch (_e) {
    process.exit(0); // fail silent — availability over enforcement
  }
}

main();
