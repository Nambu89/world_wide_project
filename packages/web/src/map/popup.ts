/**
 * map/popup.ts — Slice D / D-901 / D-908.
 *
 * Builds the Spanish popup shown when a map point is clicked. Branches by layer
 * id (the GeoJSON feature properties differ per source — see MapView's *ToGeoJSON).
 *
 * Split in two:
 *  - popupRows(props, layerId): PURE (no DOM) — the Spanish field model + the
 *    free-text title to translate (or null). Unit-tested (popup.test.ts).
 *  - buildPopupNode(...): assembles those rows + a "Traducir" button into DOM
 *    (covered by E2E — web has no jsdom; adding it for one popup isn't worth it).
 *
 * Country names are localized for DISPLAY only (localizeCountry); the data key
 * stays English (never affects lookups/map-tie).
 */

import { localizeCountry } from '../i18n/countries';

export interface PopupRow {
  label: string;
  value: string;
}

export interface PopupModel {
  /** Short type heading in Spanish (e.g. "Terremoto", "Convergencia"). */
  heading: string;
  /** Structured fields, already in Spanish. */
  rows: PopupRow[];
  /** Free-text headline to translate (events/signals), or null (structured layers). */
  title: string | null;
}

const TYPE_ES: Record<string, string> = {
  earthquake: 'Terremoto',
  wildfire: 'Incendio',
  volcano: 'Volcán',
  storm: 'Tormenta',
  flood: 'Inundación',
  conflict: 'Conflicto',
  protest: 'Protesta',
};

const SECTION_ES: Record<string, string> = {
  commodities_energy: 'Materias primas y energía',
  critical_minerals: 'Minerales críticos',
  semis_ai_tech: 'Semiconductores e IA',
  digital_infra_cyber: 'Infraestructura digital y ciber',
  trade_sanctions: 'Comercio y sanciones',
  political_instability: 'Inestabilidad política',
};

const BAND_ES: Record<string, string> = {
  low: 'Bajo',
  moderate: 'Moderado',
  elevated: 'Elevado',
  high: 'Alto',
};

const STATUS_ES: Record<string, string> = {
  calm: 'Tranquilo',
  watch: 'Vigilancia',
  disrupted: 'Disrupción',
};

const COMPONENT_ES: Record<string, string> = {
  conflict: 'Conflicto',
  economic: 'Económico',
  political: 'Político',
  social: 'Social',
};

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format an epoch-ms or ISO date string to a Spanish short date, or null. */
function fmtDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Push a row only when the value is non-empty (keeps popups tidy). */
function addRow(rows: PopupRow[], label: string, value: string | null): void {
  if (value !== null && value !== '') rows.push({ label, value });
}

/**
 * Pure Spanish field model for a clicked feature. `props` = feature.properties,
 * `layerId` = feature.layer.id (its prefix selects the branch).
 */
export function popupRows(props: Record<string, unknown>, layerId: string): PopupModel {
  const rows: PopupRow[] = [];
  const country = str(props['country']);
  const countryEs = country ? localizeCountry(country) : '';

  if (layerId.startsWith('evt-')) {
    const type = str(props['event_type']);
    const sev = num(props['severity']);
    addRow(rows, 'Severidad', sev !== null ? String(Math.round(sev)) : null);
    addRow(rows, 'País', countryEs);
    addRow(rows, 'Fecha', fmtDate(props['occurred_at']));
    addRow(rows, 'Fuente', str(props['source']));
    return { heading: TYPE_ES[type] ?? type ?? 'Evento', rows, title: str(props['title']) || null };
  }

  if (layerId.startsWith('sig-')) {
    const section = str(props['section']);
    const tone = num(props['tone']);
    addRow(rows, 'Tono', tone !== null ? tone.toFixed(1) : null);
    addRow(rows, 'País', countryEs);
    addRow(rows, 'Fecha', fmtDate(props['occurred_at']));
    addRow(rows, 'Fuente', str(props['source']));
    return { heading: SECTION_ES[section] ?? 'Señal', rows, title: str(props['title']) || null };
  }

  if (layerId.startsWith('cii')) {
    const composite = num(props['composite']);
    const band = str(props['band']);
    const dom = str(props['dominantComponent']);
    addRow(rows, 'País', countryEs);
    addRow(rows, 'Banda', BAND_ES[band] ?? band);
    addRow(rows, 'Índice', composite !== null ? String(Math.round(composite)) : null);
    addRow(rows, 'Componente dominante', dom ? (COMPONENT_ES[dom] ?? dom) : null);
    return { heading: 'Riesgo país (CII)', rows, title: null };
  }

  if (layerId.startsWith('convergence')) {
    const strength = num(props['strength']);
    const sources = num(props['sourceCount']);
    const families = str(props['families']);
    const topDim = str(props['topDimension']);
    addRow(rows, 'País', countryEs);
    addRow(rows, 'Fuerza', strength !== null ? `${Math.round(strength * 100)}%` : null);
    addRow(rows, 'Fuentes', sources !== null ? String(sources) : null);
    addRow(rows, 'Familias', families);
    addRow(rows, 'Dimensión', topDim ? (COMPONENT_ES[topDim] ?? topDim) : null);
    return { heading: 'Convergencia', rows, title: null };
  }

  if (layerId.startsWith('sanctions')) {
    const count = num(props['count']);
    addRow(rows, 'País', countryEs);
    addRow(rows, 'Entidades sancionadas', count !== null ? String(count) : null);
    return { heading: 'Sanciones OFAC', rows, title: null };
  }

  if (layerId.startsWith('chokepoints')) {
    const status = str(props['status']);
    const score = num(props['score']);
    addRow(rows, 'Estado', STATUS_ES[status] ?? status);
    addRow(rows, 'Score', score !== null ? score.toFixed(2) : null);
    return { heading: str(props['nameEs']) || 'Ruta', rows, title: null };
  }

  // Unknown layer — generic fallback.
  addRow(rows, 'País', countryEs);
  return { heading: 'Detalle', rows, title: null };
}

/**
 * Builds the popup DOM node for a clicked feature. `onTranslate` is called with
 * the free-text title when the user clicks "Traducir"; on resolve the raw title
 * is replaced with the Spanish text (or "no disponible" on failure / no LLM).
 */
export function buildPopupNode(
  feature: { properties: Record<string, unknown> | null; layer: { id: string } },
  onTranslate: (text: string) => Promise<string | null>,
): HTMLElement {
  const model = popupRows(feature.properties ?? {}, feature.layer.id);

  const el = document.createElement('div');
  el.className = 'map-popup';

  const h = document.createElement('div');
  h.className = 'map-popup__heading';
  h.textContent = model.heading;
  el.appendChild(h);

  for (const { label, value } of model.rows) {
    const row = document.createElement('div');
    row.className = 'map-popup__row';
    const b = document.createElement('span');
    b.className = 'map-popup__label';
    b.textContent = `${label}: `;
    row.appendChild(b);
    row.appendChild(document.createTextNode(value));
    el.appendChild(row);
  }

  // Free-text title + on-demand translate (events/signals only).
  if (model.title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'map-popup__title';
    titleEl.textContent = model.title;
    el.appendChild(titleEl);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-popup__translate';
    btn.textContent = 'Traducir';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Traduciendo…';
      void onTranslate(model.title as string).then((translated) => {
        if (translated) {
          titleEl.textContent = translated;
          btn.remove();
        } else {
          btn.textContent = 'Traducción no disponible';
        }
      });
    });
    el.appendChild(btn);
  }

  return el;
}
