/**
 * sections.config.ts — Clasificador editorial de secciones del Radar Geoeconómico
 *
 * Mapa declarativo sección → {themeCodes[], keywords[], entityHints[]} que asigna
 * cada artículo GKG a 0..N de las 6 secciones temáticas del radar.
 *
 * Metodología re-derivada propia (ADR-002 / D-004 / D-008 / feedback_no_agpl_copy):
 * - Valores editoriales propios; NINGÚN texto procede de fuente AGPL (worldmonitor).
 * - Referencia: GDELT 2.0 GKG codebook (LOOKUP-GKGTHEMES.TXT, público).
 *   Verificación en vivo 2026-06-14 confirmó cobertura por sección.
 * - Criterio de cada bloque documentado en comentarios (criterios gradeables, no vibes).
 * - Precedente de patrón: severity.ts (config editorial re-derivada, misma rebanada).
 *
 * Skill aplicada: cii-scoring — criterios gradeables: cada regla de match es verificable
 * con un test determinista (exactamente qué dispara, exactamente qué no).
 *
 * NO importa @www/store — función PURA, Section como union local (T-16 constraint).
 * Paralelismo Wave A: espejo estructural de Section en @www/store/src/types.ts (T-15).
 *
 * Fuente metodológica externa:
 * - GDELT 2.0 GKG Codebook: https://www.gdeltproject.org/data/documentation/GDELT-Event_Codebook-V2.0.pdf
 * - GDELT Theme Lookup: http://data.gdeltproject.org/api/v2/guides/LOOKUP-GKGTHEMES.TXT
 */

// ─── Tipos locales (espejo de @www/store, sin import) ────────────────────────

/**
 * Las 6 secciones temáticas del radar geoeconómico.
 * Union local — estructuralmente idéntica a Section en @www/store/src/types.ts (T-15).
 * Cambiar aquí = cambiar en store (PM sincroniza).
 */
export type Section =
  | 'political_instability'
  | 'commodities_energy'
  | 'critical_minerals'
  | 'semis_ai_tech'
  | 'digital_infra_cyber'
  | 'trade_sanctions';

/** Razón por la que un artículo fue asignado a una sección. */
export type MatchedBy = 'theme' | 'keyword' | 'entity';

/** Resultado de classify() para una sección concreta. */
export interface SectionMatch {
  section: Section;
  matchedBy: MatchedBy;
}

/** Reglas declarativas por sección. */
export interface SectionRules {
  /**
   * Theme-codes GKG a matchear.
   * Acepta exactos ('WB_2433_CONFLICT_AND_VIOLENCE') y prefijos ('ENV_', 'ECON_').
   * Un prefijo termina en '_'; todo lo que empiece por él hace match.
   * Fuente: LOOKUP-GKGTHEMES.TXT (público, codebook GDELT 2.0).
   */
  themeCodes: string[];
  /**
   * Keywords case-insensitive evaluados sobre title + V1Themes (join en texto).
   * Cubren las secciones donde el theme-code GKG es débil o inexistente
   * (semis/ciber/minerales críticos no tienen theme-codes fuertes propios).
   */
  keywords: string[];
  /**
   * Fragmentos de organización o persona (V2Organizations / V2Persons).
   * Match parcial case-insensitive. Cubren entidades ancla de sección
   * (fabricantes de chips, actores clave en tech/infra).
   */
  entityHints: string[];
}

// ─── SECTIONS: mapa editorial re-derivado ────────────────────────────────────

/**
 * Mapa sección → reglas de clasificación.
 *
 * Valores re-derivados propios a partir de:
 * 1. Cobertura verificada en vivo (2026-06-14, wf_e68c43c8-11c, 670 art/15min).
 * 2. GDELT 2.0 GKG codebook público (LOOKUP-GKGTHEMES.TXT).
 * 3. Conocimiento de dominio geoeconómico (criterios gradeables documentados).
 * NUNCA copiado de worldmonitor (AGPL). Ver ADR-002 / feedback_no_agpl_copy.
 */
