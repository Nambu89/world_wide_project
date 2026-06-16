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

// ---------------------------------------------------------------------------
// SIGNAL_LAYERS — radar geoeconomic sections (T-20 / D-207 / D-006)
//
// One layer per section with source:'signals'. political_instability is EXCLUDED
// because it reuses evt-conflict/evt-protest from the 'events' source (per spec).
//
// W-3 HAZARD: MapLibre ['get','section'] cannot index arrays. MapView MUST emit
// one GeoJSON Feature per (signal × section) with `section` as a scalar property.
//
// Opacity is driven by |tone| (0..max ~10): brighter = more negative tone.
// ---------------------------------------------------------------------------

/** Section filter expression for the 'signals' source (W-3: scalar property) */
const sectionFilter = (section: string): unknown[] => [
  '==',
  ['get', 'section'],
  section,
];

/**
 * Circle paint for signal layers.
 * Color = accent family per domain. Radius driven by |tone| (0..10 → 4..12px).
 * Opacity modulated by |tone| so neutral signals fade gently.
 */
const signalCirclePaint = (colorHex: string, colorHexHigh: string) => ({
  'circle-radius': [
    'interpolate',
    ['linear'],
    ['zoom'],
    2, ['interpolate', ['linear'], ['get', 'toneMag'], 0, 2, 10, 5],
    10, ['interpolate', ['linear'], ['get', 'toneMag'], 0, 4, 10, 12],
  ],
  'circle-color': [
    'interpolate',
    ['linear'],
    ['get', 'toneMag'],
    0,  colorHex,
    10, colorHexHigh,
  ],
  'circle-opacity': [
    'interpolate',
    ['linear'],
    ['get', 'toneMag'],
    0,   0.35,
    3,   0.65,
    10,  0.90,
  ],
  'circle-stroke-width': 1,
  'circle-stroke-color': 'rgba(255,255,255,0.15)',
});

export const SIGNAL_LAYERS: LayerSpec[] = [
  // =====================================================================
  // COMMODITIES & ENERGY — amber/orange (energy signature)
  // =====================================================================
  {
    id: 'sig-commodities-energy',
    source: 'signals',
    type: 'circle',
    label: 'Commodities & Energy',
    toggleKey: 'sig-commodities-energy',
    visibleWhen: (active) => active.has('sig-commodities-energy'),
    filterExpr: sectionFilter('commodities_energy'),
    paint: signalCirclePaint('#f59e0b', '#b45309'),
  },

  // =====================================================================
  // CRITICAL MINERALS — teal/green (resources)
  // =====================================================================
  {
    id: 'sig-critical-minerals',
    source: 'signals',
    type: 'circle',
    label: 'Critical Minerals',
    toggleKey: 'sig-critical-minerals',
    visibleWhen: (active) => active.has('sig-critical-minerals'),
    filterExpr: sectionFilter('critical_minerals'),
    paint: signalCirclePaint('#14b8a6', '#0f766e'),
  },

  // =====================================================================
  // SEMIS & AI TECH — violet/indigo (tech)
  // =====================================================================
  {
    id: 'sig-semis-ai-tech',
    source: 'signals',
    type: 'circle',
    label: 'Semis & AI Tech',
    toggleKey: 'sig-semis-ai-tech',
    visibleWhen: (active) => active.has('sig-semis-ai-tech'),
    filterExpr: sectionFilter('semis_ai_tech'),
    paint: signalCirclePaint('#818cf8', '#4f46e5'),
  },

  // =====================================================================
  // DIGITAL INFRA & CYBER — cyan/sky (digital)
  // =====================================================================
  {
    id: 'sig-digital-infra-cyber',
    source: 'signals',
    type: 'circle',
    label: 'Digital Infra & Cyber',
    toggleKey: 'sig-digital-infra-cyber',
    visibleWhen: (active) => active.has('sig-digital-infra-cyber'),
    filterExpr: sectionFilter('digital_infra_cyber'),
    paint: signalCirclePaint('#38bdf8', '#0369a1'),
  },

  // =====================================================================
  // TRADE & SANCTIONS — rose/red (sanctions = danger signal)
  // =====================================================================
  {
    id: 'sig-trade-sanctions',
    source: 'signals',
    type: 'circle',
    label: 'Trade & Sanctions',
    toggleKey: 'sig-trade-sanctions',
    visibleWhen: (active) => active.has('sig-trade-sanctions'),
    filterExpr: sectionFilter('trade_sanctions'),
    paint: signalCirclePaint('#fb7185', '#be123c'),
  },
];

// ---------------------------------------------------------------------------
// CII_LAYERS — Country Instability Index choropleth circles (T-26)
//
// Source: 'cii-countries' (GeoJSON; 1 Feature per country with centroid lat/lon).
// Color bands (composite 0-100):
//   0-24  low      → teal/green
//  25-49  moderate → amber
//  50-69  elevated → orange
//  70-100 high     → red
// Radius driven by composite score.
// ---------------------------------------------------------------------------

