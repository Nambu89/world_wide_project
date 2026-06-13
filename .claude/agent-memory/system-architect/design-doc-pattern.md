---
name: design-doc-pattern
description: Convenciones concretas del formato design-doc que sigue este proyecto, más allá del schema de la skill (numeración de Decisions, tokens, secuencia de implementación).
metadata:
  type: project
---

Patrón de design-doc consolidado en este repo (visto en `docs/design/2026-06-13-mvp-finanzas.md`, validado por `spec-validator.js`).

**Why:** mantener consistencia entre docs para que `plan-checker` y el PM no tengan que reaprender el formato cada vez.

**How to apply:** al escribir un design-doc nuevo, replica estas convenciones:
- Front-matter: `version|name|description|status|date|owner`. `description` = un párrafo denso (no una línea), captura la esencia completa.
- Secciones EN ORDEN: Overview, Token-references (bloque canónico justo tras Overview), Goals, Non-Goals (>=1), Context/Constraints, Decisions, Interfaces/Data Contracts, Do's and Don'ts, Risks, Iteration Guide, Known Gaps/Open Questions. Cierra con `## PLANNING COMPLETE`.
- Numeración Decisions: **bloqueadas** (heredan de ADR/feedback) usan `D-0NN` y citan el ADR fuente; **internas del arquitecto** (PM ratifica) usan `D-1NN`. IDs únicos, cada D-NNN aparece una sola vez; el resto del doc refiere por contenido/token, NO re-cita el número (evita falsos duplicados en el validador).
- Tokens `{namespace.leaf}` definidos todos en el bloque canónico; variantes de estado tipo `{token}-stale`. Cada referencia debe resolver.
- Iteration Guide incluye: grafo de dependencias entre paquetes + secuencia de implementación numerada + diagrama ASCII de flujo de datos. Es el input del plan del PM (el PM escribe el plan, no el arquitecto).
- Known Gaps separa "fuera de scope con razón" (GAP-N) de "open questions a ratificar por el PM" (OQ-N).
- PROHIBIDAS frases de erosión de scope: `v1`, `placeholder`, `se cablea después`, `implementación básica`, `mejora futura`.
- ADRs base no-negociables: ADR-001 (worldmonitor metodología + osiris código), ADR-002 (re-implementar, NUNCA copiar fuente AGPL), ADR-003 (stack), ADR-004 (scheduler+histórico Turso), ADR-005/009 (proveedor IA activo = openai), ADR-006 (libSQL file://), ADR-008 (UI responsive mobile-first). Ver [[data-reality-fase1]].
