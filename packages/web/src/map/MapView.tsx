/**
 * MapView — MapLibre GL map component.
 *
 * Sources are registered once in map.on('load').
 * Layer visibility is controlled declaratively via activeLayers + LAYERS config.
 * Data is injected via source.setData() in useEffect — NEVER via addLayer outside LAYERS.
 *
 * T-13: Source 'events' replaces legacy 'gdelt-events'.
 *   - getEvents() fetches all event types from /api/events.
 *   - Each EventRow → GeoJSON Feature Point with properties { event_type, severity, title, country }.
 *   - Per-type filtering is done in LAYERS via filterExpr (MapLibre filter expression).
 *   - Legacy gdelt-events source + getGdelt() removed (OQ-2 / C-3 complete).
 */

import { useEffect, useRef } from 'react';
import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { LAYERS, SIGNAL_LAYERS, CII_LAYERS, CONVERGENCE_LAYERS, SANCTIONS_LAYERS, CHOKEPOINT_LAYERS, LAYER_SOURCES } from './layers.config';
import {
  getEvents,
  getSignals,
  getCii,
  getConvergence,
  getSanctions,
  getChokepoints,
  type GlobalEvent,
  type RadarSignal,
  type CiiCountry,
  type ConvergenceCountry,
  type SanctionCountry,
  type Chokepoint,
} from '../api/client';

interface Props {
  activeLayers: Set<string>;
  /**
   * Country selected in RiskPanel or ConvergencePanel — map centers on it when set.
   * Declarative tie: React state drives flyTo, no imperative map calls.
   */
  activeCountry?: string | null;
  /** Chokepoint id selected in ChokepointsPanel — map flies to it when set (slice A). */
  activeChokepoint?: string | null;
}

/** Convert GlobalEvent array to a GeoJSON FeatureCollection for the 'events' source. */
function eventsToGeoJSON(events: GlobalEvent[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events.map((e) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [e.lng, e.lat],
      },
      properties: {
        key: e.key,
        event_type: e.eventType,
        category: e.category,
        severity: e.severity,
        title: e.title,
        country: e.country ?? '',
        source: e.source,
        occurred_at: e.occurredAt ?? '',
      },
    })),
  };
}

/**
 * Convert RadarSignal array to GeoJSON for the 'signals' source.
 *
 * W-3 HAZARD FIX: RadarSignal.sections is an ARRAY on the wire. MapLibre
 * ['get','section'] cannot index arrays. We EXPAND: one Feature per
 * (signal × section) with `section` as a SCALAR property.
 *
 * Signals without lat/lon are silently dropped (cannot be plotted).
 * toneMag = Math.abs(tone ?? 0) so the paint opacity/radius expressions work.
 */
