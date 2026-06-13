---
name: env-not-readable
description: Los ficheros .env / .env.* no son legibles por los agentes (bloqueados por hooks); validar contra SECRETS.md
metadata:
  type: reference
---

`.env` y `.env.example` estan bloqueados para los agentes en dos capas: `settings.json permissions.deny` (Read/Write) y `bash-gate.js` DENY_RULES (Bash cat/echo/redireccion). Un intento de leerlos devuelve "BLOCKED" o "Permission denied".

**How to apply:** Cuando un plan dependa del contrato de variables de entorno (p.ej. tarea de bootstrap que deriva `.env` de `.env.example`), no intentes leer el fichero: valida el set de nombres contra `.claude/SECRETS.md` (ver [[env-vars-canonical]]) y exige que la propia tarea confirme el set exacto en su acceptance (es el GAP-2 del design-doc del MVP Finanzas). No marques como issue que el agente no pueda leer `.env.example` — es por diseno.
