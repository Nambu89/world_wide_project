/**
 * score.ts — Motor de scoring CII (T-23)
 *
 * Implementa los 4 componentes del CII + blend + dynamic + orquestador.
 * Metodología re-derivada propia — no copia de fuente AGPL.
 *
 * Metodología documentada:
 * - ACLED time-decay: https://acleddata.com/acleddatanerd/
 * - ICRG baseline: https://www.prsgroup.com/explore-our-products/icrg/
 * - IMF Vulnerability Exercise (economic component): https://www.imf.org/
 *
 * Criterios gradeables:
 * - composite ∈ [0, 100] (clamp duro sobre cualquier input)
 * - eventScore = blend EVENT_WEIGHTS RENORMALIZADO sobre componentes con signalPresent=true
 * - weights efectivos suman exactamente 1 sobre presentes (invariante de test)
 * - floor = coeff.baselineRisk × FLOOR_FACTORS[key] cuando no hay eventos
 * - quadClass/goldstein de rawJson GDELT elevan el score de conflicto (gradeable)
 */

import type { EventRow, SignalRow } from '@www/store';
import { getEventsByCountry, getSignals } from '@www/store';

import {
  EVENT_WEIGHTS,
  FLOOR_FACTORS,
  COMPOSITE,
  DECAY_HALF_LIFE_MS,
  decayWeight,
  BOOST,
  ECONOMIC_SECTIONS,
  SOCIAL_MIX,
  type CiiComponentKey,
} from './blend.config.js';

import {
  COUNTRY_COEFFS,
  DEFAULT_COEFF,
  type CountryCoeff,
} from './coefficients.js';

import { normalizeCountryKey } from './country-key.js';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CiiComponent {
  key: CiiComponentKey;
  /** Score normalizado [0, 100] para esta componente. */
  score: number;
  /** true si hay datos reales (eventos/señales) para esta componente en la ventana. */
  signalPresent: boolean;
  /** Peso nominal de la componente en el blend (EVENT_WEIGHTS[key]). */
  weight: number;
  /** Fuentes de datos que contribuyen al score. */
  sources: string[];
  /** Detalle opcional para auditoría. */
  detail?: string;
}

export interface CiiScore {
  country: string;
  composite: number;          // [0, 100]
  baselineRisk: number;       // baselineRisk del CountryCoeff
  eventScore: number;         // [0, 100] blend renormalizado
  components: CiiComponent[];
  methodologyVersion: string;
  capturedAt: number;
}

export interface CiiDynamic {
  country: string;
  /** Delta composite vs prior snapshot, clamped [-100, 100]. 0 si no hay prior. */
  dynamicScore: number;
  trend: 'rising' | 'falling' | 'stable';
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Clamp un valor al rango [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Calcula el promedio time-decayed de una lista de eventos.
 * Usa `occurredAt` con fallback a `capturedAt` para calcular la edad.
 * Eventos sin severity se excluyen del promedio.
 *
 * Criterio: retorna null si no hay eventos con severity.
 */
function timeDecayedAvgSeverity(events: EventRow[], nowMs: number): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const ev of events) {
    if (ev.severity === null) continue;
    const ts = ev.occurredAt ?? ev.capturedAt;
    const ageMs = Math.max(0, nowMs - ts);
    const w = decayWeight(ageMs);
    weightedSum += ev.severity * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

/**
 * Parsea el rawJson de un evento GDELT para extraer quadClass y goldstein.
 * rawJson shape: { quadClass: number, goldstein: number|null, avgTone: number|null, ... }
 * Retorna null si el rawJson está ausente o no parsea.
 */
function parseGdeltRaw(rawJson: string | null): { quadClass: number; goldstein: number | null } | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const quadClass = typeof parsed['quadClass'] === 'number' ? parsed['quadClass'] : 0;
    const goldstein = typeof parsed['goldstein'] === 'number' ? parsed['goldstein'] : null;
    return { quadClass, goldstein };
  } catch {
    return null;
  }
}

/**
 * Calcula el time-decayed average de señales GKG usando |tone| como intensidad
 * y volumen (cada señal con datos es una observación).
 *
 * Criterio: señales con tone=null contribuyen con peso=0 en intensidad pero
 * incrementan la cuenta de volumen (presencia de señal aunque sin tone).
 * Retorna { score: 0..100, count } — count = nº de señales con datos.
 */
