/**
 * coefficients.ts — Coeficientes estructurales por país para el CII
 *
 * Metodología re-derivada propia (ADR-002 / feedback_no_agpl_copy).
 * Las estimaciones de baselineRisk son valores propios, no copiados de ninguna
 * fuente AGPL. Se derivan de una síntesis editorial de indicadores públicos:
 *
 * Referencias metodológicas consultadas (no copiadas):
 * - ICRG Political Risk Index (PRS Group): escala 0-100 de riesgo político.
 *   https://www.prsgroup.com/explore-our-products/icrg/
 * - Fragile States Index (Fund for Peace): escala 0-120, invertida aquí a 0-100.
 *   https://fragilestatesindex.org/
 * - World Bank Worldwide Governance Indicators (WGI): -2.5..+2.5, invertidos.
 *   https://info.worldbank.org/governance/wgi/
 * - Economist Intelligence Unit Democracy Index: escala 0-10 invertida.
 *   https://www.eiu.com/n/campaigns/democracy-index-2023/
 *
 * Criterio general de baselineRisk:
 *   0-20:  estabilidad muy alta (democracias consolidadas, sin conflictos activos,
 *          macro estable, instituciones fuertes). Ej: Noruega, Suiza, Dinamarca.
 *  21-40:  estabilidad alta (democracias con tensiones menores o transiciones).
 *  41-60:  riesgo moderado (tensiones políticas recurrentes, economías emergentes
 *          con vulnerabilidades, historial de inestabilidad).
 *  61-80:  riesgo elevado (conflictos episódicos, fragilidad institucional alta,
 *          sanciones o aislamiento internacional significativo).
 *  81-100: riesgo muy elevado (conflictos activos, falla de estado, aislamiento
 *          internacional total). Ej: Corea del Norte.
 *
 * eventMultiplier:
 *   1.0 (default) — respuesta estándar al event score.
 *   >1.0 — amplificador para países donde un evento tiene impacto sistémico
 *           desproporcionado (Ej: Venezuela 1.3 — economía muy frágil, un evento
 *           político tiene repercusión mayor que en país estable).
 *   La decisión de subir eventMultiplier sobre 1.0 requiere criterio documentado.
 *
 * Las claves DEBEN ser los nombres canónicos de country-centroids.ts.
 * NUNCA usar ISO-2 ni FIPS aquí — la normalización es responsabilidad de country-key.ts.
 */

import type { CiiComponentKey } from './blend.config.js';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CountryCoeff {
  /** Riesgo estructural del país en escala 0..100 (lento, actualizable trimestralmente). */
  baselineRisk: number;
  /**
   * Multiplicador del event score (default 1.0).
   * Un país con alta fragilidad amplifica el impacto de cada evento nuevo.
   * Rango recomendado: 0.8..1.5. Por encima de 1.5 requiere ADR.
   */
  eventMultiplier: number;
}

/**
 * COMPONENT_REGISTRY — Mapa de las 4 componentes del CII a sus fuentes de datos.
 *
 * Permite al motor T-23 saber dónde buscar los datos para cada componente
 * sin hardcodear la lógica de extracción en el scoring central.
 *
 * - storeSource: selector conceptual de la tabla/filtro en @www/store.
 * - refinedBy:   conector que produce datos de alta calidad para esta componente
 *                (null = no hay conector especializado en Wave A).
 */
export interface ComponentRegistryEntry {
  key: CiiComponentKey;
  /** Peso del componente (= EVENT_WEIGHTS[key]; duplicado aquí para auto-documentación). */
  weight: number;
  /**
   * Selector de datos en el store.
   * Formato: 'tabla:filtro' (notación conceptual para el motor, no SQL literal).
   */
  storeSource: string;
  /**
   * Ruta relativa al conector que refina esta componente (desde la raíz del monorepo).
   * null = datos vienen solo de GDELT/USGS/EONET sin conector especializado.
   */
  refinedBy: string | null;
}

// ─── Coeficientes por país ────────────────────────────────────────────────────

/**
 * COUNTRY_COEFFS — Coeficientes estructurales para los ~64 países del radar.
 *
 * Claves = nombres canónicos de packages/connectors/geo/country-centroids.ts.
 * Todos los valores son estimaciones editoriales propias.
 */
