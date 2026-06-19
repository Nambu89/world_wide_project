# Check-Plan — UI Redesign Slice 2 (globo 3D)
## Fecha: 2026-06-19
## Veredicto del plan-checker: ISSUES_FOUND (2 ISSUE, 4 WARNING) → **AMBOS ISSUE RESUELTOS en el plan → PASS**

> El agente `plan-checker` es read-only (sin Write) y no pudo persistir su veredicto; lo consolida el PM con la resolución aplicada.

## Dimensiones
- **D1 Cobertura**: G1-G5 cubiertos; G5 era PARCIAL por ISSUE-1 (ya resuelto).
- **D4 Scope**: frontend-only confirmado, NG-1 respetado (sin backend/store/motor). Sin erosión; los `as unknown as` son castes legítimos, no stubs.
- **Decisiones**: D-1100→T1, D-1101→T2, D-1102→T3, D-1103→T4, D-1105→T5. D-1104 (estrellas) + D-1009 (ping) correctamente DIFERIDAS.

## Issues (ambos RESUELTOS)

**ISSUE-1 — back-face cull en el E2E (D-1105/R-1).** `slice-d-e2e.mjs:38-48` (`pickFeaturePixel`) filtra solo por bounding-box de pantalla; en globo, `project()` da píxel también para la cara OCULTA de la esfera → click flaky/falso verde. **RESUELTO**: Task 5 step 2a añade un back-face cull por round-trip `unproject` (descarta features cuyo `unproject(project(coords))` difiera >1° de las coords), aplicado a `slice-d-e2e.mjs` y al `evaluate` de `redesign-e2e.mjs`. No-op en mapa plano (retrocompatible). Se corre ANTES de afirmar PASS.

**ISSUE-2 — orden del rAF vs `style.load` (D-1103).** El rAF arrancaba en el cuerpo del effect, pero `setProjection` es async (`style.load`) → giraría el mapa plano pre-globo. **RESUELTO**: Task 4 reestructurado — `rafId`/`resumeTimer` se declaran en el scope del effect; el `requestAnimationFrame(spin)` + los listeners de gesto arrancan DENTRO del `style.load` handler (tras `setProjection`/`setSky`); el cleanup cancela rAF+timer.

## Warnings (no bloqueantes)
- L-6 incumplible por el plan-checker (read-only) → persistido aquí por el PM.
- `files_modified` en prosa, no bloque estructurado — aceptable (slice secuencial, casi single-file MapView).
- Upgrade major v4→v5 = riesgo concentrado, bien aislado (T1) + mitigado (tsc+build+E2E); `pnpm-lock.yaml` se commitea (T1 step 6).
- E2E de cierre >60s (levantan servers) — son gates de cierre, no verify-por-tarea; aceptable.

## Veredicto final
**PASS** (tras resolver ISSUE-1 + ISSUE-2 en el plan). Listo para implementar.