function timeDecayedSignalIntensity(signals: SignalRow[], nowMs: number): { score: number; count: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  let count = 0;

  for (const sig of signals) {
    const ts = sig.occurredAt ?? sig.capturedAt;
    const ageMs = Math.max(0, nowMs - ts);
    const w = decayWeight(ageMs);
    count++;
    // |tone| ∈ [0, 100] (AvgTone GDELT rango real aprox -100..+100)
    // tono negativo → mayor estrés → eleva el score
    const intensity = sig.tone !== null ? Math.min(100, Math.abs(sig.tone)) : 0;
    weightedSum += intensity * w;
    totalWeight += w;
  }

  if (totalWeight === 0 || count === 0) return { score: 0, count };
  return { score: clamp(weightedSum / totalWeight, 0, 100), count };
}

// ─── 4 Componentes ───────────────────────────────────────────────────────────

/**
 * computeConflictComponent — Componente de conflicto.
 *
 * Score base = promedio time-decayed de severity de eventos category='conflict'.
 * Sesgo rawJson GDELT: si quadClass === 4 O goldstein <= -7 (escala -10..+10),
 * se aplica un factor multiplicador de intensidad (1.2) acotado al clamp final.
 *
 * Criterio gradeable:
 * - 0 eventos → score = floor (baselineRisk × FLOOR_FACTORS.conflict), signalPresent=false
 * - >0 eventos con severity → score ∈ [floor, 100], signalPresent=true
 * - rawJson con quadClass=4 eleva el score vs quadClass=1 con misma severity
 */
export function computeConflictComponent(
  events: EventRow[],
  coeff: CountryCoeff,
  nowMs: number,
): CiiComponent {
  const floor = clamp(coeff.baselineRisk * FLOOR_FACTORS.conflict, 0, 100);

  const conflictEvents = events.filter((e) => e.category === 'conflict');
  if (conflictEvents.length === 0) {
    return {
      key: 'conflict',
      score: floor,
      signalPresent: false,
      weight: EVENT_WEIGHTS.conflict,
      sources: ['events:conflict'],
      detail: `floor=${floor.toFixed(1)} (sin eventos de conflicto)`,
    };
  }

  const avg = timeDecayedAvgSeverity(conflictEvents, nowMs);
  if (avg === null) {
    // Hay eventos pero todos sin severity → floor
    return {
      key: 'conflict',
      score: floor,
      signalPresent: false,
      weight: EVENT_WEIGHTS.conflict,
      sources: ['events:conflict'],
      detail: `floor=${floor.toFixed(1)} (${conflictEvents.length} eventos, todos sin severity)`,
    };
  }

  // Sesgo GDELT: calcula intensidad media de los eventos con rawJson GDELT
  // QuadClass 4 (material conflict) y goldstein muy negativo (≤ -7) son los
  // indicadores de conflicto severo más fiables del codebook GDELT v2.
  let intensityBias = 1.0;
  let gdeltCount = 0;
  let highIntensityCount = 0;

  for (const ev of conflictEvents) {
    if (ev.source !== 'gdelt') continue;
    const raw = parseGdeltRaw(ev.rawJson);
    if (!raw) continue;
    gdeltCount++;
    if (raw.quadClass === 4 || (raw.goldstein !== null && raw.goldstein <= -7)) {
      highIntensityCount++;
    }
  }

  if (gdeltCount > 0) {
    // Proporción de eventos de alta intensidad → sesgo lineal hasta 1.2
    const highProportion = highIntensityCount / gdeltCount;
    intensityBias = 1.0 + 0.2 * highProportion;
  }

  const raw = clamp(avg * intensityBias * coeff.eventMultiplier, 0, 100);
  const score = clamp(Math.max(floor, raw), 0, 100);

  return {
    key: 'conflict',
    score,
    signalPresent: true,
    weight: EVENT_WEIGHTS.conflict,
    sources: ['events:conflict'],
    detail: `avg_decay=${avg.toFixed(1)} bias=${intensityBias.toFixed(2)} mult=${coeff.eventMultiplier} floor=${floor.toFixed(1)}`,
  };
}

