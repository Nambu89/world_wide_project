/**
 * CENTRAL LAYER CONFIG — ADR-003 / D-008 / feedback_central_layer_config
 *
 * ALL MapLibre layers are declared here. The MapView component ITERATES this array.
 * NEVER add layers imperatively outside this config.
 * Adding a layer = adding an entry to LAYERS.
 */

import type { LayerSpecification } from 'maplibre-gl';
// MapLibre v4 ya no exporta CirclePaint/HeatmapPaint/SymbolPaint como tipos nombrados;
// el paint se tipa laxo aquí y se castea a la spec concreta en MapView.addLayer.

export type LayerType = 'circle' | 'symbol' | 'heatmap';

export interface LayerSpec {
  /** Unique MapLibre layer id */
  id: string;
  /** MapLibre source id — must match a registered source */
  source: string;
  type: LayerType;
  paint?: Record<string, unknown>;
  layout?: LayerSpecification extends { layout?: infer L } ? L : Record<string, unknown>;
  /** Returns true when this layer should be visible given the active layer set */
  visibleWhen: (active: Set<string>) => boolean;
  /** Human-readable label for toggle UI */
  label: string;
  /** Toggle key — used in activeLayers Set */
  toggleKey: string;
}

export const LAYERS: LayerSpec[] = [
  // ------------------------------------------------------------------
  // GDELT events — geopolitical events heatmap
  // ------------------------------------------------------------------
  {
    id: 'gdelt-events-heat',
    source: 'gdelt-events',
    type: 'heatmap',
    label: 'Events (heat)',
    toggleKey: 'gdelt',
    visibleWhen: (active) => active.has('gdelt'),
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'goldstein'], -10, 1, 10, 0],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0, 'rgba(0,0,255,0)',
        0.2, 'rgba(0,0,255,0.5)',
        0.4, 'rgba(0,255,255,0.7)',
        0.6, 'rgba(0,255,0,0.8)',
        0.8, 'rgba(255,165,0,0.9)',
        1, 'rgba(255,0,0,1)',
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 9, 20],
      'heatmap-opacity': 0.75,
    },
  },
  // ------------------------------------------------------------------
  // GDELT events — individual circles (visible at high zoom)
  // ------------------------------------------------------------------
  {
    id: 'gdelt-events-circles',
    source: 'gdelt-events',
    type: 'circle',
    label: 'Events (dots)',
    toggleKey: 'gdelt',
    visibleWhen: (active) => active.has('gdelt'),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 6],
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'tone'],
        -10, '#ef4444',
        0, '#f59e0b',
        10, '#22c55e',
      ],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 0.8],
      'circle-stroke-width': 1,
      'circle-stroke-color': 'rgba(255,255,255,0.3)',
    },
  },
];

/** All unique source ids needed by LAYERS */
export const LAYER_SOURCES = [...new Set(LAYERS.map((l) => l.source))];

/** All unique toggle keys */
export const TOGGLE_KEYS = [...new Set(LAYERS.map((l) => l.toggleKey))];