export const COUNTRY_COEFFS: Record<string, CountryCoeff> = {
  // ── América del Norte ──────────────────────────────────────────────────────
  // Estados Unidos: instituciones muy robustas, riesgo moderado por polarización
  // interna y papel sistémico global (shocks en USA = shocks globales).
  "United States": { baselineRisk: 22, eventMultiplier: 1.0 },
  // Canadá: democracia muy consolidada, bajo riesgo estructural.
  "Canada": { baselineRisk: 12, eventMultiplier: 1.0 },
  // México: tensión crónica por crimen organizado, fragilidad regional.
  "Mexico": { baselineRisk: 52, eventMultiplier: 1.1 },

  // ── América del Sur ────────────────────────────────────────────────────────
  // Brasil: democracia consolidada pero con vulnerabilidades macro y polarización.
  "Brazil": { baselineRisk: 42, eventMultiplier: 1.0 },
  // Argentina: inestabilidad macro crónica (múltiples defaults soberanos).
  "Argentina": { baselineRisk: 55, eventMultiplier: 1.2 },
  // Chile: instituciones sólidas pero tensión social post-2019.
  "Chile": { baselineRisk: 32, eventMultiplier: 1.0 },
  // Colombia: mejora estructural post-acuerdo de paz, tensión narco residual.
  "Colombia": { baselineRisk: 48, eventMultiplier: 1.1 },
  // Perú: inestabilidad política crónica (presidentes removidos/renunciantes).
  "Peru": { baselineRisk: 50, eventMultiplier: 1.1 },
  // Venezuela: colapso institucional y económico profundo, sanciones US/EU.
  "Venezuela": { baselineRisk: 82, eventMultiplier: 1.3 },

  // ── Europa Occidental ──────────────────────────────────────────────────────
  // Reino Unido: democracia sólida, tensiones post-Brexit menores.
  "United Kingdom": { baselineRisk: 18, eventMultiplier: 1.0 },
  // Alemania: anchor económico europeo, riesgo muy bajo.
  "Germany": { baselineRisk: 14, eventMultiplier: 1.0 },
  // Francia: tensiones sociales recurrentes (chalecos amarillos, reformas);
  // instituciones fuertes amortiguan.
  "France": { baselineRisk: 20, eventMultiplier: 1.0 },
  // España: tensiones territoriales (Cataluña), pero macro estable en zona €.
  "Spain": { baselineRisk: 22, eventMultiplier: 1.0 },
  // Italia: fragilidad política crónica (gobiernos de corta duración), deuda alta.
  "Italy": { baselineRisk: 28, eventMultiplier: 1.0 },
  // Países Bajos: muy estable, hub logístico-financiero europeo.
  "Netherlands": { baselineRisk: 12, eventMultiplier: 1.0 },
  // Suiza: neutralidad histórica, sistema político muy estable.
  "Switzerland": { baselineRisk: 10, eventMultiplier: 1.0 },
  // Bélgica: tensiones comunitarias (Flandes/Valonia) pero macro estable.
  "Belgium": { baselineRisk: 16, eventMultiplier: 1.0 },
  // Suecia: estabilidad muy alta, entrada OTAN reciente reduce exposición.
  "Sweden": { baselineRisk: 12, eventMultiplier: 1.0 },
  // Noruega: la más estable del radar (fondo soberano, sin deuda, OTAN).
  "Norway": { baselineRisk: 8, eventMultiplier: 1.0 },
  // Dinamarca: muy estable, democracia consolidada.
  "Denmark": { baselineRisk: 9, eventMultiplier: 1.0 },
  // Finlandia: entrada OTAN 2023, vecindad Rusia eleva ligeramente.
  "Finland": { baselineRisk: 13, eventMultiplier: 1.0 },
  // Austria: estable, posición geoestratégica central en Europa.
  "Austria": { baselineRisk: 14, eventMultiplier: 1.0 },
  // Portugal: reformas post-troika completadas, estable.
  "Portugal": { baselineRisk: 18, eventMultiplier: 1.0 },
  // Grecia: vulnerabilidades macro residuales post-crisis, tensiones migratorias.
  "Greece": { baselineRisk: 30, eventMultiplier: 1.0 },
  // Irlanda: muy estable, beneficiada por inversión FDI post-Brexit.
  "Ireland": { baselineRisk: 12, eventMultiplier: 1.0 },
  // Polonia: democracia en consolidación, frontera OTAN con tensión Este.
  "Poland": { baselineRisk: 28, eventMultiplier: 1.0 },
  // República Checa (Czechia en centroids como "Czech Republic").
  "Czech Republic": { baselineRisk: 20, eventMultiplier: 1.0 },
  // Hungría: retroceso democrático documentado (rule of law), tensión UE.
  "Hungary": { baselineRisk: 32, eventMultiplier: 1.0 },
  // Rumanía: corrupción institucional moderada, progreso UE.
  "Romania": { baselineRisk: 30, eventMultiplier: 1.0 },

  // ── Europa Oriental / Eurasia ──────────────────────────────────────────────
  // Rusia: conflicto activo en Ucrania, sanciones masivas, aislamiento SWIFT.
  "Russia": { baselineRisk: 80, eventMultiplier: 1.2 },
  // Ucrania: guerra activa 2022-, riesgo máximo entre países europeos.
  "Ukraine": { baselineRisk: 88, eventMultiplier: 1.3 },
  // Turquía: alto grado de concentración de poder, inflación crónica, tensiones OTAN.
  "Turkey": { baselineRisk: 52, eventMultiplier: 1.1 },

  // ── Oriente Medio ──────────────────────────────────────────────────────────
  // Arabia Saudí: monarquía absoluta, reformas Vision 2030, región volátil.
  "Saudi Arabia": { baselineRisk: 48, eventMultiplier: 1.1 },
  // Emiratos Árabes: la más estable del Golfo, hub financiero neutral.
  "United Arab Emirates": { baselineRisk: 28, eventMultiplier: 1.0 },
  // Israel: conflicto activo Gaza 2023-, tensión regional permanente.
  "Israel": { baselineRisk: 62, eventMultiplier: 1.2 },
  // Irán: sanciones US/EU, programa nuclear, proxy conflicts regionales.
  "Iran": { baselineRisk: 75, eventMultiplier: 1.2 },
  // Irak: reconstrucción post-ISIS, tensiones milicias pro-irán, petro-dependencia.
  "Iraq": { baselineRisk: 70, eventMultiplier: 1.2 },
  // Qatar: estable, hub mediación/gas, tensiones diplomáticas regionales resueltas.
  "Qatar": { baselineRisk: 25, eventMultiplier: 1.0 },
  // Kuwait: estabilidad alta pero bloqueos parlamentarios frecuentes.
  "Kuwait": { baselineRisk: 28, eventMultiplier: 1.0 },

  // ── Asia ───────────────────────────────────────────────────────────────────
  // China: riesgo sistémico elevado — tensión Taiwan, deuda inmobiliaria, PCCC.
  "China": { baselineRisk: 55, eventMultiplier: 1.2 },
  // Japón: muy estable, tensión geopolítica norte (Corea del Norte, China).
  "Japan": { baselineRisk: 18, eventMultiplier: 1.0 },
  // India: democracia mayor del mundo, tensiones fronterizas (Pakis/China).
  "India": { baselineRisk: 38, eventMultiplier: 1.0 },
  // Corea del Sur: estable, expuesta a tensiones norte.
  "South Korea": { baselineRisk: 30, eventMultiplier: 1.0 },
  // Corea del Norte: estado hermético, nuclear, máxima incertidumbre.
  "North Korea": { baselineRisk: 90, eventMultiplier: 1.3 },
  // Indonesia: democracia estable, riesgo natural elevado (sismos/volcanes).
  "Indonesia": { baselineRisk: 35, eventMultiplier: 1.0 },
  // Tailandia: golpes históricos recurrentes, monarquía, tensiones políticas.
  "Thailand": { baselineRisk: 42, eventMultiplier: 1.0 },
  // Vietnam: partido único estable, economía creciente, tensión Mar del Sur China.
  "Vietnam": { baselineRisk: 35, eventMultiplier: 1.0 },
  // Malasia: tensiones étnicas históricas, política de coalición compleja.
  "Malaysia": { baselineRisk: 32, eventMultiplier: 1.0 },
  // Singapur: el más estable de Asia, hub financiero global.
  "Singapore": { baselineRisk: 10, eventMultiplier: 1.0 },
  // Pakistán: fragilidad institucional alta, tensiones nucleares, conflicto TTP.
  "Pakistan": { baselineRisk: 72, eventMultiplier: 1.2 },
  // Bangladesh: gobierno en transición post-Hasina 2024, tensiones sociales.
  "Bangladesh": { baselineRisk: 50, eventMultiplier: 1.1 },
  // Hong Kong: autonomía reducida post-NSL 2020, tensiones civiles absorbidas.
  "Hong Kong": { baselineRisk: 35, eventMultiplier: 1.0 },
  // Taiwán: tensión con China, riesgo geopolítico muy elevado pero instituciones fuertes.
  "Taiwan": { baselineRisk: 45, eventMultiplier: 1.1 },

  // ── África ─────────────────────────────────────────────────────────────────
  // Sudáfrica: democracia pero load shedding crónico, desigualdad alta.
  "South Africa": { baselineRisk: 48, eventMultiplier: 1.1 },
  // Nigeria: mayor economía africana, inseguridad Boko Haram / bandidos.
  "Nigeria": { baselineRisk: 65, eventMultiplier: 1.2 },
  // Egipto: autoritarismo estable, deuda externa alta, tensión regional.
  "Egypt": { baselineRisk: 55, eventMultiplier: 1.1 },
  // Etiopía: conflicto Tigray/Amhara, fragmentación interna.
  "Ethiopia": { baselineRisk: 68, eventMultiplier: 1.2 },
  // Kenia: estable para la región, tensiones post-electorales episódicas.
  "Kenya": { baselineRisk: 45, eventMultiplier: 1.0 },
  // Ghana: democracia sólida para África Occidental, crisis FMI 2022-23.
  "Ghana": { baselineRisk: 38, eventMultiplier: 1.0 },
  // Marruecos: estabilidad relativa, monarquía, tensión Sahara Occidental.
  "Morocco": { baselineRisk: 40, eventMultiplier: 1.0 },
  // Argelia: ingresos petro-gas, tensiones sociales internas contenidas.
  "Algeria": { baselineRisk: 48, eventMultiplier: 1.0 },
  // Libia: estado fallido post-2011, facciones armadas, doble gobierno.
  "Libya": { baselineRisk: 82, eventMultiplier: 1.3 },

  // ── Oceanía ────────────────────────────────────────────────────────────────
  // Australia: democracia muy consolidada, bajo riesgo (riesgo natural elevado
  // pero no afecta el CII político/económico directamente).
  "Australia": { baselineRisk: 14, eventMultiplier: 1.0 },
  // Nueva Zelanda: la más estable de Oceanía.
  "New Zealand": { baselineRisk: 10, eventMultiplier: 1.0 },
};