/**
 * computeSocialComponent — Componente social.
 *
 * Mezcla SOCIAL_MIX (EVENTS_W 0.6 + GKG_W 0.4):
 * - EVENTS: promedio time-decayed de severity de protestEvents
 * - GKG:    intensidad time-decayed de gkgPolitical (|tone| como proxy de tensión)
 * Aplica boosts EQ/fire aditivos acotados por BOOST caps.
 *
 * Criterio gradeable:
 * - 0 eventos Y 0 señales → score = floor, signalPresent=false
 * - boost earthquake acotado a BOOST.EARTHQUAKE_CAP
 * - boost fire acotado a BOOST.FIRE_CAP
 * - boost combinado acotado a BOOST.COMBINED_CAP
 */
export function computeSocialComponent(
  protestEvents: EventRow[],
  gkgPolitical: SignalRow[],
  boosts: { earthquakeSeverity: number; fireSeverity: number },
  coeff: CountryCoeff,
  nowMs: number,
): CiiComponent {
  const floor = clamp(coeff.baselineRisk * FLOOR_FACTORS.social, 0, 100);

  // Sub-señal eventos (protesta)
  const eventAvg = timeDecayedAvgSeverity(protestEvents, nowMs) ?? 0;
  const { score: gkgScore, count: gkgCount } = timeDecayedSignalIntensity(gkgPolitical, nowMs);

  const hasSignal = protestEvents.length > 0 || gkgCount > 0;

  if (!hasSignal) {
    return {
      key: 'social',
      score: floor,
      signalPresent: false,
      weight: EVENT_WEIGHTS.social,
      sources: ['events:protest', 'signals:political_instability'],
      detail: `floor=${floor.toFixed(1)} (sin eventos ni señales GKG)`,
    };
  }

  // Blend SOCIAL_MIX
  const blendedBase = eventAvg * SOCIAL_MIX.EVENTS_W + gkgScore * SOCIAL_MIX.GKG_W;

  // Boosts naturales (EQ/fire) — aditivos sobre el subscore social
  // Criterio: la tensión social aumenta ante catástrofes naturales, pero el cap
  // evita que el boost distorsione un scoring político/social real.
  const eqBoost = clamp(
    (boosts.earthquakeSeverity / 100) * BOOST.EARTHQUAKE_CAP,
    0,
    BOOST.EARTHQUAKE_CAP,
  );
  const fireBoost = clamp(
    (boosts.fireSeverity / 100) * BOOST.FIRE_CAP,
    0,
    BOOST.FIRE_CAP,
  );
  const combinedBoost = clamp(eqBoost + fireBoost, 0, BOOST.COMBINED_CAP);

  const raw = clamp((blendedBase + combinedBoost) * coeff.eventMultiplier, 0, 100);
  const score = clamp(Math.max(floor, raw), 0, 100);

  return {
    key: 'social',
    score,
    signalPresent: true,
    weight: EVENT_WEIGHTS.social,
    sources: ['events:protest', 'signals:political_instability'],
    detail: `eventAvg=${eventAvg.toFixed(1)} gkgScore=${gkgScore.toFixed(1)} combinedBoost=${combinedBoost.toFixed(1)} floor=${floor.toFixed(1)}`,
  };
}

/**
 * computeEconomicComponent — Componente económica.
 *
 * Agrega señales GKG de ECONOMIC_SECTIONS con time-decay.
 * Tono medio NEGATIVO eleva el subscore (estrés económico correlaciona con tone negativo).
 * globalTemp actúa como piso suave (D-202): la media global de tensión económica
 * eleva el floor cuando no hay señales del país específico.
 *
 * Criterio gradeable:
 * - 0 señales → score = max(floor, globalTemp * 0.3), signalPresent=false
 * - tono muy negativo (< -20) eleva el score vs tono neutro (gradeable)
 */