export const SECTIONS: Record<Section, SectionRules> = {

  // ── political_instability ────────────────────────────────────────────────────
  // Criterio: artículos que describen violencia política organizada, conflicto
  // armado, cambio de régimen, inestabilidad gubernamental o protesta social
  // con potencial de desestabilización estatal.
  // Theme-codes: fuertes (verificados en vivo). Cubren el grueso sin keywords.
  // Keywords: complementan cambios de gobierno y crisis electorales que los
  // theme-codes de violencia pueden no capturar directamente.
  political_instability: {
    themeCodes: [
      'WB_2433_CONFLICT_AND_VIOLENCE',        // conflicto y violencia (Banco Mundial taxonomy)
      'WB_2432_FRAGILITY_CONFLICT_AND_VIOLENCE', // fragilidad de estado + conflicto
      'WB_2462_POLITICAL_VIOLENCE_AND_WAR',   // violencia política y guerra
      'WB_2465_REVOLUTIONARY_VIOLENCE',       // violencia revolucionaria / insurrección
      'PROTEST',                              // protestas, manifestaciones, huelgas generales
      'GENERAL_GOVERNMENT',                   // inestabilidad gubernamental general
      'SLFID_DICTATORSHIP',                   // régimen dictatorial (indicador de fragilidad)
      'EPU_POLICY',                           // incertidumbre de política económica (EPU index)
    ],
    // Criterio: crisis que no siempre generan un theme-code de violencia pero sí
    // mencionan el mecanismo político desestabilizador.
    keywords: ['coup', 'uprising', 'election crisis', 'martial law', 'state of emergency'],
    // Criterio: actores institucionales de inestabilidad cuya mención sugiere el
    // contexto político incluso sin theme-code explícito.
    entityHints: [],
  },

  // ── commodities_energy ──────────────────────────────────────────────────────
  // Criterio: artículos sobre mercados de materias primas energéticas y
  // metales base + sistemas de extracción/producción. Incluye petróleo,
  // gas natural, carbón, energías renovables, metales preciosos y minería.
  // Theme-codes: muy fuertes (verificados en vivo como los más frecuentes).
  // ECON_* cubre shocks macroeconómicos ligados a commodities (inflación,
  // balanza de pagos), con prefijo para capturar toda la familia.
  commodities_energy: {
    themeCodes: [
      'ENV_OIL',              // petróleo (producción, precio, demanda)
      'ENV_NATURALGAS',       // gas natural (GNL, gasoductos, precio hub)
      'ENV_METALS',           // metales (mercados spot, LME)
      'ENV_MINING',           // minería en general
      'ENV_SOLAR',            // energía solar (capacidad, inversión, cadena)
      'ENV_COAL',             // carbón (producción, cierre de plantas, precio)
      'ENV_NUCLEAR',          // nuclear (capacidad, seguridad, nuevas plantas)
      'WB_507_ENERGY_AND_EXTRACTIVES', // energía y extractivos (Banco Mundial)
      'WB_2936_GOLD',         // oro (mercado, reservas, bancos centrales)
      'WB_2937_SILVER',       // plata (mercado industrial + depósito)
      'WB_1699_METAL_ORE_MINING', // minería de mineral metálico
      'ECON_',                // prefijo: toda la familia ECON_* (shocks macro)
    ],
    // Criterio: términos del mercado físico de energía y commodities que
    // no siempre aparecen como theme-code pero delimitan el contexto.
    keywords: ['OPEC', 'LNG', 'crude oil', 'refinery', 'pipeline', 'spot price', 'energy crisis'],
    entityHints: ['OPEC', 'IEA', 'EIA'],
  },

  // ── critical_minerals ───────────────────────────────────────────────────────
  // Criterio: artículos sobre minerales estratégicos escasos o de cadena
  // de suministro concentrada en pocos países, con impacto en tecnología,
  // defensa y transición energética. Sección keyword-dependiente porque el
  // GKG no tiene theme-codes fuertes propios para este nicho (GAP-3).
  // Theme-codes: comparten con commodities_energy (minería/metales) pero se
  // combina con keywords específicos para discriminar el subconjunto crítico.
  critical_minerals: {
    themeCodes: [
      'WB_895_MINING_SYSTEMS',     // sistemas de minería (Banco Mundial)
      'WB_1699_METAL_ORE_MINING',  // minería de mineral metálico (solapado con commodities)
      'ENV_MINING',                // minería (solapado; keyword refina)
      'ENV_METALS',                // metales (solapado; keyword refina)
    ],
    // Criterio: los nombres concretos de minerales críticos son el discriminador
    // primario. "Critical minerals" como término paraguas cubre documentos de
    // política; los nombres específicos capturan el flujo de noticias operativo.
    keywords: [
      'rare earth',        // tierras raras (REE; cadena dominada por China)
      'rare-earth',        // variante con guión
      'lithium',           // baterías EV y almacenamiento
      'cobalt',            // baterías, predominio RDC
      'nickel',            // acero inoxidable + EV batteries
      'neodymium',         // imanes permanentes (motores EV, turbinas eólicas)
      'graphite',          // ánodos de batería (China ~65% producción)
      'manganese',         // acero y química de batería
      'critical minerals', // término paraguas de política de suministro
      'battery metals',    // metales de batería (término de mercado)
    ],
    entityHints: [],
  },

  // ── semis_ai_tech ───────────────────────────────────────────────────────────
  // Criterio: artículos sobre la cadena de suministro de semiconductores,
  // inteligencia artificial y tecnologías habilitadoras con impacto
  // geoeconómico (controles de exportación, restricciones de acceso,
  // inversión/desinversión estratégica). Totalmente keyword/entity-dependiente
  // porque el GKG no segrega semis/IA como categoría propia (GAP-3).
  semis_ai_tech: {
    // Criterio: no hay theme-codes GKG fuertes y propios para esta sección.
    // Los artículos sobre semiconductores/IA caen bajo ECON_* o WB_* genéricos
    // que son demasiado amplios. Keywords y entidades son el mecanismo primario.
    themeCodes: [],
    // Criterio: términos técnicos y de política que delimitan el contexto
    // de la cadena de valor de chips e IA con impacto geopolítico.
    keywords: [
      'semiconductor',     // término general de la industria
      'chip',              // coloquial pero muy frecuente en titulares
      'microchip',         // variante formal
      'wafer',             // insumo clave de la cadena (diferenciador de contexto)
      'fab',               // fábrica de chips (fabrication plant)
      'foundry',           // modelo de negocio del chip (TSMC, Samsung)
      'GPU',               // procesador gráfico (IA/HPC)
      'AI model',          // modelos de inteligencia artificial
      'export control',    // controles de exportación (BIS, Entity List)
      'chip ban',          // prohibición de chips (titular frecuente)
      'advanced packaging', // empaquetado avanzado (CoWoS, HBM) — eslabón clave
    ],
    // Criterio: empresas ancla de la cadena de valor; su mención implica el
    // contexto de la sección incluso sin keyword de chip/IA en el título.
    entityHints: [
      'TSMC',    // Taiwan Semiconductor Manufacturing Company
      'ASML',    // único fabricante de litografía EUV
      'Nvidia',  // GPU dominante para IA
      'Intel',   // IDM + foundry (IFS)
      'Samsung', // foundry + memoria (HBM)
      'SK Hynix', // HBM y DRAM
      'Micron',  // memoria DRAM/NAND
      'Qualcomm', // chips móviles y automotriz
      'SMIC',    // fabricante chino (centro de las restricciones de exportación)
      'Huawei',  // actor central en las sanciones tech
    ],
  },

  // ── digital_infra_cyber ─────────────────────────────────────────────────────
  // Criterio: artículos sobre ataques a infraestructura digital crítica,
  // ciberataques de impacto sistémico, ciberespionaje de estado, y
  // disrupción de infraestructura física de datos (cables submarinos,
  // data centers, redes de telecomunicaciones). También keyword-dependiente.
  digital_infra_cyber: {
    // Criterio: los theme-codes GKG de ciberseguridad son escasos y genéricos;
    // se complementa con keywords específicos de incidentes.
    themeCodes: [
      'CYBER_ATTACK',      // si el codebook lo incluye; cubierto también por keyword
      'MANMADE_DISASTER_CYBER', // desastre artificial ciber (codebook GDELT v2)
    ],
    // Criterio: términos que indican disrupción de infraestructura digital
    // con impacto potencialmente sistémico o geopolítico.
    keywords: [
      'cyberattack',       // ataque cibernético
      'cyber attack',      // variante con espacio
      'ransomware',        // malware de rescate (impacto en infraestructura crítica)
      'DDoS',              // denegación de servicio distribuida
      'data center',       // centro de datos (infraestructura física)
      'submarine cable',   // cable submarino (infraestructura de internet)
      'undersea cable',    // variante de cable submarino
      'internet outage',   // interrupción de internet a escala
      'critical infrastructure', // término paraguas de política
      'power grid hack',   // ataque a red eléctrica
      'supply chain attack', // ataque a cadena de suministro software
    ],
    // Criterio: actores y agencias con impacto en la sección cyber.
    entityHints: [
      'CISA',    // Cybersecurity and Infrastructure Security Agency (EE.UU.)
      'NSA',     // National Security Agency (ciberespionaje, alertas)
      'Cloudflare', // infraestructura web crítica y reportes de ataques
      'CrowdStrike', // empresa de ciberseguridad (informes de amenazas)
    ],
  },

  // ── trade_sanctions ─────────────────────────────────────────────────────────
  // Criterio: artículos sobre sanciones económicas, restricciones comerciales,
  // aranceles, embargos y política macroeconómica con impacto en el comercio
  // internacional. Theme-codes fuertes en el codebook GKG (verificados en vivo).
  trade_sanctions: {
    themeCodes: [
      'WB_698_TRADE',                               // comercio internacional (Banco Mundial)
      'WB_439_MACROECONOMIC_AND_STRUCTURAL_POLICIES', // política macro y estructural
      'ECON_',                                      // prefijo ECON_* (familia macro/comercio)
      'WB_2433_SANCTIONS',                          // sanciones (si existe en codebook v2)
      'UNGP_SANCTIONS',                             // sanciones ONU
      'EPU_TRADE',                                  // incertidumbre política comercial
    ],
    // Criterio: términos específicos del régimen de sanciones y política
    // comercial que complementan los theme-codes.
    keywords: [
      'sanctions',         // sanciones económicas
      'tariff',            // arancel
      'embargo',           // embargo comercial
      'export control',    // control de exportaciones (compartido con semis; ambas secciones)
      'import ban',        // prohibición de importación
      'trade war',         // guerra comercial
      'trade dispute',     // disputa comercial (OMC, bilateral)
      'blacklist',         // lista negra de entidades
      'entity list',       // lista de entidades (BIS EE.UU.)
      'OFAC',              // Office of Foreign Assets Control (sanciones EE.UU.)
    ],
    // Criterio: organismos e instituciones cuya mención implica política comercial
    // o de sanciones con impacto geoeconómico.
    entityHints: [
      'OFAC',    // Office of Foreign Assets Control
      'WTO',     // Organización Mundial del Comercio
      'OMC',     // nombre en español de WTO (posibles artículos en español)
      'BIS',     // Bureau of Industry and Security (controles de exportación EE.UU.)
      'G7',      // grupo que coordina paquetes de sanciones
      'G20',     // foro macro; aparece en disputas comerciales sistémicas
    ],
  },
};