/**
 * DEFAULT_COEFF — Coeficiente por defecto para países sin entrada en COUNTRY_COEFFS.
 *
 * baselineRisk 30: riesgo bajo-moderado por defecto (países no cubiertos tienden
 * a ser de menor relevancia sistémica o menor cobertura mediática).
 * eventMultiplier 1.0: sin amplificación por defecto.
 */
export const DEFAULT_COEFF: CountryCoeff = {
  baselineRisk: 30,
  eventMultiplier: 1.0,
};

// ─── Registro de componentes ──────────────────────────────────────────────────

/**
 * COMPONENT_REGISTRY — Las 4 componentes del CII con sus fuentes de datos.
 *
 * El motor T-23 itera este registro para saber qué datos extraer del store
 * y qué conectores refinar para cada componente.
 *
 * storeSource format: 'tabla:selector' (conceptual, el motor lo interpreta).
 * - 'events:category=conflict' → tabla events, filtro por category
 * - 'events:protest+signals:political_instability' → eventos de protesta + señales
 * - 'signals:...' → tabla signals (Wave B)
 */
export const COMPONENT_REGISTRY: ComponentRegistryEntry[] = [
  {
    key: 'conflict',
    weight: 0.25,
    storeSource: 'events:category=conflict',
    // ACLED será el conector de alta calidad para conflicto cuando se implemente
    refinedBy: 'packages/connectors/geo/acled.ts',
  },
  {
    key: 'social',
    weight: 0.25,
    storeSource: 'events:category=protest,humanitarian+signals:political_instability',
    refinedBy: null, // datos de GDELT eventos + GKG tone (Wave A)
  },
  {
    key: 'economic',
    weight: 0.30,
    storeSource: 'signals:commodities_energy,trade_sanctions,critical_minerals',
    refinedBy: null, // señales de convergencia (Wave B)
  },
  {
    key: 'political',
    weight: 0.20,
    storeSource: 'events:category=political+signals:political_instability,semis_ai_tech,digital_infra_cyber',
    refinedBy: null,
  },
];
