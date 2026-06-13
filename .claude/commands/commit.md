---
name: commit
description: git status -> git add -> mensaje conventional-commit basado en el diff real -> commit (con Co-Authored-By) -> actualiza claude-progress.txt -> git log -1 --stat. Solo el PM/usuario integra. Solo humano/slash.
disable-model-invocation: true
---

# /commit — Crear commit (solo el PM/usuario integra)

Runbook de integracion. **Solo el PM (con aprobacion humana) commitea.** Los especialistas hacen el trabajo, lo verifican y lo reportan; NO commitean.

## 1. Revisar el estado real

```bash
git status --short
git diff --stat
```

Lee el diff real para entender QUE cambio (no te fies del recuerdo).

## 2. Stagear

```bash
git add -A
```

Si hay ficheros que NO deben entrar (secretos, `.env`, artefactos locales), exclúyelos explicitamente y avisa.

## 3. Componer mensaje conventional-commit

Basado en el diff REAL, usa el tipo correcto: `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`. Subject imperativo y conciso; body solo si el "por que" no es obvio.

Termina SIEMPRE el mensaje con:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## 4. Verificar antes de commitear

Asegurate de que la suite pasa (si aplica al cambio):

```bash
pnpm -w build 2>&1 | tail -10
node --test 2>&1 | tail -5
```

Si esta en rojo, NO commitees: reporta y arregla primero.

## 5. Commit + log + progreso

```bash
git commit -F <mensaje>
```

Anade una linea a `claude-progress.txt` con fecha ISO y el resumen del commit, y muestra:

```bash
git log -1 --stat
```

**Nunca** hagas `push`, `merge`, `tag` ni `publish` sin que el usuario lo pida explicitamente.
