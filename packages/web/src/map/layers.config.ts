/**
 * CENTRAL LAYER CONFIG — ADR-003 / D-008 / feedback_central_layer_config
 *
 * ALL MapLibre layers are declared here. The MapView component ITERATES this array.
 * NEVER add layers imperatively outside this config.
 * Adding a layer type = adding an entry to LAYERS.
 *
 * Event layers (T-13 / D-106 / OQ-7):
 *  - Source 'events' replaces legacy 'gdelt-events' (OQ-2 / C-3).
 *  - circle by default; heatmap added for density-heavy types (wildfire / conflict).
 *  - Color / size driven by the `severity` property on each GeoJSON feature (0..100).
 *
 * Attribution (feedback_data_tos / D-107):
 *  - USGS data: "U.S. Geological Survey" (public domain)
 *  - EONET data: "Data: NASA EONET" (17 U.S.C. §105, public domain)
 *  - GDELT data: "Source: The GDELT Project (gdeltproject.org)" (free use with citation)
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
  /**
   * Optional source-layer filter expression applied when iterating LAYERS.
   * Used to split a single GeoJSON source into per-type sub-views.
   * MapView applies this as a `filter` on the layer spec.
   */
  filterExpr?: unknown[];
}

// ---------------------------------------------------------------------------
// Shared paint helpers — severity 0..100 → color + radius (D-106 / OQ-7)
// ---------------------------------------------------------------------------

/** Circle color ramp: low severity (blue) → medium (orange) → high (red) */
const SEVERITY_COLOR_RAMP = [
  'interpolate',
  ['linear'],
  ['get', 'severity'],
  0,   '#3b82f6',  // {colors.accent} blue — low
  30,  '#f59e0b',  // {colors.warning} amber — medium
  60,  '#ef4444',  // {colors.danger} red — high
  100, '#7f1d1d',  // deep red — critical
];

/** Circle radius ramp: severity 0..100 → 4px..14px (zoom-aware) */
const SEVERITY_RADIUS = [
  'interpolate',
  ['linear'],
  ['get', 'severity'],
  0,   4,
  50,  8,
  100, 14,
];

/** Heatmap weight by severity */
const HEATMAP_WEIGHT = [
  'interpolate',
  ['linear'],
  ['get', 'severity'],
  0,   0.1,
  100, 1,
];

/** Standard circle paint driven by severity */
const circlePaint = (overrides?: Record<string, unknown>) => ({
  'circle-radius': [
    'interpolate',
    ['linear'],
    ['zoom'],
    2, ['interpolate', ['linear'], ['get', 'severity'], 0, 2, 100, 6],
    10, SEVERITY_RADIUS,
  ],
  'circle-color': SEVERITY_COLOR_RAMP,
  'circle-opacity': 0.85,
  'circle-stroke-width': 1,
  'circle-stroke-color': 'rgba(255,255,255,0.25)',
  ...overrides,
});

/** Heatmap paint driven by severity */
const heatmapPaint = (color0 = 'rgba(59,130,246,0)') => ({
  'heatmap-weight': HEATMAP_WEIGHT,
  'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 9, 3],
  'heatmap-color': [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,   color0,
    0.2, 'rgba(59,130,246,0.5)',
    0.4, 'rgba(245,158,11,0.7)',
    0.7, 'rgba(239,68,68,0.85)',
    1,   'rgba(127,29,29,1)',
  ],
  'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 24],
  'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 9, 0.3],
});

// ---------------------------------------------------------------------------
// Event type filter expressions — split single 'events' source by type
// ---------------------------------------------------------------------------
const typeFilter = (eventType: string): unknown[] => [
  '==',
  ['get', 'event_type'],
  eventType,
];

// ---------------------------------------------------------------------------
// LAYERS — single source of truth for ALL MapLibre layers
// ---------------------------------------------------------------------------

