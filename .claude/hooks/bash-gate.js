#!/usr/bin/env node
/**
 * bash-gate.js — PreToolUse gate for the `Bash` tool. (Node, no external deps.)
 *
 * world_wide_project hardened port of the proven TaxIA bash-gate.
 *
 * POLICY: DEFAULT-DENY (the load-bearing hardening vs TaxIA, which was FAIL-OPEN).
 *   1. DENY_RULES are checked FIRST (highest priority). Match => exit 2 (deny).
 *   2. SAFE_COMMANDS allow-list. Match => exit 0 (allow / auto-approve).
 *   3. Anything else => exit 2 (DENY) with guidance on stderr. <-- changed from TaxIA's exit 0
 *   4. Parse error / unexpected input (catch) => exit 2 (DENY). <-- changed from TaxIA's fail-open
 *
 * Contract: reads the PreToolUse JSON event from stdin, writes the offending
 * reason to stderr, and signals the decision via the process exit code:
 *   exit 0 = allow
 *   exit 2 = deny (Claude Code surfaces stderr as the denial reason)
 *
 * This gate REPLACES a hand-maintained permissions.allow Bash list: it
 * auto-approves the safe verbs of this stack (pnpm/npm/npx/node/tsc/vitest/
 * git read+write/playwright/curl/...) and blocks the dangerous ones, so the
 * human is only prompted for genuinely unknown commands.
 *
 * Generalized from TaxIA to the world_wide_project stack:
 *   - DROPPED the Python venv-forcing rules (this is a Node/TypeScript monorepo).
 *   - GENERALIZED the .env rule to "never write any secret file".
 *   - ADDED GSD worktree-safety bans: `git clean -fdx`, blanket `git reset --hard`.
 *   - ADDED a ban on GLOBAL package installs (force project-local pnpm/npm).
 */

'use strict';

