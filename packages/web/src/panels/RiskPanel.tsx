/**
 * RiskPanel — Country Instability Index (CII) panel (T-26).
 *
 * Responsibility: display top countries by CII composite score (descending).
 * Per country: composite score + band, trend arrow, dynamicScore, dominant component badge.
 * Map-tie: selecting a country calls onCountrySelect(country) so App can
 *   set activeCountry → MapView flies to that country centroid.
 *
 * States: loading / empty / error — always explicit (never crash on empty backend).
 *
 * Attribution (always visible):
 *   "CII propio · datos: USGS/NASA EONET/GDELT/GKG"
 *
 * Responsive: mobile-first 375px → desktop 1200px (ADR-008).
 * Design tokens only — no hardcoded hex values ({colors.*} / {rounded.*} / {typography.*}).
 */

import { useCallback, useEffect, useState } from 'react';
import { getCii, type CiiCountry, type CiiBand } from '../api/client';
import { localizeCountry } from '../i18n/countries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable band label (Spanish) */
function bandLabel(band: CiiBand): string {
  switch (band) {
    case 'low':      return 'Bajo';
    case 'moderate': return 'Moderado';
    case 'elevated': return 'Elevado';
    case 'high':     return 'Alto';
  }
}

/** CSS custom property name per band (maps to design tokens in styles.css) */
function bandColorVar(band: CiiBand): string {
  switch (band) {
    case 'low':      return 'var(--color-success)';
    case 'moderate': return 'var(--color-warning)';
    case 'elevated': return '#f97316';  // orange — between warning and danger
    case 'high':     return 'var(--color-danger)';
  }
}

/** Trend arrow symbol */
function trendArrow(trend: 'rising' | 'falling' | 'stable' | null): string {
  if (trend === 'rising')  return '▲';   // ▲
  if (trend === 'falling') return '▼';   // ▼
  return '–';                             // –
}

/** Trend arrow color */
function trendColor(trend: 'rising' | 'falling' | 'stable' | null): string {
  if (trend === 'rising')  return 'var(--color-danger)';
  if (trend === 'falling') return 'var(--color-success)';
  return 'var(--color-text-secondary)';
}

/** Dominant component display label (Spanish) */
function componentLabel(key: string): string {
  switch (key) {
    case 'conflict':  return 'Conflicto';
    case 'economic':  return 'Económico';
    case 'political': return 'Político';
    case 'social':    return 'Social';
    default:          return key;
  }
}

/** Trend label (Spanish) for titles/aria */
function trendLabel(trend: 'rising' | 'falling' | 'stable' | null): string {
  if (trend === 'rising')  return 'subiendo';
  if (trend === 'falling') return 'bajando';
  return 'estable';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; countries: CiiCountry[] };

// ---------------------------------------------------------------------------
// RiskPanel
// ---------------------------------------------------------------------------

interface RiskPanelProps {
  /** Country currently selected/highlighted — for visual highlight in list. */
  activeCountry: string | null;
  /** Called when user selects a country row — parent syncs map fly-to. */
  onCountrySelect: (country: string) => void;
}

