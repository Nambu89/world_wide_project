---
name: env-vars-canonical
description: Set canonico de variables de entorno del proyecto (documentado en .claude/SECRETS.md)
metadata:
  type: reference
---

`.claude/SECRETS.md §Variables requeridas` lista el set canonico de nombres (no valores): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `OLLAMA_BASE_URL`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `PORT`, `ALLOWED_ORIGINS`, `VITE_API_BASE_URL`, `VITE_MAP_STYLE_URL`, + claves opcionales por conector (zero-key-first).

**Matiz importante:** SECRETS.md incluye `TURSO_*` (remoto), pero el MVP Finanzas usa libSQL local `file:./data/world.db` (ADR-006/D-005). No es contradiccion: migrar a Turso = cambiar la URL; SECRETS.md documenta el set completo del proyecto, el MVP usa un subconjunto. La unica key de datos del MVP es `ANTHROPIC_API_KEY` (D-007: conectores keyless).

**How to apply:** Si un plan declara un `.env` con menos variables que esta lista, no es un issue mientras cubra lo que sus tareas necesitan (ANTHROPIC_API_KEY + url libSQL en el MVP). Ver [[env-not-readable]] para por que no se puede leer el fichero directamente.
