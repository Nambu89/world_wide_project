#!/usr/bin/env node
/**
 * spec-validator.js — PostToolUse hook (Node, no external deps).
 *
 * From design.md / awesome-design-md. After an Edit/Write to a design doc
 * (docs/design/*.md) or a plan (plans/*.md), it validates the artifact schema:
 *   - front-matter present (--- ... --- block at top)
 *   - mandatory sections present AND in the prescribed order
 *   - Non-Goals section has >= 1 item
 *   - no dangling {token.reference} (a referenced token must be defined somewhere)
 *   - ADR ids (ADR-NNN) and decision ids (D-NN) are UNIQUE within the file
 *     (this prevents the TaxIA "ADR-007 duplicated" bug)
 *
 * MODE: WARN initially (exit 0 always; warnings via additionalContext + stderr).
 * To flip to BLOCKING when the methodology matures, change the two
 * `process.exit(0)` after a violation to `process.exit(2)`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Section schemas per artifact type (ordered, lowercased for matching).
const DESIGN_SECTIONS = [
  'overview',
  'goals',
  'non-goals',
  'decisions',
  'interfaces',
  'risks',
  'known gaps',
];
const PLAN_SECTIONS = ['goal', 'tasks', 'risks'];

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

function relPath(root, p) {
  if (!p) return '';
  let r = p;
  try {
    if (path.isAbsolute(p)) r = path.relative(root, p);
  } catch (_e) {
    r = p;
  }
  return r.replace(/\\/g, '/');
}

function warn(msg) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: msg,
    },
  };
  try {
    process.stdout.write(JSON.stringify(out));
  } catch (_e) {
    /* ignore */
  }
  process.stderr.write(msg + '\n');
  process.exit(0); // WARN mode. Flip to process.exit(2) to enforce.
}

/** Extract H2 headings ("## Title") in document order, lowercased. */
function extractHeadings(body) {
  const lines = body.split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) out.push(m[1].toLowerCase().trim());
  }
  return out;
}

/** Check required sections present and in order. Returns array of problems. */
function checkSections(headings, required) {
  const problems = [];
  const present = required.filter((r) => headings.some((h) => h.startsWith(r)));
  const missing = required.filter((r) => !headings.some((h) => h.startsWith(r)));
  if (missing.length) {
    problems.push('Faltan secciones obligatorias: ' + missing.join(', '));
  }
  // Order check among the present required sections.
  const orderInDoc = headings
    .map((h) => required.find((r) => h.startsWith(r)))
    .filter(Boolean);
  const dedupOrder = [];
  for (const o of orderInDoc) if (!dedupOrder.includes(o)) dedupOrder.push(o);
  const expectedOrder = required.filter((r) => present.includes(r));
  if (JSON.stringify(dedupOrder) !== JSON.stringify(expectedOrder)) {
    problems.push(
      'Secciones fuera de orden. Esperado: [' +
        expectedOrder.join(' -> ') +
        ']; encontrado: [' +
        dedupOrder.join(' -> ') +
        ']'
    );
  }
  return problems;
}

/** Count non-empty list items under a "## Non-Goals" heading. */
function countNonGoals(body) {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  let count = 0;
  for (const l of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      inSection = /^non-goals/i.test(h[1].trim());
      continue;
    }
    if (inSection && /^\s*([-*]|\d+\.)\s+\S/.test(l)) count++;
  }
  return count;
}

/** Find dangling {namespace.key} token references not defined anywhere. */
function checkTokens(body) {
  const refRe = /\{([a-zA-Z][\w.-]*\.[\w.-]+)\}/g;
  const refs = new Set();
  let m;
  while ((m = refRe.exec(body)) !== null) refs.add(m[1]);
  if (refs.size === 0) return [];
  // A token is "defined" if it appears as `key: value` / `- key:` / a code-fence
  // assignment, or the leaf key appears as a definition line. Heuristic: the leaf
  // segment shows up at the start of a line followed by ':' somewhere in the doc.
  const problems = [];
  for (const ref of refs) {
    const leaf = ref.split('.').pop();
    const defRe = new RegExp('(^|\\n)\\s*[-*]?\\s*`?' + leaf + '`?\\s*[:=]', 'm');
    if (!defRe.test(body)) {
      problems.push('Token sin definir: {' + ref + '} (define ' + leaf + ': <valor> en algun bloque)');
    }
  }
  return problems;
}

/** ADR-NNN and D-NN ids must be unique within the file. */
function checkUniqueIds(body) {
  const problems = [];
  for (const [label, re] of [
    ['ADR', /\bADR-(\d{1,3})\b/g],
    ['D', /\bD-(\d{1,3})(?:-\d{1,3})?\b/g],
  ]) {
    const seen = new Map();
    let m;
    while ((m = re.exec(body)) !== null) {
      const id = m[0];
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    if (dups.length) {
      problems.push('IDs ' + label + ' duplicados: ' + dups.join(', ') + ' (cada id debe ser unico)');
    }
  }
  return problems;
}

function main() {
  let event = {};
  try {
    const raw = readStdin();
    event = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    process.exit(0);
  }

  const toolName = event.tool_name || (event.tool && event.tool.name) || '';
  if (!/^(Write|Edit|MultiEdit)$/.test(toolName)) {
    process.exit(0);
  }

  const input = event.tool_input || event.input || {};
  const editedPath = input.file_path || input.path || '';
  const root = projectRoot();
  const rel = relPath(root, editedPath);

  const isDesign = /^docs\/design\/.+\.md$/i.test(rel);
  const isPlan = /^plans\/.+\.md$/i.test(rel) && !/DECISIONS\.md$|ROADMAP\.md$|qa-report/i.test(rel);
  if (!isDesign && !isPlan) {
    process.exit(0);
  }

  let content = '';
  try {
    content = fs.readFileSync(editedPath, 'utf8');
  } catch (_e) {
    process.exit(0); // can't read — nothing to validate
  }

  const problems = [];

  // Front-matter present?
  const fmMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(content);
  if (!fmMatch) {
    problems.push('Falta el front-matter (bloque --- ... --- al inicio con version/name/description).');
  } else {
    const fm = fmMatch[1];
    for (const key of ['name', 'description']) {
      if (!new RegExp('^' + key + '\\s*:', 'mi').test(fm)) {
        problems.push('Front-matter sin clave obligatoria: ' + key);
      }
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const headings = extractHeadings(body);
  const required = isDesign ? DESIGN_SECTIONS : PLAN_SECTIONS;

  problems.push(...checkSections(headings, required));

  if (isDesign) {
    if (countNonGoals(body) < 1) {
      problems.push('La seccion "Non-Goals" debe tener al menos 1 item (anti scope-creep).');
    }
    problems.push(...checkTokens(body));
  }

  problems.push(...checkUniqueIds(body));

  if (problems.length) {
    return warn(
      '[spec-validator] ' + rel + ' no cumple el schema (modo WARN):\n - ' + problems.join('\n - ')
    );
  }

  process.exit(0);
}

main();
