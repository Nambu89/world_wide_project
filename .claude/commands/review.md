---
name: review
description: Two-stage review sobre el git diff BASE..HEAD. Stage 1 spec-compliance (lee el codigo REAL, no el reporte del implementador), Stage 2 code-quality. Findings con severidad+file:line+fix. Veredicto Ready-to-merge. Solo humano/slash.
disable-model-invocation: true
---

# /review — Revision en dos etapas (sobre el diff real)

Revision de codigo en **dos etapas, en orden estricto**, sobre el `git diff BASE..HEAD`. Referencia las skills globales `superpowers:requesting-code-review` y `superpowers:receiving-code-review`.

**Regla de oro**: lee el codigo REAL del diff, NUNCA el reporte del implementador. *"Don't give feedback on code you didn't actually read."*

## 1. Obtener el diff real

```bash
git log --oneline -10
git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~1
git diff main...HEAD 2>/dev/null || git diff HEAD~1
```

Identifica `BASE_SHA` y `HEAD_SHA` y revisa el diff completo.

## 2. Stage 1 — Spec compliance (PRIMERO)

¿Se construyo EXACTAMENTE lo pedido, ni mas ni menos? Verifica contra el plan/requisitos:

- Signatures, nombres de fichero, imports correctos.
- Sin stubs ni placeholders, sin scope expandido fuera de lo pedido.
- Decisiones bloqueadas D-NN respetadas.

Si Stage 1 falla, **DETENTE** y reporta `Issues found: file:line` — la calidad sobre codigo spec-incorrecto es esfuerzo perdido.

## 3. Stage 2 — Code quality (solo si Stage 1 pasa)

- Convenciones, naming, error handling (Result/Zod en el borde), tipos estrictos.
- Sin `console.log`/debug residual, sin TODO sin resolver, sin imports/vars sin usar.
- Seguridad: timeouts en fetch, rate-limit, SSRF-guard, no secretos hardcodeados.
- Wiring: conector en `server.ts`, capa en config-array, job en scheduler, panel importado.
- Caza anti-patrones: `grep -rn "console.log\|TODO\|FIXME"` sobre los ficheros del diff.

## 4. Findings + veredicto

Cada finding lleva: **severidad** (Critical/Important/Minor) + `file:line` + **fix concreto**. Reconoce primero los puntos fuertes. Termina con:

```
### Assessment
**Ready to merge?** [Yes | No | With fixes]
**Reasoning:** [1-2 frases tecnicas]
```

Si esta limpio, sugiere `/commit`.
