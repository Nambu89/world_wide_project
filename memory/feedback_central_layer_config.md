# feedback: capas de mapa en config-array central

**Regla:** las capas de MapLibre se definen en un **config-array central declarativo** en `packages/web/`, NO con código imperativo disperso en `map.on('load')`.

**Por qué:** la mayor debilidad de osiris es que sus ~40 layer-ids se crean imperativamente y dispersos, sin registro central — difícil de mantener/extender. Lo corregimos desde el día 1.

**Cómo aplicar:** un solo `layers.config.ts` lista cada capa (id, fuente, tipo, estilo, visibilidad por `activeLayers`). El render itera ese array. Añadir una capa = añadir una entrada al array, no tocar lógica imperativa. El `verifier` comprueba este wiring.