export function computeEconomicComponent(
  gkgEconomic: SignalRow[],
  globalTemp: number,
  coeff: CountryCoeff,
  nowMs: number,
): CiiComponent {
  const floor = clamp(coeff.baselineRisk * FLOOR_FACTORS.economic, 0, 100);
  // Piso suave D-202: globalTemp eleva ligeramente el floor cuando hay estrés global
  const softFloor = clamp(Math.max(floor, globalTemp * 0.3), 0, 100);

  const { score: rawIntensity, count } = timeDecayedSignalIntensity(gkgEconomic, nowMs);

  if (count === 0) {
    return {
      key: 'economic',
      score: softFloor,
      signalPresent: false,
      weight: EVENT_WEIGHTS.economic,
      sources: ['signals:commodities_energy', 'signals:trade_sanctions', 'signals:critical_minerals'],
      detail: `floor=${softFloor.toFixed(1)} (sin señales económicas; globalTemp=${globalTemp.toFixed(1)})`,
    };
  }

  const raw = clamp(rawIntensity * coeff.eventMultiplier, 0, 100);
  const score = clamp(Math.max(softFloor, raw), 0, 100);

  return {
    key: 'economic',
    score,
    signalPresent: true,
    weight: EVENT_WEIGHTS.economic,
    sources: ['signals:commodities_energy', 'signals:trade_sanctions', 'signals:critical_minerals'],
    detail: `intensity=${rawIntensity.toFixed(1)} n=${count} softFloor=${softFloor.toFixed(1)} globalTemp=${globalTemp.toFixed(1)}`,
  };
}

/**
 * computePoliticalComponent — Componente política.
 *
 * Señales GKG political_instability: intensidad time-decayed + |tone| como proxy.
 * globalInfoTemp (promedio global de political_instability) actúa como modulador
 * suave del floor (D-202).
 *
 * Criterio gradeable:
 * - 0 señales → score = max(floor, globalInfoTemp * 0.25), signalPresent=false
 */
export function computePoliticalComponent(
  gkgPolitical: SignalRow[],
  globalInfoTemp: number,
  coeff: CountryCoeff,
  nowMs: number,
): CiiComponent {
  const floor = clamp(coeff.baselineRisk * FLOOR_FACTORS.political, 0, 100);
  const softFloor = clamp(Math.max(floor, globalInfoTemp * 0.25), 0, 100);

  const { score: rawIntensity, count } = timeDecayedSignalIntensity(gkgPolitical, nowMs);

  if (count === 0) {
    return {
      key: 'political',
      score: softFloor,
      signalPresent: false,
      weight: EVENT_WEIGHTS.political,
      sources: ['signals:political_instability'],
      detail: `floor=${softFloor.toFixed(1)} (sin señales políticas; globalInfoTemp=${globalInfoTemp.toFixed(1)})`,
    };
  }

  const raw = clamp(rawIntensity * coeff.eventMultiplier, 0, 100);
  const score = clamp(Math.max(softFloor, raw), 0, 100);

  return {
    key: 'political',
    score,
    signalPresent: true,
    weight: EVENT_WEIGHTS.political,
    sources: ['signals:political_instability'],
    detail: `intensity=${rawIntensity.toFixed(1)} n=${count} softFloor=${softFloor.toFixed(1)} globalInfoTemp=${globalInfoTemp.toFixed(1)}`,
  };
}

// ─── computeCii — composite ───────────────────────────────────────────────────

/**
 * computeCii — calcula el CiiScore final para un país.
 *
 * eventScore = blend EVENT_WEIGHTS RENORMALIZADO sobre componentes con signalPresent=true.
 * Si ninguna componente tiene signalPresent=true → eventScore = 0.
 *
 * Renormalización: los pesos efectivos se escalan para que sumen 1 sobre los componentes
 * presentes. Así el eventScore no colapsa artificialmente cuando faltan datos de una dimensión.
 *
 * composite = clamp(baselineRisk × BASELINE_W + eventScore × EVENT_W, 0, 100)
 *
 * Criterio gradeable:
 * - composite ∈ [0, 100] sobre cualquier input
 * - pesos efectivos de componentes presentes suman 1 (invariante de test)
 * - methodologyVersion = 'cii-core-1'
 */
export function computeCii(
  country: string,
  components: CiiComponent[],
  coeff: CountryCoeff,
  methodologyVersion: string,
  capturedAt: number,
): CiiScore {
  // Renormalización sobre componentes presentes
  const presentComponents = components.filter((c) => c.signalPresent);
  const totalPresentWeight = presentComponents.reduce((acc, c) => acc + c.weight, 0);

  let eventScore: number;
  if (totalPresentWeight === 0 || presentComponents.length === 0) {
    eventScore = 0;
  } else {
    // Suma ponderada renormalizada
    const weightedSum = presentComponents.reduce((acc, c) => acc + c.score * c.weight, 0);
    eventScore = clamp(weightedSum / totalPresentWeight, 0, 100);
  }

  const composite = clamp(
    coeff.baselineRisk * COMPOSITE.BASELINE_W + eventScore * COMPOSITE.EVENT_W,
    0,
    100,
  );

  return {
    country,
    composite,
    baselineRisk: coeff.baselineRisk,
    eventScore,
    components,
    methodologyVersion,
    capturedAt,
  };
}