function signalsToGeoJSON(signals: RadarSignal[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const sig of signals) {
    if (sig.lat == null || sig.lon == null) continue; // no coords — panel only
    const toneMag = Math.abs(sig.tone ?? 0);
    for (const { section } of sig.sections) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [sig.lon, sig.lat],
        },
        properties: {
          key: sig.key,
          section,             // SCALAR — required for filterExpr in SIGNAL_LAYERS
          tone: sig.tone,
          toneMag,
          title: sig.title,
          country: sig.country ?? '',
          source: sig.source,
          occurred_at: sig.occurredAt ?? '',
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Convert CiiCountry array to GeoJSON for the 'cii-countries' source (T-26).
 * Only countries WITH lat/lon emit a feature (others are panel-only).
 * Properties exposed to MapLibre: composite, country, dominantComponent (key string).
 */
function ciiToGeoJSON(countries: CiiCountry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of countries) {
    if (c.lat == null || c.lon == null) continue; // no centroid — panel only
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [c.lon, c.lat],
      },
      properties: {
        country: c.country,
        composite: c.composite,
        band: c.band,
        trend: c.trend ?? 'stable',
        dominantComponent: c.dominantComponent?.key ?? '',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Convert ConvergenceCountry array to GeoJSON for the 'convergence-countries' source (T-34).
 *
 * D-402: 1 Feature per signal WITH lat/lon (signals without coords are discarded).
 * W-3: properties are SCALAR — MapLibre ['get'] cannot index arrays.
 *   families → joined string (e.g. "events+signals")
 *   topDimension → scalar string or ''
 */
function convergenceToGeoJSON(signals: ConvergenceCountry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of signals) {
    if (s.lat == null || s.lon == null) continue; // no centroid — panel only (R-1)
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [s.lon, s.lat],
      },
      properties: {
        country: s.country,
        strength: s.strength,
        sourceCount: s.sourceCount,
        families: s.families.join('+'),   // W-3: scalar string not array
        topDimension: s.topDimension ?? '',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Convert SanctionCountry array to GeoJSON for the 'sanctions-countries' source.
 * Only countries WITH a centroid emit a feature (others are panel-only).
 * Property `count` is scalar (W-3) — drives the step color/radius paint.
 */
function sanctionsToGeoJSON(rows: SanctionCountry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of rows) {
    if (s.lat == null || s.lon == null) continue; // no centroid — panel only
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        country: s.country,
        count: s.sanctionedCount,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Convert Chokepoint array to GeoJSON for the 'chokepoints' source (slice A).
 * Property `status`/`id` are scalar (W-3) — drive the match paint + flyTo lookup.
 */
function chokepointsToGeoJSON(rows: Chokepoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { id: c.id, nameEs: c.nameEs, status: c.status, score: c.score },
    })),
  };
}

/** Empty GeoJSON for initial source registration */
const EMPTY_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Source data keyed by source id — all start empty */
const SOURCE_INITIAL_DATA: Record<string, GeoJSON.FeatureCollection> = {};
for (const id of LAYER_SOURCES) {
  SOURCE_INITIAL_DATA[id] = EMPTY_GEOJSON;
}

export default function MapView({ activeLayers, activeCountry, activeChokepoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  /** Store latest CII data so we can center map when activeCountry changes (RiskPanel) */
  const ciiDataRef = useRef<CiiCountry[]>([]);
  /**
   * Store latest convergence data for map-tie (R-2 / D-406).
   * flyTo uses the lat/lon already in the signal (does NOT fall through to ciiDataRef).
   */
  const convergenceDataRef = useRef<ConvergenceCountry[]>([]);
  /** Store latest sanctions data for map-tie flyTo (uses embedded lat/lon). */
  const sanctionsDataRef = useRef<SanctionCountry[]>([]);
  /** Store latest chokepoints data for activeChokepoint flyTo. */
  const chokepointsDataRef = useRef<Chokepoint[]>([]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Zero-key OSM raster basemap
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm-background',
            type: 'raster',
            source: 'osm-tiles',
            paint: {
              'raster-opacity': 0.85,
              'raster-saturation': -0.3,
              'raster-brightness-min': 0.05,
            },
          },
        ],
      },
      center: [0, 20],
      zoom: 2,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    map.on('load', () => {
      // Register all sources declared in LAYERS as empty GeoJSON
      for (const sourceId of LAYER_SOURCES) {
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: EMPTY_GEOJSON,
          });
        }
      }

      // Add all layers by iterating LAYERS + SIGNAL_LAYERS + CII_LAYERS + CONVERGENCE_LAYERS — NEVER add layers outside this loop
      for (const spec of [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS]) {
        if (map.getLayer(spec.id)) continue;

        // Build a plain object and cast to LayerSpecification at the call site.
        // Using 'as unknown as LayerSpecification' avoids the exactOptionalPropertyTypes
        // discriminant-union error that TypeScript raises when you spread optional fields
        // (filter, paint) into a discriminated LayerSpecification union — the runtime
        // object is always valid because MapLibre's addLayer accepts any spec object.
        const layerDef = {
          id: spec.id,
          type: spec.type,
          source: spec.source,
          // Per-type filter expression (splits a shared source by event_type)
          ...(spec.filterExpr !== undefined ? { filter: spec.filterExpr } : {}),
          ...(spec.paint !== undefined ? { paint: spec.paint } : {}),
          layout: {
            ...(spec.layout as Record<string, unknown> | undefined),
            visibility: 'none', // all start hidden; controlled by activeLayers effect
          },
        } as unknown as maplibregl.LayerSpecification;

        map.addLayer(layerDef);
      }

      mapReadyRef.current = true;

      // Dispatch synthetic event so visibility effect re-runs after load
      // (React state may have already run the effect before map was ready)
      map.fire('layers-ready');
    });

    return () => {
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync layer visibility declaratively whenever activeLayers changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!mapReadyRef.current) return;
      for (const spec of [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS]) {
        if (!map.getLayer(spec.id)) continue;
        const visible = spec.visibleWhen(activeLayers);
        map.setLayoutProperty(spec.id, 'visibility', visible ? 'visible' : 'none');
      }
    };

    apply();

    // Also apply once map fires layers-ready (covers initial load race)
    map.once('layers-ready', apply);
    return () => {
      // map.once self-removes, but guard anyway
    };
  }, [activeLayers]);

  // Load events data from /api/events and inject into the 'events' source.
  // One useEffect for this data type — sets data once loaded (T-13 / D-003).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const data = await getEvents();
        if (cancelled) return;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('events') as GeoJSONSource | undefined;
          if (source) {
            source.setData(eventsToGeoJSON(data.events));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // The panel shows an error state independently via its own fetch.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load signals data from /api/signals and inject into the 'signals' source (T-20).
  // One useEffect per data type — mirrors the events pattern above.
  // W-3: signalsToGeoJSON expands signals×sections so each feature has scalar `section`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const signals = await getSignals();
        if (cancelled) return;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('signals') as GeoJSONSource | undefined;
          if (source) {
            source.setData(signalsToGeoJSON(signals));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // RadarPanel shows its own error state independently via its own fetch.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load CII data from /api/cii and inject into the 'cii-countries' source (T-26).
  // One useEffect per data type — mirrors the events/signals pattern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const countries = await getCii();
        if (cancelled) return;

        ciiDataRef.current = countries;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('cii-countries') as GeoJSONSource | undefined;
          if (source) {
            source.setData(ciiToGeoJSON(countries));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // RiskPanel shows its own error state independently via its own fetch.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load convergence signals from /api/convergence and inject into 'convergence-countries' source (T-34).
  // One useEffect per data type — mirrors the CII pattern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const signals = await getConvergence();
        if (cancelled) return;

        convergenceDataRef.current = signals;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('convergence-countries') as GeoJSONSource | undefined;
          if (source) {
            source.setData(convergenceToGeoJSON(signals));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // ConvergencePanel shows its own error state independently via its own fetch.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load sanctions from /api/sanctions and inject into 'sanctions-countries' source.
  // One useEffect per data type — mirrors the convergence pattern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getSanctions();
        if (cancelled) return;

        sanctionsDataRef.current = rows;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('sanctions-countries') as GeoJSONSource | undefined;
          if (source) {
            source.setData(sanctionsToGeoJSON(rows));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // FinancePanel shows its own error state independently.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load chokepoints from /api/chokepoints and inject into 'chokepoints' source (slice A).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getChokepoints();
        if (cancelled) return;

        chokepointsDataRef.current = rows;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('chokepoints') as GeoJSONSource | undefined;
          if (source) {
            source.setData(chokepointsToGeoJSON(rows));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // ChokepointsPanel shows its own error state independently.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Map-tie: when activeCountry changes (from RiskPanel or ConvergencePanel selection),
  // fly to that country. Searches convergenceDataRef FIRST (uses embedded lat/lon — R-2/D-406),
  // then falls through to ciiDataRef. Purely declarative React state, no imperative add.
  useEffect(() => {
    if (!activeCountry) return;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    // R-2: convergenceDataRef has the lat/lon embedded in the signal — preferred for convergence flyTo
    const convergenceSig = convergenceDataRef.current.find(
      (s) => s.country === activeCountry && s.lat != null && s.lon != null
    );
    if (convergenceSig && convergenceSig.lat != null && convergenceSig.lon != null) {
      map.flyTo({
        center: [convergenceSig.lon, convergenceSig.lat],
        zoom: 4,
        duration: 800,
      });
      return;
    }

    // Sanctions selections embed lat/lon — check before the CII fallback.
    const sanctionRow = sanctionsDataRef.current.find(
      (s) => s.country === activeCountry && s.lat != null && s.lon != null
    );
    if (sanctionRow && sanctionRow.lat != null && sanctionRow.lon != null) {
      map.flyTo({ center: [sanctionRow.lon, sanctionRow.lat], zoom: 4, duration: 800 });
      return;
    }

    // Fallback: look up centroid from CII data (covers RiskPanel selections)
    const country = ciiDataRef.current.find(
      (c) => c.country === activeCountry && c.lat != null && c.lon != null
    );
    if (!country || country.lat == null || country.lon == null) return;

    map.flyTo({
      center: [country.lon, country.lat],
      zoom: 4,
      duration: 800,
    });
  }, [activeCountry]);

  // Map-tie: fly to a chokepoint when activeChokepoint changes (slice A).
  useEffect(() => {
    if (!activeChokepoint) return;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const cp = chokepointsDataRef.current.find((c) => c.id === activeChokepoint);
    if (!cp) return;
    map.flyTo({ center: [cp.lon, cp.lat], zoom: 5, duration: 800 });
  }, [activeChokepoint]);

  return (
    <div
      ref={containerRef}
      className="map-container"
      aria-label="World intelligence map"
      role="application"
    />
  );
}
