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
import { LAYERS, LAYER_SOURCES } from './layers.config';
import { getEvents, type GlobalEvent } from '../api/client';

interface Props {
  activeLayers: Set<string>;
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

export default function MapView({ activeLayers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);

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

      // Add all layers by iterating LAYERS — NEVER add layers outside this loop
      for (const spec of LAYERS) {
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
      for (const spec of LAYERS) {
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

  return (
    <div
      ref={containerRef}
      className="map-container"
      aria-label="World intelligence map"
      role="application"
    />
  );
}
