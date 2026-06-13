# MEMORY — Índice de memoria persistente (world_wide_project)

> Una línea por memoria. Los `feedback_*.md` cristalizan anti-patrones permanentes (lee antes de implementar).

## Proyecto
- Plataforma personal de inteligencia mundial (finanzas/educación/política). Fusión osiris (MIT, código) + worldmonitor (AGPL, metodología). Stack: Vite+React+MapLibre+Node single-server+Turso+router LLM local-first. Ver [../CLAUDE.md](../CLAUDE.md) e [../INVESTIGACION-FUSION.md](../INVESTIGACION-FUSION.md).

## Feedback (anti-patrones — no negociables)
- [feedback_no_agpl_copy](feedback_no_agpl_copy.md) — NUNCA copiar fuente AGPL de worldmonitor; solo re-implementar metodología.
- [feedback_zero_key_first](feedback_zero_key_first.md) — fuentes sin key primero; keys degradan, no rompen.
- [feedback_data_tos](feedback_data_tos.md) — respetar ToS de cada fuente; datos ≠ licencia del código.
- [feedback_secrets](feedback_secrets.md) — `.env` nunca commiteado; jamás secretos en strings de comandos.
- [feedback_central_layer_config](feedback_central_layer_config.md) — capas de mapa en config-array central, no imperativas dispersas.
