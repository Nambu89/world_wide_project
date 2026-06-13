# SECRETS & .env — Convencion (world_wide_project)

> Este documento arregla la fuga de TaxIA: en TaxIA, client IDs / client
> secrets / un password en texto plano y un email PII acabaron **dentro de
> strings `Bash(...)` de la allow-list** de `settings.local.json`. Aqui eso
> esta estructuralmente prohibido.

## Reglas (no negociables)

1. **NUNCA committees un secreto.** Ni en `.env`, ni en `settings.json`, ni en
   `settings.local.json`, ni en una string de comando de la allow-list, ni en
   codigo, ni en un comentario, ni en un test.
2. **Los secretos viven en variables de entorno.** En local: en `.env` (que esta
   gitignored). En produccion: en el entorno del hosting (Railway/Fly/Render/...),
   NUNCA en un fichero del repo.
3. **`.env.example` documenta los NOMBRES**, nunca los valores. Valores vacios o
   placeholders inocuos (`http://localhost:11434`). Ver la raiz del repo.
4. **Nada de PII en el repo.** Sin emails personales, sin nombres, sin tokens.

## Capas de defensa (ya activas)

| Capa | Donde | Que impide |
|------|-------|------------|
| `.gitignore` | raiz | `git add` de `.env`, `.env.*`, `*.pem`, `*.key`, `**/secrets/`, `*credentials*.json`, `settings.local.json`. |
| `settings.json` `permissions.deny` | `.claude/settings.json` | `Read`/`Write` de `.env` / `.env.*` (incl. anidados). |
| `bash-gate.js` DENY_RULES | `.claude/hooks/` | escritura a `.env`/ficheros de secretos via redireccion/`tee`/`echo`/`Set-Content`/`Out-File`. |

## Que va en `settings.local.json` (gitignored)

Solo **permisos de maquina**: allow-list por host de `WebFetch`, servidores MCP
habilitados (ej. playwright), y comandos `Bash(...)` concretos **que no contengan
secretos**. Si un comando necesita un secreto, ese secreto se pasa por variable
de entorno (`$env:GROQ_API_KEY`), NUNCA literal en la string del permiso.

## Variables requeridas

Ver `../.env.example` (en la raiz del repo) para la lista completa con comentarios:
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `OLLAMA_BASE_URL`, `GROQ_API_KEY`,
`ANTHROPIC_API_KEY`, `PORT`, `ALLOWED_ORIGINS`, `VITE_API_BASE_URL`,
`VITE_MAP_STYLE_URL`, y las claves opcionales por conector (zero-key-first: la
mayoria de fuentes funcionan sin clave).

## Si un secreto se filtra por error

1. **Rota el secreto inmediatamente** (la rotacion, no el borrado del commit, es lo que de verdad lo invalida).
2. Purga el historial si es necesario (`git filter-repo` / BFG) — pero asume que ya esta comprometido.
3. Revisa que `.gitignore` y los hooks cubrian el caso; si no, refuerzalos.
