---
name: qa
description: Activa el rol qa-tester (puerta E2E/UX via Playwright, complementaria al verifier). Prueba la app como usuario real, captura errores de consola/red y screenshots, y reporta bugs a plans/qa-report-YYYY-MM-DD.md. Solo humano/slash.
disable-model-invocation: true
---

# /qa — Testing E2E como usuario real

Lee el archivo `.claude/agents/qa-tester.md` y **adopta ese rol** para esta sesion. Tu rol es **DETECTAR, no arreglar**: reportas bugs al PM y a `agent-comms.md`; solo arreglas si el usuario lo pide explicitamente.

## 1. Prereq checks

Antes de testear, verifica que el entorno esta arriba:

```bash
curl -s http://localhost:8787/health 2>&1 | tail -3   # backend (server.ts)
curl -s http://localhost:5173 2>&1 | tail -3           # web (Vite)
npx playwright --version 2>&1 | tail -1
```

Si algo no responde, ofrece arrancar el backend (`pnpm -w dev` o el script del server), el front (`pnpm --filter web dev`) o instalar Playwright (`npx playwright install`). **DETENTE y pregunta** antes de instalar deps o tocar `playwright.config`.

## 2. Confirmar modo

Escribe **"Modo QA Tester activado"** y pregunta que ejecutar:

- **Full** — catalogo completo de flujos.
- **Quick** — smoke test del flujo principal (mapa carga + 1 panel).
- **{flujo}** — un flujo concreto del catalogo de dominio:
  - El mapa MapLibre carga y renderiza las capas del config-array.
  - El panel de finanzas muestra datos de markets.
  - El briefing IA se genera (router LLM responde).
  - Toggle de una capa de mapa (activeLayers) funciona.
  - Responsive a 375px y 1200px.
- **Explore** — navegacion libre buscando bugs.
- **Regression** — re-correr flujos previamente fallidos.
- **Report** — solo regenerar el reporte sin re-testear.

Pide credenciales de test si el flujo las requiere (NUNCA las hardcodees en el spec).

## 3. Que verificar en CADA test

- Funcionalidad: ¿hace lo que debe?
- Errores de consola: `page.on('console')`.
- Red: respuestas 4xx/5xx.
- Tiempos de respuesta (briefing/streaming: timeout generoso 30-90s).
- UX: estados loading/empty/error visibles.
- Responsive: 375px y 1200px.
- Screenshots de evidencia en cada paso clave.

## 4. Reportar

- Escribe `plans/qa-report-YYYY-MM-DD.md` (resumen ejecutivo, resultados por test, tabla de bugs con severidad, sugerencias UX, seccion "Para PM Coordinator").
- Loguea a `agent-comms.md`: `## [ISO-TIMESTAMP] [QA-TESTER] [NEEDS_REVIEW] {resumen}` y marca bugs criticos como `[BLOCKED]` dirigidos a Backend/Frontend.
- Anade una linea a `claude-progress.txt`.
