/**
 * severity.ts — Normalizador de severity 0..100 por fuente
 *
 * Convierte métricas nativas heterogéneas de cada fuente a una escala común
 * comparable (0 = sin impacto perceptible, 100 = impacto catastrófico).
 *
 * Metodología re-derivada propia (ADR-002 / D-006 / feedback_no_agpl_copy):
 * - Las fórmulas y bandas son nuestras; NINGÚN valor procede de fuente AGPL.
 * - Cada decisión de banda está comentada con su criterio gradeable.
 * - raw_json conserva la métrica nativa para recalibración posterior (D-103 / R-1).
 *
 * Referencia metodológica externa consultada:
 * - USGS PAGER alert levels: https://earthquake.usgs.gov/data/pager/
 * - USGS "sig" field documentation: https://earthquake.usgs.gov/fdsnws/event/1/
 * - NASA EONET API v3: https://eonet.gsfc.nasa.gov/docs/v3
 * - GDELT 2.0 Event Database Codebook: https://www.gdeltproject.org/data/documentation/GDELT-Event_Codebook-V2.0.pdf
 * - ACLED severity methodology (time-decay + log normalisation): https://acleddata.com/acleddatanerd/
 *
 * NO importa @www/store — funciones puras, primitivas → number (T-09 constraint).
 */

// ─── Utilidades internas ─────────────────────────────────────────────────────

/** Pinza un número al rango [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** log1p normalizado: log(1 + value) / log(1 + maxVal), resultado en [0,1]. */
function logNorm(value: number, maxVal: number): number {
  if (maxVal <= 0 || value <= 0) return 0;
  return Math.log1p(value) / Math.log1p(maxVal);
}

// ─── severityUsgs ─────────────────────────────────────────────────────────────

/**
 * Parámetros de entrada USGS:
 * - sig:     índice de significancia USGS (0..1000+). Combina magnitud + impacto
 *            humano (felt reports, PAGER). Es la métrica más integral disponible.
 * - mag:     magnitud Richter/MMS. Fallback si sig no está disponible.
 * - alert:   nivel PAGER institucional ('green'|'yellow'|'orange'|'red').
 *            Representa la estimación oficial de víctimas/daño (FEMA/USGS PAGER).
 * - tsunami: 1 si el terremoto generó alerta de tsunami.
 */
export interface UsgsParams {
  // `| undefined` explícito: exactOptionalPropertyTypes — los conectores pasan
  // properties.<campo> que es `number | undefined` (campo ausente en el payload).
  mag?: number | undefined;
  sig?: number | undefined;
  alert?: string | undefined;
  tsunami?: number | undefined;
}

/**
 * Mapea parámetros USGS a severity 0..100.
 *
 * Lógica (criterios gradeables):
 * 1. BASE: sig/10 acotado a [0,90].
 *    - Criterio: sig~100 → 10pts (evento menor), sig~500 → 50pts (M5-6),
 *      sig~900 → 90pts (M7+, gran impacto). sig/10 es lineal dentro del rango
 *      natural (0..1000) y lo aplana suavemente en el techo de 90 (reservamos
 *      el rango 90-100 para la combinación con alert=red + otros factores).
 *    - Si sig no está disponible: base = clamp(0, 90, mag * 10).
 *      Criterio: mag 0.0→0, mag 4.0→40, mag 6.0→60, mag 9.0→90.
 *      La escala Richter no es lineal en energía, pero para severity perceptual
 *      una escala lineal ×10 refleja bien los rangos de impacto social.
 *
 * 2. PISO por alert PAGER (institucional, no editable sin ADR):
 *    - yellow → piso 40 (daño leve estimado, respuesta local activada)
 *    - orange → piso 65 (daño moderado, respuesta regional)
 *    - red    → piso 85 (catastrófico, respuesta internacional)
 *    - green/null → sin piso (evento pequeño confirmado o sin evaluación)
 *    El piso actúa como floor: severity = max(base, piso).
 *
 * 3. TSUNAMI boost: +10 si tsunami=1.
 *    - Criterio: un tsunami activa riesgo costero independiente del sig sísmico.
 *      El boost es discreto porque su impacto en poblaciones costeras supera
 *      lo que el sig terrestre refleja.
 *
 * 4. CLAMP DURO [0, 100].
 */