// ─── computeDynamic ───────────────────────────────────────────────────────────

/**
 * computeDynamic — calcula el delta y trend vs snapshot previo.
 *
 * dynamicScore = prior ? clamp(-100, 100, current.composite - prior.composite) : 0
 * trend deadband: |d| <= 1 → 'stable'; d >= 2 → 'rising'; d <= -2 → 'falling'
 *
 * Criterio gradeable:
 * - prior=null → dynamicScore=0, trend='stable'
 * - delta=+5 → trend='rising'
 * - delta=-3 → trend='falling'
 * - delta=+1 → trend='stable' (deadband)
 */
export function computeDynamic(
  current: CiiScore,
  prior: CiiScore | null,
): CiiDynamic {
  if (prior === null) {
    return { country: current.country, dynamicScore: 0, trend: 'stable' };
  }

  const delta = clamp(current.composite - prior.composite, -100, 100);

  let trend: 'rising' | 'falling' | 'stable';
  if (Math.abs(delta) <= 1) {
    trend = 'stable';
  } else if (delta >= 2) {
    trend = 'rising';
  } else {
    trend = 'falling';
  }

  return { country: current.country, dynamicScore: delta, trend };
}

// ─── computeAllCountries — orquestador ───────────────────────────────────────

/**
 * computeAllCountries — Orquestador principal del motor CII.
 *
 * Flujo:
 * 1. Lee eventos desde getEventsByCountry(sinceMs) — ventana = DECAY_HALF_LIFE_MS.
 * 2. Lee señales GKG por sección.
 * 3. RE-AGRUPA por clave canónica (OQ-2/L-7):
 *    - eventos: normalizeCountryKey(event.country, event.source) → fusiona
 *      'JA'(gdelt) + 'Japan'(usgs) en 'Japan'
 *    - signals: normalizeCountryKey(signal.country, 'gdelt') (GKG usa FIPS)
 *    - signals sin país → globalTemp / globalInfoTemp (D-202, no se atribuyen)
 * 4. Por cada país canónico: calcula 4 componentes → computeCii.
 * 5. Descarta country === '' (país desconocido).
 *
 * @param nowMs  Timestamp de referencia (epoch ms). Generalmente Date.now().
 * @returns      Array de CiiScore, uno por país canónico con datos en la ventana.
 */