/** Step expression for CII composite → circle color by band */
const CII_COLOR_STEP = [
  'step',
  ['get', 'composite'],
  '#22c55e',   // 0-24: low — {colors.success} teal
  25, '#f59e0b', // 25-49: moderate — {colors.warning} amber
  50, '#f97316', // 50-69: elevated — orange
  70, '#ef4444', // 70-100: high — {colors.danger} red
];

/** Circle radius ramp: composite 0..100 → 6px..18px (zoom-aware) */
const CII_RADIUS = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2, ['interpolate', ['linear'], ['get', 'composite'], 0, 3, 100, 8],
  8, ['interpolate', ['linear'], ['get', 'composite'], 0, 6, 100, 18],
];

export const CII_LAYERS: LayerSpec[] = [
  // =====================================================================
  // CII per-country — circles at country centroid, color by band
  // Attribution: CII propio · datos: USGS/NASA EONET/GDELT/GKG
  // =====================================================================
  {
    id: 'cii-countries',
    source: 'cii-countries',
    type: 'circle',
    label: 'Country Risk (CII)',
    toggleKey: 'cii',
    visibleWhen: (active) => active.has('cii'),
    paint: {
      'circle-color': CII_COLOR_STEP,
      'circle-radius': CII_RADIUS,
      'circle-opacity': 0.80,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.20)',
    },
  },
];

// ---------------------------------------------------------------------------
// CONVERGENCE_LAYERS — convergence signal rings per country (T-34)
//
// Design: D-402/D-404 — ANILLO (ring glyph):
//   circle-color = transparent (rgba(0,0,0,0)) → hollow centre.
//   circle-stroke = thick amber→red ramp by strength (DISTINCT from CII fill ramp).
//   circle-radius = LARGER than CII circle so rings coexist without occlusion (R-5).
//   circle-stroke-opacity driven by strength.
//
// Source: 'convergence-countries' (GeoJSON; 1 Feature per signal with lat/lon).
// Toggle: 'convergence' — INDEPENDENT from 'cii'; OFF by default (D-403/OQ-3).
// Properties on features (W-3 scalar): country, strength, sourceCount, families, topDimension.
// ---------------------------------------------------------------------------

/** Stroke-color ramp: amber → orange-red → red by strength (0..1) — distinct from CII fill */
const CONVERGENCE_STROKE_COLOR = [
  'interpolate',
  ['linear'],
  ['get', 'strength'],
  0,   '#f59e0b',  // {colors.warning} amber — weak signal
  0.4, '#f97316',  // orange — moderate
  0.7, '#ef4444',  // {colors.danger} red — strong
  1,   '#7f1d1d',  // deep red — critical convergence
];

/** Stroke-width ramp by strength (0..1) → 1.5..5px (thick ring) */
const CONVERGENCE_STROKE_WIDTH = [
  'interpolate',
  ['linear'],
  ['get', 'strength'],
  0,   1.5,
  1,   5,
];

/** Stroke-opacity ramp by strength (0..1) → 0.4..0.95 */
const CONVERGENCE_STROKE_OPACITY = [
  'interpolate',
  ['linear'],
  ['get', 'strength'],
  0,   0.4,
  1,   0.95,
];

/**
 * Circle radius ramp by strength (0..1) → larger than CII circles (R-5).
 * At zoom 2: 10..20; at zoom 8: 20..34. CII goes up to 18px max at zoom 8.
 */
const CONVERGENCE_RADIUS = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2, ['interpolate', ['linear'], ['get', 'strength'], 0, 10, 1, 20],
  8, ['interpolate', ['linear'], ['get', 'strength'], 0, 20, 1, 34],
];

export const CONVERGENCE_LAYERS: LayerSpec[] = [
  // =====================================================================
  // CONVERGENCE per-country — ring at country centroid, amber→red by strength
  // D-402/D-404: hollow circle (transparent fill) + thick stroke = anillo
  // D-403/OQ-3: toggle 'convergence' OFF by default
  // Attribution: motor de convergencia propio · datos: USGS/NASA EONET/GDELT/GKG
  // =====================================================================
  {
    id: 'convergence-countries',
    source: 'convergence-countries',
    type: 'circle',
    label: 'Convergence Signals',
    toggleKey: 'convergence',
    visibleWhen: (active) => active.has('convergence'),
    paint: {
      'circle-color': 'rgba(0,0,0,0)',          // D-404: transparent fill → ring shape
      'circle-radius': CONVERGENCE_RADIUS,       // R-5: larger than CII circles
      'circle-stroke-width': CONVERGENCE_STROKE_WIDTH,
      'circle-stroke-color': CONVERGENCE_STROKE_COLOR,
      'circle-stroke-opacity': CONVERGENCE_STROKE_OPACITY,
    },
  },
];

/** All unique source ids needed by LAYERS + SIGNAL_LAYERS + CII_LAYERS + CONVERGENCE_LAYERS */
export const LAYER_SOURCES = [
  ...new Set(
    [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS].map((l) => l.source)
  ),
];

/** All unique toggle keys (events + signals + cii + convergence) */
export const TOGGLE_KEYS = [
  ...new Set(
    [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS].map((l) => l.toggleKey)
  ),
];