/** Read all of stdin synchronously into a string. */
function readStdin() {
  try {
    const fs = require('fs');
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

/** Deny with a reason on stderr (exit 2). */
function deny(reason) {
  process.stderr.write('BLOCKED: ' + reason + '\n');
  process.exit(2);
}

/** Allow (exit 0). */
function allow() {
  process.exit(0);
}

/**
 * DENY_RULES — checked first, highest priority.
 * Each rule: { test(cmd) => bool, msg } . If any matches => deny.
 */
const DENY_RULES = [
  {
    // Catastrophic recursive deletes of root / home / drive roots.
    test: (c) =>
      /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f?\b[^\n]*\s+(\/|~|\$HOME|\.{0,1}\/\*|[A-Za-z]:\\?)\s*$/i.test(c) ||
      /\brm\s+-rf?\s+\/(\s|$)/i.test(c) ||
      /\brm\s+-rf?\s+\*/i.test(c) ||
      /\bRemove-Item\b[^\n]*-Recurse[^\n]*(-Force)?[^\n]*\s+[A-Za-z]:\\?\s*$/i.test(c),
    msg:
      'rm -rf / (o equivalente sobre la raiz/HOME/raiz de unidad) esta prohibido. ' +
      'Borra solo rutas concretas dentro del proyecto.',
  },
  {
    // Never write a secret file (generalized .env rule). Secrets -> env vars only.
    test: (c) =>
      /(^|[\s;&|])(>{1,2}|tee\b)[^\n]*\.env(\.[\w.-]+)?(\s|$)/i.test(c) ||
      /\becho\b[^\n]*>{1,2}[^\n]*\.env/i.test(c) ||
      /(^|[\s;&|])(>{1,2}|tee\b)[^\n]*(secrets?|credentials?|\.pem|id_rsa|\.key)(\s|$)/i.test(c) ||
      /\bSet-Content\b[^\n]*\.env/i.test(c) ||
      /\bOut-File\b[^\n]*\.env/i.test(c),
    msg:
      'Prohibido escribir ficheros de secretos (.env / .env.* / credenciales / claves). ' +
      'Los secretos van en variables de entorno, NUNCA commiteados. Usa .env.example para documentar claves.',
  },
  {
    // GSD worktree-safety: blow-away of untracked files can destroy a sibling agent's WIP.
    test: (c) => /\bgit\s+clean\b[^\n]*-[a-z]*d/i.test(c) && /-[a-z]*f/i.test(c),
    msg:
      'git clean -fdx esta prohibido: puede destruir el trabajo no commiteado de un agente hermano en otro worktree.',
  },
  {
    // Blanket destructive resets.
    test: (c) =>
      /\bgit\s+reset\s+--hard\b(?!\s+HEAD\b)/i.test(c) ||
      /\bgit\s+reset\s+--hard\s+HEAD~/i.test(c) ||
      /\bgit\s+checkout\s+--\s+\.\s*$/i.test(c),
    msg:
      'Reset/checkout destructivo en bloque prohibido (git reset --hard <ref> / checkout -- .). ' +
      'Solo el PM integra; no destruyas cambios sin aprobacion.',
  },
  {
    // Force-push / publish / tag — integration boundary is the PM's, not a worker's.
    test: (c) =>
      /\bgit\s+push\b[^\n]*--force(-with-lease)?\b/i.test(c) ||
      /\bgit\s+push\b[^\n]*\s-f(\s|$)/i.test(c) ||
      /\bnpm\s+publish\b/i.test(c) ||
      /\bpnpm\s+publish\b/i.test(c),
    msg:
      'Force-push / publish prohibido. La integracion (commit/push/merge/publish/tag) la hace solo el PM con aprobacion humana.',
  },
  {
    // Force project-local installs: no global package installs.
    test: (c) =>
      /\b(npm|pnpm|yarn)\s+(i|install|add)\b[^\n]*\s(-g|--global)\b/i.test(c) ||
      /\bnpm\s+install\s+--global\b/i.test(c),
    msg:
      'Instalacion GLOBAL de paquetes prohibida. Usa instalacion local del proyecto (pnpm add / npm install sin -g).',
  },
  {
    // Piping a remote script straight into a shell — classic supply-chain RCE.
    test: (c) => /\bcurl\b[^\n]*\|\s*(sh|bash|node|pwsh|powershell)\b/i.test(c) || /\bwget\b[^\n]*\|\s*(sh|bash)\b/i.test(c),
    msg:
      'Pipe de un script remoto a un shell (curl ... | sh) prohibido. Descarga, inspecciona y ejecuta por separado.',
  },
];

/**
 * SAFE_COMMANDS — auto-approve allow-list (ported from TaxIA, generalized to
 * the Node/TypeScript + Turso + MapLibre stack). A command that matches ANY of
 * these AND matched no DENY_RULE is auto-approved.
 *
 * Note: these are intentionally permissive on read verbs and project tooling;
 * the dangerous shapes are already carved out above in DENY_RULES.
 */
const SAFE_COMMANDS = [
  // Read-only filesystem inspection
  /^\s*ls(\s|$)/i,
  /^\s*cat\s+/i,
  /^\s*head\s+/i,
  /^\s*tail\s+/i,
  /^\s*find\s+/i,
  /^\s*wc\s+/i,
  /^\s*stat\s+/i,
  /^\s*du\s+/i,
  /^\s*tree(\s|$)/i,
  /^\s*pwd\s*$/i,
  /^\s*which\s+/i,
  /^\s*file\s+/i,
  /^\s*realpath\s+/i,
  // Text search / processing (read-only)
  /^\s*grep\s+/i,
  /^\s*rg\s+/i,
  /^\s*awk\s+/i,
  /^\s*sed\s+/i,
  /^\s*cut\s+/i,
  /^\s*sort\s+/i,
  /^\s*uniq\s+/i,
  /^\s*diff\s+/i,
  /^\s*jq\s+/i,
  // Echo / printf (output only; secret-file writes already denied above)
  /^\s*echo\b/i,
  /^\s*printf\b/i,
  // Directory + safe file ops (rm -rf / already denied above)
  /^\s*mkdir\s+/i,
  /^\s*touch\s+/i,
  /^\s*cp\s+/i,
  /^\s*mv\s+/i,
  /^\s*rm\s+/i,
  /^\s*chmod\s+/i,
  /^\s*ln\s+/i,
  /^\s*cd\s+/i,
  // Git — read ops
  /^\s*git\s+(status|log|diff|show|branch|remote|stash\s+list|config\s+--get|config\s+user|rev-parse|describe|blame|shortlog|ls-files|ls-tree|reflog|tag\s*$|tag\s+-l|tag\s+--list|cat-file|worktree\s+list)\b/i,
  // Git — write ops (force-push/publish already denied above; reset --hard <ref> denied above)
  /^\s*git\s+(add|commit|pull|fetch|merge|rebase|checkout(?!\s+--\s+\.)|switch|restore|cherry-pick|revert|mv|rm|tag\s+-a|tag\s+[^\-]|worktree\s+(add|remove|prune))\b/i,
  /^\s*git\s+push\b(?![^\n]*(--force|-f(\s|$)))/i,
  /^\s*git\s+reset\b(?![^\n]*--hard)/i,
  // Node / package managers (global installs already denied above)
  /^\s*node\s+/i,
  /^\s*node\s+--test\b/i,
  /^\s*pnpm\b/i,
  /^\s*npm\b/i,
  /^\s*npx\s+/i,
  /^\s*yarn\b/i,
  /^\s*corepack\b/i,
  // TypeScript / test / lint tooling
  /^\s*tsc\b/i,
  /^\s*vitest\b/i,
  /^\s*eslint\b/i,
  /^\s*prettier\b/i,
  /^\s*playwright\b/i,
  // Network fetch (curl|sh already denied above)
  /^\s*curl\s+/i,
  /^\s*wget\s+(?![^\n]*\|)/i,
  // Process / env inspection
  /^\s*ps\b/i,
  /^\s*env\s*$/i,
  /^\s*printenv\b/i,
  /^\s*whoami\s*$/i,
  /^\s*date\b/i,
  /^\s*uname\b/i,
  // Timing / no-op
  /^\s*sleep\s+\d+/i,
  /^\s*timeout\s+/i,
  /^\s*true\s*$/i,
  /^\s*:\s*$/i,
  // Shell-construct keywords (compound commands begin with these)
  /^\s*(for|while|do|done|if|then|else|fi|case|esac|elif)\b/i,
  // PowerShell read-only cmdlets (env is win32; Bash tool also available)
  /^\s*Get-(ChildItem|Content|Location|Command|Item|Process|Date)\b/i,
  /^\s*Test-Path\b/i,
  /^\s*Select-(String|Object)\b/i,
  /^\s*Where-Object\b/i,
  /^\s*Measure-Object\b/i,
  // Misc tooling
  /^\s*uvx\s+/i,
  /^\s*code\s+/i,
];

/** Decide allow/deny for a single command string. */
function evaluate(cmd) {
  if (!cmd || !cmd.trim()) {
    // No command to inspect — nothing to run, allow the empty no-op.
    return allow();
  }

  // 1) DENY_RULES first.
  for (const rule of DENY_RULES) {
    try {
      if (rule.test(cmd)) {
        return deny(rule.msg);
      }
    } catch (_e) {
      // A rule blew up: fail CLOSED on this rule (skip it), keep evaluating.
    }
  }

  // 2) SAFE_COMMANDS allow-list. We split on shell separators so a compound
  //    command (a && b ; c) is only auto-approved if EVERY segment is safe.
  const segments = cmd
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);

  const everySegmentSafe =
    segments.length > 0 &&
    segments.every((seg) => SAFE_COMMANDS.some((re) => re.test(seg)));

  if (everySegmentSafe) {
    return allow();
  }

  // 3) DEFAULT-DENY (hardened vs TaxIA's fail-open).
  return deny(
    'Comando no reconocido por la allow-list del proyecto. ' +
      'Si es seguro, añade su patron a SAFE_COMMANDS en .claude/hooks/bash-gate.js, ' +
      'o pide aprobacion explicita. Comando: ' +
      cmd.slice(0, 200)
  );
}

function main() {
  let raw = '';
  try {
    raw = readStdin();
  } catch (_e) {
    // Cannot even read stdin — fail CLOSED.
    return deny('No se pudo leer el evento del hook (stdin). Denegado por seguridad.');
  }

  let cmd = '';
  try {
    const data = raw ? JSON.parse(raw) : {};
    // Claude Code PreToolUse shape: { tool_name, tool_input: { command } }.
    // Be tolerant of older / nested shapes too.
    cmd =
      (data.tool_input && data.tool_input.command) ||
      (data.input && data.input.command) ||
      (data.params && data.params.command) ||
      data.command ||
      '';
  } catch (_e) {
    // Parse error — fail CLOSED (this is the key hardening vs TaxIA).
    return deny('No se pudo parsear el evento del hook (JSON invalido). Denegado por seguridad.');
  }

  return evaluate(String(cmd));
}

main();
