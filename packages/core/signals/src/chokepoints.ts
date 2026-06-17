/**
 * chokepoints.ts — chokepoint disruption detection (slice A).
 * Pure scorer (scoreChokepoints) + IO orchestrator (detectAllChokepoints).
 * Methodology D-602: hybrid proximity (events+signals) + GKG name/entity match,
 * weighted blend → 0..1 score → status bands. 72h window.
 */

import { getEvents, getSignals, type EventRow, type SignalRow, type ChokepointStatusRow } from '@www/store';
import {
  CHOKEPOINTS, CHOKEPOINT_WINDOW_MS, CHOKEPOINT_WEIGHTS, CHOKEPOINT_SAT, CHOKEPOINT_BANDS,
  EVENT_SEVERITY_FLOOR,
  type ChokepointConfig,
} from './chokepoints.config.js';

/** Great-circle distance in km (Haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const DISRUPTIVE = new Set(['conflict', 'protest']);

/** Escape a string for safe inclusion in a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary alias match (case-insensitive). Avoids substring false positives
 * like 'dover' matching 'Andover'/'handover' — the bare 'dover'-style ambiguous
 * aliases were also dropped from the config (L-5 calibration).
 */
function aliasMatch(sig: SignalRow, aliases: string[]): boolean {
  const hay = `${sig.title ?? ''} ${sig.themes ?? ''} ${sig.persons ?? ''} ${sig.organizations ?? ''}`.toLowerCase();
  return aliases.some((a) => new RegExp(`(^|[^a-z0-9])${escapeRe(a.toLowerCase())}([^a-z0-9]|$)`).test(hay));
}

function bandFor(score: number): ChokepointStatusRow['status'] {
  if (score >= CHOKEPOINT_BANDS.disrupted) return 'disrupted';
  if (score >= CHOKEPOINT_BANDS.watch) return 'watch';
  return 'calm';
}

/**
 * Pure scorer: given recent events + signals, score every chokepoint.
 * Returns one ChokepointStatusRow per CHOKEPOINTS entry (capturedAt = nowMs).
 */
export function scoreChokepoints(events: EventRow[], signals: SignalRow[], nowMs: number): ChokepointStatusRow[] {
  const since = nowMs - CHOKEPOINT_WINDOW_MS;
  const freshEvents = events.filter(
    (e) =>
      e.capturedAt >= since &&
      DISRUPTIVE.has(e.eventType) &&
      (e.severity ?? 0) >= EVENT_SEVERITY_FLOOR && // L-5: drop ambient low-severity noise
      e.lat != null && e.lon != null,
  );
  const freshSignals = signals.filter((s) => s.capturedAt >= since);
  return CHOKEPOINTS.map((cp) => scoreOne(cp, freshEvents, freshSignals, nowMs));
}

function scoreOne(cp: ChokepointConfig, events: EventRow[], signals: SignalRow[], nowMs: number): ChokepointStatusRow {
  // Proximity events: sum of severity (0..100 → 0..1) within radius.
  let eventSum = 0, eventCount = 0;
  for (const e of events) {
    if (haversineKm(cp.lat, cp.lon, e.lat as number, e.lon as number) <= cp.radiusKm) {
      eventSum += (e.severity ?? 0) / 100;
      eventCount++;
    }
  }
  // Proximity signals: nearby negative-tone GKG signals within radius.
  let signalCount = 0;
  for (const s of signals) {
    if (s.lat == null || s.lon == null) continue;
    if ((s.tone ?? 0) < 0 && haversineKm(cp.lat, cp.lon, s.lat, s.lon) <= cp.radiusKm) signalCount++;
  }
  // Name/entity match: any signal mentioning an alias (negative tone weighted full, else half).
  let nameCount = 0;
  for (const s of signals) {
    if (aliasMatch(s, cp.aliases)) nameCount += (s.tone ?? 0) < 0 ? 1 : 0.5;
  }

  const eventScore = clamp01(eventSum / CHOKEPOINT_SAT.event);
  const signalScore = clamp01(signalCount / CHOKEPOINT_SAT.signal);
  const nameScore = clamp01(nameCount / CHOKEPOINT_SAT.name);
  const score = clamp01(
    CHOKEPOINT_WEIGHTS.event * eventScore +
    CHOKEPOINT_WEIGHTS.signal * signalScore +
    CHOKEPOINT_WEIGHTS.name * nameScore,
  );

  // L-5 naming gate: 'disrupted' (red) requires the strait to actually be NAMED in
  // the news (nameScore>0), not merely have ambient activity nearby. A chokepoint
  // close to a capital (Dover→London, Suez→Cairo) can rack up proximity score from
  // unrelated protests; without a name mention it caps at 'watch' (amber).
  // ponytail: keyword gate; a real "English Channel migrants" mention still trips it
  // (migration ≠ trade blockage) — slice B's AI is the place to disambiguate intent.
  let status = bandFor(score);
  if (status === 'disrupted' && nameScore === 0) status = 'watch';

  return {
    chokepointId: cp.id,
    status,
    score,
    componentsJson: JSON.stringify({ eventScore, signalScore, nameScore, eventCount, signalCount, nameCount }),
    capturedAt: nowMs,
  };
}

/**
 * IO orchestrator: reads recent events+signals from the store, scores all
 * chokepoints, returns persistable rows. Graceful: never throws on own logic.
 */
export async function detectAllChokepoints(nowMs: number): Promise<ChokepointStatusRow[]> {
  const since = nowMs - CHOKEPOINT_WINDOW_MS;
  // getEvents/getSignals default to LIMIT 500 (most-recent). A spatial proximity
  // scan needs the FULL 72h window or it silently misses events near a chokepoint
  // (GDELT alone is ~650/fetch). Pass a generous explicit cap.
  // ponytail: 20000 cap; if 72h volume ever exceeds it, add a coords-filtered store getter.
  const events = await getEvents({ sinceMs: since, limit: 20000 });
  const signals = await getSignals({ sinceMs: since, limit: 20000 });
  return scoreChokepoints(events, signals, nowMs);
}
