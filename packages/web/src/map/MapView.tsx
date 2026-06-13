/**
 * MapView — MapLibre GL map component.
 *
 * Sources are registered once in map.on('load').
 * Layer visibility is controlled declaratively via activeLayers + LAYERS config.
 * Data is injected via source.setData() in useEffect — NEVER via addLayer outside LAYERS.
 */

import { useEffect, useRef } from 'react';
import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { LAYERS, LAYER_SOURCES } from './layers.config';
import { getGdelt, type GdeltEvent } from '../api/client';

interface Props {
  activeLayers: Set<string>;
}

/** Convert GDELT events to a GeoJSON FeatureCollection */
function eventsToGeoJSON(events: GdeltEvent[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events.map((e) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [e.lng, e.lat],
      },
      properties: {
        eventId: e.eventId,
        eventCode: e.eventCode,
        goldstein: e.goldstein,
        tone: e.tone,
        url: e.url,
        date: e.date,
      },
    })),
  };
}

/** Empty GeoJSON for initial source registration */
const EMPTY_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Source data keyed by source id */
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

        const layerDef: maplibregl.LayerSpecification = {
          id: spec.id,
          type: spec.type as maplibregl.LayerSpecification['type'],
          source: spec.source,
          ...(spec.paint ? { paint: spec.paint as Record<string, unknown> } : {}),
          ...(spec.layout ? { layout: spec.layout as Record<string, unknown> } : {}),
          layout: {
            ...(spec.layout as Record<string, unknown> | undefined),
            visibility: 'none', // all start hidden; controlled by activeLayers effect
          },
        };

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

  // Load GDELT data and inject into source
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const data = await getGdelt();
        if (cancelled) return;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('gdelt-events') as GeoJSONSource | undefined;
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
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash)
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
