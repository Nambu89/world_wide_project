/**
 * blend.config.ts — Configuración editorial del blend CII
 *
 * Metodología re-derivada propia (ADR-002 / feedback_no_agpl_copy).
 * Las fórmulas, pesos y bandas son nuestras; NINGÚN valor procede de fuente AGPL.
 * Cada decisión de peso está comentada con su criterio gradeable.
 *
 * Referencias metodológicas consultadas (no copiadas):
 * - ACLED methodology (event weighting + time-decay): https://acleddata.com/acleddatanerd/
 * - PRSM / PRS Group country risk methodology (componentes baseline):
 *   https://www.prsgroup.com/explore-our-products/icrg/
 * - World Bank Political Risk indicators (Governance):
 *   https://info.worldbank.org/governance/wgi/
 * - IMF Vulnerability Exercise methodology (economic component):
 *   https://www.imf.org/en/Publications/Staff-Discussion-Notes/Issues/2022/01/10/
 *
 * Tipos locales (NO importados de @www/store — función pura, Wave A).
 * El motor T-23 reconcilia con store cuando instancia el scoring.
 */

// ─── Tipos locales ────────────────────────────────────────────────────────────

/**
 * Las cuatro componentes del event score.
 *
 * Criterio de las cuatro dimensiones:
 * - conflict:  violencia física, guerras, enfrentamientos armados. Fuente primaria
 *              ACLED/UCDP. Alta volatilidad, impacto inmediato.
 * - economic:  shocks económicos, sanciones, quiebras soberanas, crisis de divisas.
 *              Fuente primaria GDELT QuadClass 3-4 + señales trade/sanciones.
 * - political: inestabilidad política, golpes, protestas de élite, cambios de régimen.
 *              Fuente primaria GDELT evento político + señales political_instability.
 * - social:    tensión social, desplazamiento, protestas populares, crisis humanitarias.
 *              Fuente primaria GDELT protest + GKG tone negativo.
 */
export type CiiComponentKey = 'conflict' | 'economic' | 'political' | 'social';

/**
 * Secciones temáticas del radar geoeconómico (espejo local del store).
 *
 * Definido aquí como tipo local para mantener este paquete sin deps de @www/store.
 * Preserva paralelismo con Wave A (sections.config.ts de connectors/geo).
 * El motor T-23 reconcilia con el enum del store al montar el pipeline completo.
 */
export type Section =
  | 'political_instability'
  | 'commodities_energy'
  | 'critical_minerals'
  | 'semis_ai_tech'
  | 'digital_infra_cyber'
  | 'trade_sanctions';

// ─── Pesos del event blend ────────────────────────────────────────────────────

/**
 * EVENT_WEIGHTS — Pesos de cada componente en el event score.
 *
 * SUMA = 1.00 (invariante; test de igualdad exacta cubre esto).
 *
 * Criterio de los pesos:
 * - conflict 0.25:  El conflicto físico es determinante pero episódico; en la mayoría
 *                   de países el riesgo económico y político tiene mayor frecuencia y
 *                   persistencia. Ponderamos igual que social.
 * - economic 0.30:  La dimensión económica es la de mayor impacto sistémico y la más
 *                   directamente observable desde mercados (FX, CDS, equity). Recibe
 *                   el mayor peso individual. Justificado por la literatura ICRG
 *                   (economic risk = 50 pts sobre 100 en el modelo PRS Group).
 * - political 0.20: La inestabilidad política tiene alta frecuencia de señal (GDELT
 *                   captura ruido político constante) y señal-ruido menor. Ponderamos
 *                   menos para no sobreponderar eventos ruidosos.
 * - social 0.25:    Tensión social correlaciona con conflicto inminente (precursor).
 *                   Peso simétrico a conflict; junto forman la mitad del blend.
 *
 * Si se ajustan estos pesos, abrir ADR (cambio arquitectónico, Regla 4).
 */
export const EVENT_WEIGHTS: Record<CiiComponentKey, number> = {
  conflict: 0.25,
  economic: 0.30,
  political: 0.20,
  social: 0.25,
} as const;

// ─── Floors por componente ────────────────────────────────────────────────────

/**
 * FLOOR_FACTORS — Factor del floor para cada componente.
 *
 * El floor efectivo por país = baselineRisk * floorFactor.
 * Rango de cada factor: 0..1 (ajustable; se justifica a nivel de metodología).
 *
 * Criterio de los floors:
 * - "Sin datos" NO significa "sin riesgo". Un país sin informes de conflicto
 *   activo puede tener conflicto latente no registrado (sesgo de cobertura ACLED
 *   en zonas de acceso limitado). El floor ancla el componente al baseline
 *   estructural del país, evitando que desaparezca al 0 por falta de eventos recientes.
 * - conflict 0.10:  floor = 10% del baseline. Países de bajo riesgo (baseline=20)
 *                   tendrán floor de conflicto ≈ 2 pts. Países de alto riesgo (baseline=80)
 *                   → floor ≈ 8 pts. Razonable: incluso en paz hay tensión latente.
 * - economic 0.08:  floor más bajo porque la economía puede estar genuinamente estable
 *                   (macro-estabilidad medible). Se penaliza menos la ausencia de señal.
 * - political 0.08: similar a economic; la ausencia de eventos políticos puede indicar
 *                   estabilidad real (consolidación democrática) y no solo silencio mediático.
 * - social 0.10:    floor igual a conflict; la tensión social latente es difícil de
 *                   medir y el silencio mediático suele subestimar la realidad.
 *
 * Todos ajustables sin ADR (son parámetros operacionales, no arquitectónicos),
 * pero el cambio debe documentarse en el commit message con su criterio.
 */