export const LAYERS: LayerSpec[] = [
  // =====================================================================
  // EARTHQUAKE (USGS) — circles, severity by magnitude/alert/tsunami
  // Attribution: U.S. Geological Survey (public domain)
  // =====================================================================
  {
    id: 'evt-earthquake',
    source: 'events',
    type: 'circle',
    label: 'Earthquakes',
    toggleKey: 'evt-earthquake',
    visibleWhen: (active) => active.has('evt-earthquake'),
    filterExpr: typeFilter('earthquake'),
    paint: circlePaint({
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        0,   '#a78bfa',  // violet — minor tremor
        40,  '#f59e0b',  // amber — moderate
        70,  '#ef4444',  // red — strong
        100, '#7f1d1d',  // deep red — major/critical
      ],
    }),
  },

  // =====================================================================
  // WILDFIRE (NASA EONET) — heatmap for density + circles at high zoom
  // Attribution: Data: NASA EONET (public domain, 17 U.S.C. §105)
  // =====================================================================
  {
    id: 'evt-wildfire-heat',
    source: 'events',
    type: 'heatmap',
    label: 'Wildfires (heat)',
    toggleKey: 'evt-wildfire',
    visibleWhen: (active) => active.has('evt-wildfire'),
    filterExpr: typeFilter('wildfire'),
    paint: heatmapPaint('rgba(245,158,11,0)'),
  },
  {
    id: 'evt-wildfire',
    source: 'events',
    type: 'circle',
    label: 'Wildfires',
    toggleKey: 'evt-wildfire',
    visibleWhen: (active) => active.has('evt-wildfire'),
    filterExpr: typeFilter('wildfire'),
    paint: {
      ...circlePaint(),
      'circle-color': '#f59e0b',  // amber — wildfire signature color
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 7, 0.85],
    },
  },

  // =====================================================================
  // VOLCANO (NASA EONET) — circles
  // Attribution: Data: NASA EONET (public domain)
  // =====================================================================
  {
    id: 'evt-volcano',
    source: 'events',
    type: 'circle',
    label: 'Volcanoes',
    toggleKey: 'evt-volcano',
    visibleWhen: (active) => active.has('evt-volcano'),
    filterExpr: typeFilter('volcano'),
    paint: circlePaint({
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        0,   '#fbbf24',
        60,  '#f97316',  // orange — eruption signature
        100, '#7c2d12',
      ],
    }),
  },

  // =====================================================================
  // STORM (NASA EONET — severeStorms)
  // Attribution: Data: NASA EONET (public domain)
  // =====================================================================
  {
    id: 'evt-storm',
    source: 'events',
    type: 'circle',
    label: 'Storms',
    toggleKey: 'evt-storm',
    visibleWhen: (active) => active.has('evt-storm'),
    filterExpr: typeFilter('storm'),
    paint: circlePaint({
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        0,   '#67e8f9',  // cyan — minor
        60,  '#0ea5e9',  // blue — significant
        100, '#1e3a8a',  // deep blue — extreme
      ],
    }),
  },

  // =====================================================================
  // FLOOD (NASA EONET)
  // Attribution: Data: NASA EONET (public domain)
  // =====================================================================
  {
    id: 'evt-flood',
    source: 'events',
    type: 'circle',
    label: 'Floods',
    toggleKey: 'evt-flood',
    visibleWhen: (active) => active.has('evt-flood'),
    filterExpr: typeFilter('flood'),
    paint: circlePaint({
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        0,   '#bae6fd',
        50,  '#0284c7',
        100, '#0c4a6e',
      ],
    }),
  },

  // =====================================================================
  // CONFLICT (GDELT — QuadClass 3/4 non-protest) — heatmap + circles
  // Replaces legacy 'gdelt-events' source (OQ-2 / C-3).
  // Data now has real event coords (not country centroid).
  // Attribution: Source: The GDELT Project (gdeltproject.org)
  // =====================================================================
  {
    id: 'evt-conflict-heat',
    source: 'events',
    type: 'heatmap',
    label: 'Conflict (heat)',
    toggleKey: 'evt-conflict',
    visibleWhen: (active) => active.has('evt-conflict'),
    filterExpr: typeFilter('conflict'),
    paint: heatmapPaint('rgba(239,68,68,0)'),
  },
  {
    id: 'evt-conflict',
    source: 'events',
    type: 'circle',
    label: 'Conflicts',
    toggleKey: 'evt-conflict',
    visibleWhen: (active) => active.has('evt-conflict'),
    filterExpr: typeFilter('conflict'),
    paint: {
      ...circlePaint(),
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 0.85],
    },
  },

  // =====================================================================
  // PROTEST (GDELT — QuadClass 3/4 CAMEO 14x codes)
  // Attribution: Source: The GDELT Project (gdeltproject.org)
  // =====================================================================
  {
    id: 'evt-protest',
    source: 'events',
    type: 'circle',
    label: 'Protests',
    toggleKey: 'evt-protest',
    visibleWhen: (active) => active.has('evt-protest'),
    filterExpr: typeFilter('protest'),
    paint: circlePaint({
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        0,   '#d8b4fe',  // light purple — minor
        50,  '#9333ea',  // purple — significant
        100, '#581c87',  // deep purple — major
      ],
    }),
  },
];

/** All unique source ids needed by LAYERS */
export const LAYER_SOURCES = [...new Set(LAYERS.map((l) => l.source))];

/** All unique toggle keys */
export const TOGGLE_KEYS = [...new Set(LAYERS.map((l) => l.toggleKey))];
