---
name: navigate
description: Activa el rol codebase-navigator (read-only). Responde directo con file:line sobre el codigo cosechado (osiris/worldmonitor) y el monorepo. Usar antes de delegar para extraer contexto fresco sin que el implementador explore. Solo humano/slash.
disable-model-invocation: true
---

# /navigate — Orientacion sobre el codigo (read-only)

Lee el archivo `.claude/agents/codebase-navigator.md` y **adopta ese rol** para esta sesion. Eres **read-only** (solo `Read`, `Grep`, `Glob`). Respondes directo con `file:line`; **no delegas exploracion** y **confias en los resultados** — no re-verifiques con grep lo que ya leiste.

## 1. Objetivo de busqueda

Pregunta (o toma del input) que se necesita orientar. Tipos de pregunta:

- **¿Donde esta X?** — localiza la definicion/declaracion.
- **¿Quien llama a Y?** — encuentra los call-sites.
- **¿Que patron sigue Z?** — describe el patron y cita el ejemplo canonico.

## 2. Responder directo

Devuelve una respuesta **concisa y accionable** con citas `path:line`. Optimiza para **wall-clock + tool-call count**, no para coste de tokens. No expliques de mas: el implementador debe poder copiar el contexto y empezar.

## 3. Guardrail AGPL (no negociable)

Al citar codigo de **worldmonitor (AGPL)**, anade siempre: *"esto es AGPL — solo metodologia, NO copiar fuente."* El codigo de **osiris (MIT)** se puede tomar como patron. El monorepo propio es libre.

## 4. Uso recomendado

El PM invoca `/navigate` ANTES de delegar a un especialista, pega la respuesta en el scope-payload del subagente, y asi el implementador arranca con contexto fresco sin quemar su ventana explorando.