export const FLOOR_FACTORS: Record<CiiComponentKey, number> = {
  conflict: 0.10,
  economic: 0.08,
  political: 0.08,
  social: 0.10,
} as const;

// ─── Composite (baseline × event) ────────────────────────────────────────────

/**
 * COMPOSITE — Pesos del composite final CII.
 *
 * composite = baseline * BASELINE_W + eventScore * EVENT_W
 *
 * Criterio:
 * - BASELINE_W 0.4: el riesgo estructural del país ancla el score (cambia lentamente,
 *                   cada trimestre). Evita que un pico de eventos lleve a cero un país
 *                   crónico (Afganistán no puede bajar a 10 aunque no haya noticias hoy).
 * - EVENT_W 0.6:    los eventos recientes son la señal principal; la plataforma es un
 *                   radar de anomalías actuales, no una enciclopedia estática. El peso
 *                   mayor al evento refleja la naturaleza de alerta temprana del producto.
 *
 * Si se cambia esta relación, ADR (es la decisión central de diseño del motor).
 */
export const COMPOSITE = {
  BASELINE_W: 0.4,
  EVENT_W: 0.6,
} as const;

// ─── Time-decay ───────────────────────────────────────────────────────────────

/**
 * DECAY_HALF_LIFE_MS — Vida media del time-decay en milisegundos.
 *
 * 30 días = 2 592 000 000 ms.
 *
 * Criterio (estilo ACLED): un evento de conflicto de hace 30 días pesa la mitad
 * que uno de hoy. Esto refleja la naturaleza perecedera de la señal de riesgo:
 * una batalla de hace un mes ya ha sido absorbida por el mercado y la diplomacia.
 * La vida media de 30 días es un parámetro operacional estándar en la literatura
 * de risk-scoring temporal (ACLED, IISS Armed Conflict Survey).
 *
 * Fórmula: weight = 0.5^(ageMs / HALF_LIFE_MS), clampada a [0, 1].
 */
export const DECAY_HALF_LIFE_MS: number = 30 * 24 * 3_600_000; // 2_592_000_000 ms

/**
 * decayWeight — Calcula el peso temporal de un evento por su edad en ms.
 *
 * @param ageMs  Edad del evento en milisegundos (>= 0). Negativo → clamp a 1.
 * @returns      Peso en [0, 1]. 0 ms → 1.0 (pleno). HALF_LIFE_MS → ≈ 0.5.
 *
 * Criterio gradeable:
 * - decayWeight(0) === 1 (evento actual = peso pleno)
 * - decayWeight(DECAY_HALF_LIFE_MS) ≈ 0.5 (tolerancia 1e-9 en test)
 * - decayWeight(muy_grande) → 0 (evento muy antiguo pesa casi nada)
 */
export function decayWeight(ageMs: number): number {
  const clamped = Math.max(0, ageMs);
  return Math.min(1, Math.pow(0.5, clamped / DECAY_HALF_LIFE_MS));
}

// ─── Boost caps (eventos naturales sobre el score de país) ───────────────────

/**
 * BOOST — Topes de boost por eventos naturales sobre el CII del país.
 *
 * Los eventos naturales (terremotos, incendios) añaden estrés humanitario
 * y económico que el evento-blend político no captura directamente.
 * Se añaden como boost acotado para no distorsionar el scoring político.
 *
 * Criterio:
 * - EARTHQUAKE_CAP 15: un terremoto severo (USGS sig>600) puede añadir hasta 15 pts.
 *   Por encima de 15 el impacto ya está absorbido por el componente economic/social
 *   a través de los eventos GDELT de respuesta humanitaria (doble-conteo).
 * - FIRE_CAP 15: incendios forestales masivos (>500k acres) — mismo criterio.
 * - COMBINED_CAP 25: el cap combinado (earthquake + fire) limita el boost total
 *   a 25 pts para evitar que un país con muchos eventos naturales simultáneos
 *   supere artificialmente a países en guerra activa.
 */
export const BOOST = {
  EARTHQUAKE_CAP: 15,
  FIRE_CAP: 15,
  COMBINED_CAP: 25,
} as const;

// ─── Secciones económicas ─────────────────────────────────────────────────────

/**
 * ECONOMIC_SECTIONS — Secciones del radar que alimentan la componente 'economic'.
 *
 * Criterio: las señales de commodities, comercio/sanciones y minerales críticos
 * son los tres drivers económicos de mayor impacto sistémico para los países
 * cubiertos por el radar. semis_ai_tech y digital_infra_cyber se asignan al
 * componente 'political' (governance/tech-sovereignty) en el motor T-23.
 */
export const ECONOMIC_SECTIONS: Section[] = [
  'commodities_energy',
  'trade_sanctions',
  'critical_minerals',
];

// ─── Mix de la componente social ─────────────────────────────────────────────

/**
 * SOCIAL_MIX — Pesos del blend dentro de la componente 'social'.
 *
 * La componente social combina dos sub-señales:
 * - EVENTS_W 0.6: eventos directos (protesta, desplazamiento, crisis humanitaria
 *                 en la tabla `events`). Señal más directa y verificable.
 * - GKG_W 0.4:    tono del GKG (Global Knowledge Graph de GDELT), que captura
 *                 el sentimiento mediático agregado (proxy de tensión social latente).
 *                 Peso menor porque el GKG tiene mayor ruido y puede reflejar
 *                 cobertura mediática sesgada geográficamente.
 *
 * Suma = 1.00 (invariante). El motor T-23 mezcla ambas sub-señales según estos pesos.
 */
export const SOCIAL_MIX = {
  EVENTS_W: 0.6,
  GKG_W: 0.4,
} as const;