export async function computeAllCountries(nowMs: number): Promise<CiiScore[]> {
  const sinceMs = nowMs - DECAY_HALF_LIFE_MS;

  // ── Paso 1: Carga de eventos ──────────────────────────────────────────────
  const rawEventsByCountry = await getEventsByCountry(sinceMs);

  // ── Paso 2: Carga de señales GKG ─────────────────────────────────────────
  const [
    sigEconEnergy,
    sigEconTrade,
    sigEconMinerals,
    sigPolitical,
  ] = await Promise.all([
    getSignals({ section: 'commodities_energy', sinceMs }),
    getSignals({ section: 'trade_sanctions', sinceMs }),
    getSignals({ section: 'critical_minerals', sinceMs }),
    getSignals({ section: 'political_instability', sinceMs }),
  ]);

  const allEconomicSignals = [...sigEconEnergy, ...sigEconTrade, ...sigEconMinerals];
  const allPoliticalSignals = sigPolitical;

  // ── Paso 3a: RE-AGRUPA eventos por clave canónica (L-7) ──────────────────
  // Itera el Map raw (clave = country crudo de la DB) y normaliza cada evento.
  const canonicalEvents = new Map<string, EventRow[]>();

  for (const [_rawCountry, events] of rawEventsByCountry) {
    for (const ev of events) {
      // normalizeCountryKey necesita la fuente real del evento
      const rawCountry = ev.country ?? '';
      const source = ev.source as 'gdelt' | 'usgs' | 'eonet';
      const key = normalizeCountryKey(rawCountry, source);
      if (key === '') continue; // descarta sin país

      const bucket = canonicalEvents.get(key);
      if (bucket !== undefined) {
        bucket.push(ev);
      } else {
        canonicalEvents.set(key, [ev]);
      }
    }
  }

  // ── Paso 3b: RE-AGRUPA señales GKG por clave canónica ────────────────────
  // GKG usa FIPS → tratamos como 'gdelt' para la normalización.
  // Señales sin país → globalTemp/globalInfoTemp (no se atribuyen a un país).
  const canonicalEconomicSignals = new Map<string, SignalRow[]>();
  const canonicalPoliticalSignals = new Map<string, SignalRow[]>();

  const globalEconomicSignals: SignalRow[] = [];
  const globalPoliticalSignals: SignalRow[] = [];

  for (const sig of allEconomicSignals) {
    const rawCountry = sig.country ?? '';
    if (rawCountry === '') {
      globalEconomicSignals.push(sig);
      continue;
    }
    const key = normalizeCountryKey(rawCountry, 'gdelt');
    if (key === '') {
      globalEconomicSignals.push(sig);
      continue;
    }
    const bucket = canonicalEconomicSignals.get(key);
    if (bucket !== undefined) {
      bucket.push(sig);
    } else {
      canonicalEconomicSignals.set(key, [sig]);
    }
  }

  for (const sig of allPoliticalSignals) {
    const rawCountry = sig.country ?? '';
    if (rawCountry === '') {
      globalPoliticalSignals.push(sig);
      continue;
    }
    const key = normalizeCountryKey(rawCountry, 'gdelt');
    if (key === '') {
      globalPoliticalSignals.push(sig);
      continue;
    }
    const bucket = canonicalPoliticalSignals.get(key);
    if (bucket !== undefined) {
      bucket.push(sig);
    } else {
      canonicalPoliticalSignals.set(key, [sig]);
    }
  }

  // ── Paso 3c: globalTemp / globalInfoTemp (D-202) ─────────────────────────
  // Promedio de |tone| de las señales globales (sin país) como piso suave.
  const { score: globalTemp } = timeDecayedSignalIntensity(globalEconomicSignals, nowMs);
  const { score: globalInfoTemp } = timeDecayedSignalIntensity(globalPoliticalSignals, nowMs);

  // ── Paso 4: Calcula CII por país canónico ─────────────────────────────────
  // Unión de países con eventos O señales GKG asignadas.
  const allCountries = new Set<string>([
    ...canonicalEvents.keys(),
    ...canonicalEconomicSignals.keys(),
    ...canonicalPoliticalSignals.keys(),
  ]);

  const results: CiiScore[] = [];

  for (const country of allCountries) {
    const events = canonicalEvents.get(country) ?? [];
    const econSignals = canonicalEconomicSignals.get(country) ?? [];
    const polSignals = canonicalPoliticalSignals.get(country) ?? [];

    // Eventos de conflicto y protesta
    const conflictEvents = events.filter((e) => e.category === 'conflict');
    const protestEvents = events.filter((e) => e.eventType === 'protest');

    // Boosts naturales: max severity de terremoto/incendio del país en la ventana
    const earthquakeSeverity = Math.max(
      0,
      ...events
        .filter((e) => e.eventType === 'earthquake' && e.severity !== null)
        .map((e) => e.severity as number),
    );
    const fireSeverity = Math.max(
      0,
      ...events
        .filter((e) => e.eventType === 'wildfire' && e.severity !== null)
        .map((e) => e.severity as number),
    );

    const coeff = COUNTRY_COEFFS[country] ?? DEFAULT_COEFF;

    const conflictComp = computeConflictComponent(conflictEvents, coeff, nowMs);
    const socialComp = computeSocialComponent(
      protestEvents,
      polSignals,
      { earthquakeSeverity, fireSeverity },
      coeff,
      nowMs,
    );
    const economicComp = computeEconomicComponent(econSignals, globalTemp, coeff, nowMs);
    const politicalComp = computePoliticalComponent(polSignals, globalInfoTemp, coeff, nowMs);

    const score = computeCii(
      country,
      [conflictComp, socialComp, economicComp, politicalComp],
      coeff,
      'cii-core-1',
      nowMs,
    );

    results.push(score);
  }

  return results;
}

// Re-exporta helpers usados en tests
export { timeDecayedAvgSeverity as _timeDecayedAvgSeverity };