export function severityUsgs(p: UsgsParams): number {
  // 1. Base por sig o mag
  let base: number;
  if (p.sig !== undefined && p.sig >= 0) {
    // sig: 0..1000+ → 0..90 (lineal, techo en 90)
    base = clamp(p.sig / 10, 0, 90);
  } else if (p.mag !== undefined) {
    // mag fallback: mag 0..9 → severity 0..90
    base = clamp(p.mag * 10, 0, 90);
  } else {
    base = 0;
  }

  // 2. Piso por alert PAGER
  const alertFloors: Record<string, number> = {
    yellow: 40,
    orange: 65,
    red: 85,
  };
  const alert = p.alert?.toLowerCase() ?? 'green';
  const floor = alertFloors[alert] ?? 0;
  let score = Math.max(base, floor);

  // 3. Tsunami boost
  if (p.tsunami === 1) {
    score += 10;
  }

  // 4. Clamp duro
  return clamp(score, 0, 100);
}

// ─── severityEonet ────────────────────────────────────────────────────────────

/**
 * Bandas base por tipo de evento EONET (re-derivadas, valores propios).
 *
 * Criterio de las bandas:
 * - volcano: 55 base. Las erupciones volcánicas tienen impacto local-regional
 *   independientemente del magnitudeValue (que puede ser null). La categoría
 *   por sí sola implica un riesgo elevado de desplazamiento y daño.
 * - severeStorm/wildfire: 45 base. Alto potencial de víctimas y daño material.
 * - flood/landslide: 40 base. Impacto humanitario directo, con escalada rápida.
 * - drought/tempExtreme: 30 base. Impacto diferido, importante pero menos agudo.
 * - earthquake (EONET): 35 base. DESCARTADO por los conectores (USGS es la fuente
 *   sísmica), pero si llegara un dato EONET sísmico lo tratamos conservadoramente.
 * - dustHaze/snow/seaLakeIce/waterColor: 15 base. Impacto humano bajo en general.
 * - manmade: 20 base. Categoría residual heterogénea.
 * - default: 20 base. Categoría desconocida → conservador.
 *
 * Más componente log del magnitudeValue dentro de su unidad (ver función).
 */
const EONET_BASE: Record<string, number> = {
  volcano: 55,
  severeStorm: 45,
  wildfire: 45,
  flood: 40,
  landslide: 40,
  drought: 30,
  tempExtreme: 30,
  earthquake: 35,   // EONET earthquakes descartados en el conector, pero defensive
  dustHaze: 15,
  snow: 15,
  seaLakeIce: 15,
  waterColor: 15,
  manmade: 20,
};

/**
 * Techo logarítmico de referencia por unidad.
 *
 * El magnitudeValue sin normalizar por unidad no es comparable (acres ≠ mb ≠ ha).
 * Para cada unidad definimos el valor de referencia que consideramos "máximo
 * observable razonable" en el contexto de un evento individual. El componente log
 * aporta hasta +30 puntos (escalado desde logNorm × 30).
 *
 * Criterios:
 * - Acres (wildfire): ~1 000 000 acres = incendio histórico (Bootleg Fire 2021: 413k acres)
 * - Hectáreas: ~500 000 ha (equivalente a ~1.2M acres; incendios amazónicos)
 * - mb (storm pressure): referencia mínima ~870 mb (tifón Tip), rango útil 870..1013.
 *   Usamos la anomalía: (1013 - mb) como proxy de intensidad, referencia 143.
 * - km²: 100 000 km² como referencia de superficie afectada grande
 * - kph (wind): 300 kph como techo (huracanes cat 5 máximos conocidos ~315 kph)
 * - Default: valor bruto log-normalizado con referencia 1000.
 */
const MAGNITUDE_REF: Record<string, number> = {
  acres: 1_000_000,
  hectares: 500_000,
  'km²': 100_000,
  kph: 300,
  // mb se trata de forma especial (anomalía) abajo
  default: 1000,
};

/**
 * Mapea un evento EONET a severity 0..100.
 *
 * Lógica:
 * 1. BASE por categoría (banda editorial propia, tabla EONET_BASE).
 * 2. COMPONENTE LOG del magnitudeValue, normalizado dentro de su unidad.
 *    La normalización log es idónea para magnitudes que abarcan órdenes de
 *    magnitud (estilo ACLED para n_fatalities). Aporta hasta +30 pts.
 *    Si magnitudeValue o magnitudeUnit están ausentes, el componente es 0.
 * 3. CLAMP DURO [0, 100].
 */