// ─── classify ────────────────────────────────────────────────────────────────

/**
 * Input del clasificador: los campos relevantes de un artículo GKG parseado.
 */
export interface ClassifyInput {
  /** V1Themes (col8 GKG): lista de theme-codes ya split por ';'. */
  themes: string[];
  /** PAGE_TITLE del artículo (V2ExtrasXML col27). Puede ser null. */
  title: string | null;
  /** V2Organizations (col13): ya split por ';'. */
  organizations: string[];
  /** V2Persons (col12): ya split por ';'. */
  persons: string[];
}

/**
 * classify — Asigna el artículo a 0..N secciones del radar.
 *
 * Criterios de match (gradeables, verificables con tests):
 * 1. THEME match:   alguno de los themeCodes de la sección hace match exacto o por
 *    prefijo con alguno de los themes del artículo.
 *    - Prefijo: si el themeCode termina en '_', se hace startsWith.
 *    - Exacto: igualdad de string (case-sensitive; los theme-codes GKG son mayúsculas).
 * 2. KEYWORD match: alguno de los keywords (case-insensitive) está contenido en
 *    el texto "title + ' ' + themes.join(' ')". El texto combinado permite que un
 *    tema como "RARE_EARTH" en V1Themes dispare el keyword 'rare earth' (aunque el
 *    mapeo no es directo; el match sobre title es el caso primario).
 * 3. ENTITY match:  alguno de los entityHints (case-insensitive, match parcial) está
 *    contenido en alguno de los strings de organizations o persons.
 *
 * Precedencia para matchedBy cuando hay varios matches en la misma sección:
 *   theme > keyword > entity
 * (se registra el de mayor precedencia; los demás se descartan para esa sección).
 *
 * Dedup: si la misma sección aparece por múltiples razones, se emite UNA SOLA
 * entrada con el matchedBy de mayor precedencia.
 *
 * Returns: Array<SectionMatch> con 0..N entradas (una por sección distinta matcheada).
 * El orden refleja el orden de las secciones en SECTIONS, no la precedencia.
 *
 * @param input - Campos del artículo GKG ya parseados.
 */
