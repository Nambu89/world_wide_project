---
version: alpha
name: plan-ponytail-integration
description: Integrar ponytail (plugin Claude Code MIT, "lazy senior dev" — escalera YAGNI always-on para escribir menos código) en el entorno multiagente. Enfoque HÍBRIDO (aprobado): plugin global (sesión principal + comandos /ponytail-*) + cableado en la gobernanza (AGENT-CONTRACTS + defs de agentes coders + scope-payload) para que llegue a los subagentes que ESCRIBEN código. Meta-tarea de dev-system, no código de producto. Pendiente de /check-plan.
status: draft
date: 2026-06-16
owner: pm-coordinator
---

# Plan — Integración de ponytail (entorno multiagente)

- **Fecha:** 2026-06-16 · **Autor:** PM
- **Diseño aprobado por el usuario** (este doc es el spec+plan combinado; tarea pequeña de dev-system).
- **Enfoque ratificado:** A (híbrido) + global (como caveman) + modo por defecto `full`.

## Goal

Que el entorno multiagente **escriba menos código** (archivos más sencillos): adoptar la escalera YAGNI de ponytail (¿existir?→stdlib→nativo→dep-instalada→una-línea→mínimo) (1) en la sesión principal vía el plugin, y (2) — el valor real — en los **subagentes que producen código**, vía la gobernanza del scaffold (los subagentes son fresh-context: no heredan el hook SessionStart del plugin; se rigen por AGENT-CONTRACTS + scope-payload + su def). License-clean: ponytail es **MIT** (copiar/referenciar libre).

## Hallazgo que motiva el enfoque (verificado)

- El plugin inyecta vía hooks `SessionStart`/`UserPromptSubmit` en la **sesión principal** (`~/.claude/plugins/.../hooks/hooks.json`). Los **subagentes NO re-corren SessionStart** → un plugin solo NO llega a backend-architect/frontend-dev/etc.
- `AGENT-CONTRACTS.md` **YA está en `scope-payload.contexts.shared`** (AGENT-CONTRACTS §3, línea 56) → añadir la escalera ahí PROPAGA a todo subagente que lea el shared. Reforzado con 1 línea en cada def de agente coder (system-prompt, siempre presente).

## Tasks (todas PM — gobernanza del dev-system, no delegable)

### T-A — Plugin global en `~/.claude/settings.json` (espejo de caveman)
- `extraKnownMarketplaces.ponytail = { "repo": "DietrichGebert/ponytail" }`
- `enabledPlugins["ponytail@ponytail"] = true`
- Edit vía skill `update-config` (settings.json). Descarga del cache: el **usuario** corre `/plugin marketplace add DietrichGebert/ponytail` + `/plugin install ponytail@ponytail` (interactivo) **o** reinicia CC tras el edit.
- Resultado: hooks always-on (minimalismo sesión principal/PM cuando codea) + comandos `/ponytail-{review,audit,debt,help}` + skill ponytail. Modo `full` por defecto (no `ultra`). Coexiste con caveman (prosa) — sin conflicto (ponytail: "pair with Caveman").
- **Verify:** `settings.json` es JSON válido + las 2 claves presentes. Tras el install del usuario: `/ponytail-help` responde.

### T-B — `AGENT-CONTRACTS.md` §9 nueva: escalera ponytail (constraint permanente)
- Sección nueva (estilo §8 frases-de-erosión): **todo agente que PRODUCE código** sigue la escalera ponytail. Texto re-derivado/citado del SKILL MIT: ladder (6 peldaños, parar en el 1º que aguanta) + reglas (sin abstracciones no pedidas, deleción>adición, menos ficheros, diff más corto, marcar simplificaciones con `// ponytail:` nombrando techo+upgrade-path) + **cuándo NO ser lazy** (validación en trust-boundaries, error-handling anti-pérdida-datos, seguridad, accesibilidad, lo explícitamente pedido, calibración de hardware) + "código lazy sin su check está incompleto: lógica no-trivial deja UN check ejecutable".
- Atribución: "metodología ponytail (MIT, DietrichGebert/ponytail), citada/condensada".
- **Verify:** grep encuentra la §9 + "ponytail" + "YAGNI" + "cuándo NO".

### T-C — Defs de los 5 agentes coders: 1 línea de referencia
- `.claude/agents/{backend-architect,frontend-dev,data-connector-dev,intel-analyst,python-pro}.md` — añadir 1 línea: "Sigues la **escalera ponytail** (AGENT-CONTRACTS §9): YAGNI→stdlib→nativo→dep-instalada→una-línea→mínimo; marca simplificaciones con `// ponytail:`. NO simplificar seguridad/validación/error-handling/lo pedido."
- **NO** tocar los read-only (plan-checker/verifier) ni los de diseño/orquestación (system-architect/pm-coordinator/codebase-navigator/qa-tester) — no producen código de producto.
- **Verify:** grep "ponytail" en los 5 ficheros; ausente en los 6 no-coders.

### T-D — Plantilla scope-payload (AGENT-CONTRACTS §3): constraint por defecto
- En el `constraints:` de ejemplo del scope-payload YAML, añadir: `- "Escalera ponytail (§9): la solución más simple que funciona; marca atajos con // ponytail:"`.
- **Verify:** grep "ponytail" en el bloque §3.

## Verificación final
1. `settings.json` JSON válido (`node -e "JSON.parse(...)"`); claves de plugin presentes.
2. AGENT-CONTRACTS §9 + las 5 defs + §3 contienen la referencia (grep); los 6 no-coders NO.
3. **Sanity dispatch** (1 subagente coder trivial) → confirma que recibe/aplica la escalera (o, si el usuario no quiere gastar un dispatch, basta el wiring verificado por grep).
4. **El usuario** confirma el plugin tras `/plugin install` (`/ponytail-help` responde). Hasta entonces, la parte plugin queda "instalada-pendiente-de-reload".

## Non-Goals
- NO re-implementar la skill de ponytail (se usa la del plugin + se cita en AGENT-CONTRACTS) — re-escribirla sería anti-ponytail (rung-4: usa lo ya instalado).
- NO modificar simplify/karpathy-guidelines/caveman/code-review (ponytail compone, no choca: ponytail=qué construyes, caveman=cómo hablas, simplify/review=post-hoc).
- NO tocar agentes read-only/diseño/orquestación.
- NO cambiar el flujo RPI ni los gates existentes.

## Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| El edit de settings no descarga el cache del plugin | El usuario corre `/plugin install` (interactivo) o reinicia CC; documentado en T-A |
| Hooks de terceros (ponytail Node) en cada sesión | Aceptado por el usuario (MIT, público, benchmarks); espejo de caveman ya aceptado |
| 2 plugins con hooks SessionStart/UserPromptSubmit (caveman+ponytail) chocan | No: distinto concern (prosa vs código); ponytail diseñado para componer con caveman |
| La escalera afecta a agentes que no deben (read-only) | T-C explícitamente solo los 5 coders; verify niega en los 6 no-coders |
| Subagente no lee el `shared` del scope-payload | Doble cobertura: AGENT-CONTRACTS (shared) + 1 línea en la def (system-prompt siempre presente) |