export default function RiskPanel({ activeCountry, onCountrySelect }: RiskPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'idle' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getCii()
      .then((countries) => {
        if (countries.length === 0) {
          setState({ status: 'empty' });
        } else {
          // Sort descending by composite (highest risk first)
          const sorted = [...countries].sort((a, b) => b.composite - a.composite);
          setState({ status: 'ok', countries: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        setState({ status: 'error', message });
      });
  }, []);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="risk-panel">
      <h2 className="risk-panel__heading">Riesgo país (CII)</h2>

      {/* Loading */}
      {state.status === 'loading' && (
        <div className="state-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Cargando puntuaciones CII…</span>
        </div>
      )}

      {/* Error */}
      {state.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Error al cargar datos CII</div>
          <div>{state.message}</div>
          <button className="state-error__retry" onClick={load} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* Empty */}
      {state.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">--</div>
          <div>Aún no hay puntuaciones CII</div>
          <div>Vuelve más tarde — el CII se calcula a partir de los eventos.</div>
        </div>
      )}

      {/* Data */}
      {state.status === 'ok' && (
        <ul className="risk-panel__list" role="list" aria-label="Países por puntuación de riesgo">
          {state.countries.map((c) => (
            <li
              key={c.country}
              className={`risk-panel__row${activeCountry === c.country ? ' active' : ''}`}
              role="listitem"
            >
              <button
                type="button"
                className="risk-panel__row-btn"
                onClick={() => onCountrySelect(c.country)}
                aria-label={`Seleccionar ${localizeCountry(c.country)} — riesgo compuesto ${c.composite}`}
                aria-pressed={activeCountry === c.country}
              >
                {/* Country name + band */}
                <div className="risk-panel__row-header">
                  <span className="risk-panel__country-name">{localizeCountry(c.country)}</span>
                  <span
                    className="risk-panel__band-badge"
                    style={{ color: bandColorVar(c.band), borderColor: bandColorVar(c.band) }}
                    title={`Banda: ${bandLabel(c.band)}`}
                  >
                    {bandLabel(c.band)}
                  </span>
                </div>

                {/* Composite score bar + numeric */}
                <div className="risk-panel__score-row">
                  <div className="risk-panel__score-bar-track" aria-hidden="true">
                    <div
                      className="risk-panel__score-bar-fill"
                      style={{
                        width: `${c.composite}%`,
                        backgroundColor: bandColorVar(c.band),
                      }}
                    />
                  </div>
                  <span
                    className="risk-panel__composite-num"
                    style={{ color: bandColorVar(c.band) }}
                    title="Puntuación CII compuesta (0-100)"
                  >
                    {c.composite.toFixed(1)}
                  </span>

                  {/* Trend arrow */}
                  <span
                    className="risk-panel__trend-arrow"
                    style={{ color: trendColor(c.trend) }}
                    title={`Tendencia: ${trendLabel(c.trend)}`}
                    aria-label={`Tendencia: ${trendLabel(c.trend)}`}
                  >
                    {trendArrow(c.trend)}
                  </span>
                </div>

                {/* Dynamic score + dominant component */}
                <div className="risk-panel__row-meta">
                  <span className="risk-panel__dynamic-score">
                    {c.dynamicScore != null
                      ? `Dinámico: ${c.dynamicScore.toFixed(1)}`
                      : 'Sin tendencia aún'}
                  </span>

                  {c.dominantComponent && (
                    <span
                      className="risk-panel__dom-component"
                      title={`Motor dominante: ${componentLabel(c.dominantComponent.key)} (puntuación ${c.dominantComponent.score.toFixed(1)})`}
                    >
                      {componentLabel(c.dominantComponent.key)}{' '}
                      <span className="risk-panel__dom-score">
                        {c.dominantComponent.score.toFixed(1)}
                      </span>
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Attribution — always visible (D-107 / feedback_data_tos) */}
      <footer className="risk-panel__attribution" aria-label="Atribución de datos">
        CII propio{' '}
        <span className="risk-panel__attr-sep" aria-hidden="true">·</span>{' '}
        datos:{' '}
        <a
          href="https://earthquake.usgs.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="risk-panel__attr-link"
        >
          USGS
        </a>
        {' / '}
        <a
          href="https://eonet.gsfc.nasa.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="risk-panel__attr-link"
        >
          NASA EONET
        </a>
        {' / '}
        <a
          href="https://www.gdeltproject.org"
          target="_blank"
          rel="noopener noreferrer"
          className="risk-panel__attr-link"
        >
          GDELT
        </a>
        {' / '}
        <a
          href="https://blog.gdeltproject.org/gdelt-global-knowledge-graph/"
          target="_blank"
          rel="noopener noreferrer"
          className="risk-panel__attr-link"
        >
          GKG
        </a>
      </footer>
    </div>
  );
}