export function severityEonet(
  eventType: string,
  magnitudeValue?: number,
  magnitudeUnit?: string,
): number {
  const base = EONET_BASE[eventType] ?? 20;

  let logComponent = 0;
  if (
    magnitudeValue !== undefined &&
    magnitudeValue !== null &&
    magnitudeValue > 0 &&
    magnitudeUnit !== undefined &&
    magnitudeUnit !== null
  ) {
    const unit = magnitudeUnit.toLowerCase().trim();
    if (unit === 'mb') {
      // Para presión mb: la anomalía respecto al estándar (1013.25 mb) es el proxy
      // de intensidad ciclónica. A menor mb, mayor intensidad. Referencia: 143 mb
      // (diferencia entre presión estándar y el récord histórico ~870 mb).
      const anomaly = Math.max(0, 1013.25 - magnitudeValue);
      logComponent = logNorm(anomaly, 143) * 30;
    } else {
      const ref = MAGNITUDE_REF[unit] ?? MAGNITUDE_REF['default']!;
      logComponent = logNorm(magnitudeValue, ref) * 30;
    }
  }

  return clamp(base + logComponent, 0, 100);
}

// ─── severityGdelt ────────────────────────────────────────────────────────────

/**
 * Parámetros de entrada GDELT (GDELT 2.0 Event Codebook):
 * - quadClass:  1=verbal-cooperación, 2=material-cooperación,
 *               3=verbal-conflicto, 4=material-conflicto.
 *               Es la clasificación ordinal de hostilidad más usable.
 * - goldstein:  escala de impacto teórico del evento (-10..+10).
 *               Valores negativos = mayor conflicto/inestabilidad.
 * - avgTone:    tono promedio de los artículos fuente (-100..+100).
 *               Usualmente negativo en eventos violentos.
 */
export interface GdeltParams {
  // `| undefined` explícito: exactOptionalPropertyTypes (igual que UsgsParams).
  quadClass?: number | undefined;
  goldstein?: number | undefined;
  avgTone?: number | undefined;
}

/**
 * Base por QuadClass (re-derivada).
 *
 * Criterio:
 * - QuadClass 1 (verbal-coop): 10. Diplomacia, acuerdos, cooperación → mínima tensión.
 * - QuadClass 2 (material-coop): 20. Ayuda, intercambio → impacto positivo, baja alarma.
 * - QuadClass 3 (verbal-conf): 50. Amenazas, acusaciones → tensión política relevante.
 * - QuadClass 4 (material-conf): 75. Violencia, asalto, guerra → mayor impacto directo.
 *
 * Escala: los saltos no son lineales porque el salto de verbal a material-conflicto
 * es cualitativamente más grande que entre los niveles de cooperación.
 */
const QUAD_BASE: Record<number, number> = {
  1: 10,
  2: 20,
  3: 50,
  4: 75,
};

/**
 * Mapea parámetros GDELT a severity 0..100.
 *
 * Lógica (criterios gradeables):
 * 1. BASE por QuadClass (tabla QUAD_BASE). Default 20 si QuadClass ausente o fuera de rango.
 *
 * 2. COMPONENTE GOLDSTEIN: solo la parte negativa contribuye.
 *    goldsteinNeg = max(0, -goldstein)   ∈ [0, 10]
 *    Contribución = goldsteinNeg * 1.5   → hasta +15 pts.
 *    Criterio: el extremo negativo (-10) es el máximo de inestabilidad teórica
 *    del codebook GDELT. Multiplicador 1.5 para que aporte hasta 15 pts sin
 *    dominar la base (QuadClass es el factor primario).
 *
 * 3. COMPONENTE AVGTONE: solo la parte negativa contribuye.
 *    tonNeg = max(0, -avgTone)           ∈ [0, 100+]
 *    Contribución = clamp(tonNeg / 5, 0, 10) → hasta +10 pts.
 *    Criterio: AvgTone varía de ~-100 a ~+100; dividir entre 5 da un rango de
 *    aportación de 0..20, pero lo acotamos a 10 para que el tono no supere
 *    el peso del conflicto real (QuadClass).
 *
 * 4. CLAMP DURO [0, 100].
 */
export function severityGdelt(p: GdeltParams): number {
  // 1. Base por QuadClass
  const base = QUAD_BASE[p.quadClass ?? 0] ?? 20;

  // 2. Componente Goldstein (negativo = mayor conflicto)
  const goldsteinNeg = Math.max(0, -(p.goldstein ?? 0));
  const goldsteinContrib = goldsteinNeg * 1.5; // [0, 15]

  // 3. Componente AvgTone (negativo = mayor hostilidad)
  const toneNeg = Math.max(0, -(p.avgTone ?? 0));
  const toneContrib = clamp(toneNeg / 5, 0, 10); // [0, 10]

  const score = base + goldsteinContrib + toneContrib;
  return clamp(score, 0, 100);
}