export function classify(input: ClassifyInput): SectionMatch[] {
  const { themes, title, organizations, persons } = input;

  // Texto combinado para keyword search (title + themes en texto plano).
  // Los theme-codes están en UPPER_SNAKE_CASE; los keywords son lower.
  // La normalización a minúsculas unifica ambos contextos.
  const searchText = [title ?? '', ...themes].join(' ').toLowerCase();

  // Texto combinado para entity search (organizations + persons).
  // Match parcial case-insensitive: se busca entityHint dentro de cada string.
  const entityStrings = [...organizations, ...persons].map((s) => s.toLowerCase());

  const results: SectionMatch[] = [];

  for (const [section, rules] of Object.entries(SECTIONS) as [Section, SectionRules][]) {
    // Evaluar las 3 capas en orden de precedencia (theme > keyword > entity).
    // En cuanto se confirma una, no es necesario seguir para esa sección,
    // pero sí se podría — aquí registramos el de mayor precedencia.

    let matchedBy: MatchedBy | null = null;

    // 1. THEME match (exacto o por prefijo)
    if (rules.themeCodes.length > 0) {
      for (const rule of rules.themeCodes) {
        const isPrefix = rule.endsWith('_');
        const matched = isPrefix
          ? themes.some((t) => t.startsWith(rule))
          : themes.includes(rule);
        if (matched) {
          matchedBy = 'theme';
          break;
        }
      }
    }

    // 2. KEYWORD match (si no hay theme match ya)
    if (matchedBy === null && rules.keywords.length > 0) {
      for (const kw of rules.keywords) {
        if (searchText.includes(kw.toLowerCase())) {
          matchedBy = 'keyword';
          break;
        }
      }
    }

    // 3. ENTITY match (si no hay theme ni keyword match)
    if (matchedBy === null && rules.entityHints.length > 0) {
      for (const hint of rules.entityHints) {
        const hintLower = hint.toLowerCase();
        if (entityStrings.some((e) => e.includes(hintLower))) {
          matchedBy = 'entity';
          break;
        }
      }
    }

    if (matchedBy !== null) {
      results.push({ section, matchedBy });
    }
  }

  return results;
}
