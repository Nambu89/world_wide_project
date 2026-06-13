# feedback: higiene de secretos

**Regla:** todas las keys (FRED, EIA, ACLED, AISStream, Finnhub, GROQ, ANTHROPIC...) van en `.env` (en `.gitignore`, NUNCA commiteado). Hay un `.env.example` con nombres sin valores. JAMÁS pongas un secreto dentro de un string de comando allowlisted.

**Por qué:** en TaxIA, `settings.local.json` filtró secretos OAuth/passwords/PII embebidos en strings de comandos allowlisted. El `bash-gate.js` aquí es **default-deny** y deny-lista lecturas/escrituras de `.env`.

**Cómo aplicar:** ver [../.claude/SECRETS.md](../.claude/SECRETS.md). El código lee de `process.env` (cargado por el runtime), no hardcodea. Si un comando necesita un secreto, pásalo por variable de entorno del proceso, no en la línea de comando.
