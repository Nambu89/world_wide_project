#!/usr/bin/env node
/**
 * block-read-gate.js — PreToolUse hook (Node, no external deps).
 *
 * From codegraph's block-read-hook (permissionDecision:deny pattern), adapted
 * to Node + Windows. DEFENSE-IN-DEPTH for the READ-ONLY quality gates.
 *
 * The read-only gate agents (plan-checker, verifier, codebase-navigator) are
 * ALREADY restricted by omitting Write/Edit/MultiEdit from their `tools:`
 * frontmatter. This hook reinforces that boundary STRUCTURALLY: if the active
 * session is one of those gates, any mutating tool call (Write/Edit/MultiEdit,
 * or a mutating Bash command) is DENIED with a steering reason.
 *
 * How it identifies the active gate (best-effort, several signals):
 *   - env WWP_ACTIVE_AGENT / CLAUDE_AGENT_NAME / CLAUDE_SUBAGENT (if set)
 *   - the event's agent / subagent_type / agent_name field (if present)
 * If NONE of these indicate a read-only gate, the hook ALLOWS (exit 0) so it
 * never interferes with normal implementer sessions.
 *
 * Output contract: it emits the codegraph-style JSON
 *   { hookSpecificOutput: { hookEventName: "PreToolUse",
 *       permissionDecision: "deny", permissionDecisionReason: <msg> } }
 * AND exits 2 (belt-and-suspenders: both the JSON decision and the exit code
 * signal a deny to Claude Code).
 */

'use strict';

const fs = require('fs');

const READ_ONLY_GATES = ['plan-checker', 'verifier', 'codebase-navigator'];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

function activeAgentName(event) {
  const candidates = [
    process.env.WWP_ACTIVE_AGENT,
    process.env.CLAUDE_AGENT_NAME,
    process.env.CLAUDE_SUBAGENT,
    process.env.CLAUDE_AGENT,
    event && event.agent_name,
    event && event.agent,
    event && event.subagent_type,
    event && event.subagentType,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim().toLowerCase();
    }
  }
  return '';
}

function isMutatingBash(cmd) {
  if (!cmd) return false;
  const c = String(cmd);
  return (
    /(^|[\s;&|])(>{1,2}|tee\b)/.test(c) || // redirection / tee = write
    /\b(rm|mv|cp|mkdir|touch|chmod|ln|Set-Content|Out-File|Remove-Item|New-Item)\b/i.test(c) ||
    /\bgit\s+(add|commit|push|merge|rebase|reset|checkout|restore|tag|cherry-pick|revert|apply|stash)\b/i.test(c) ||
    /\b(npm|pnpm|yarn)\s+(i|install|add|remove|run\s+build)\b/i.test(c) ||
    /\bnpx\b/i.test(c)
  );
}

function deny(msg) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: msg,
    },
  };
  try {
    process.stdout.write(JSON.stringify(out));
  } catch (_e) {
    /* ignore */
  }
  process.stderr.write('BLOCKED: ' + msg + '\n');
  process.exit(2);
}

function main() {
  let event = {};
  try {
    const raw = readStdin();
    event = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    // Can't parse — do NOT interfere with normal sessions; allow.
    process.exit(0);
  }

  const agent = activeAgentName(event);
  if (!READ_ONLY_GATES.includes(agent)) {
    // Not a read-only gate session — this hook does nothing.
    process.exit(0);
  }

  const toolName = event.tool_name || (event.tool && event.tool.name) || '';
  const input = event.tool_input || event.input || {};

  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(toolName)) {
    return deny(
      `El agente activo '${agent}' es una PUERTA DE CALIDAD READ-ONLY: no puede modificar ficheros. ` +
        `Su trabajo es LEER, ANALIZAR y REPORTAR (PASS/ISSUES_FOUND/VERIFIED/INCOMPLETE). ` +
        `Si hay que corregir codigo, reporta el issue al PM para que delegue a un implementador.`
    );
  }

  if (toolName === 'Bash') {
    const cmd = input.command || '';
    if (isMutatingBash(cmd)) {
      return deny(
        `El agente activo '${agent}' es READ-ONLY: comandos Bash que mutan el repositorio (escritura, ` +
          `git add/commit/push, instalar deps, builds) estan prohibidos. Usa solo lectura/inspeccion ` +
          `(ls, cat, grep, git status/diff/log, tsc --noEmit, node --test) para verificar.`
      );
    }
  }

  // Allowed read-only operation for a gate — let it through.
  process.exit(0);
}

main();
