---
name: project-core-ai-t38
description: T-38 @www/core-ai bloque sanciones OFAC en briefing DONE. 56/56 tests verdes.
metadata:
  type: project
---

T-38 @www/core-ai bloque sanciones OFAC en briefing — DONE.

**Why:** Approach B: espejo exacto de buildConvergenceContext. Sin proveedor LLM nuevo, sin 2ª llamada.

**How to apply:** buildSanctionsContext(latest: SanctionRow[]): top-10 por sanctionedCount desc, '' si vacío. serializeContext gana 5º arg sanctions: SanctionRow[]=[] (D-311, callers previos intactos). generateDailyBriefing lee getLatestSanctions(). Re-exportada en index.ts.

Verificación: 56/56 tests (node --test), tsc --noEmit limpio.
