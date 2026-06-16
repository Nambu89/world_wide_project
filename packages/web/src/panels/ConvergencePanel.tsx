/**
 * ConvergencePanel — Convergence Signals panel (T-34 / Fase 2 rebanada 5).
 *
 * Responsibility: display convergence signals sorted by strength (descending).
 * Per signal: country, family badges, strength bar, trend arrow, sourceCount,
 *   topDimension, firstDetectedAt ("desde hace N").
 * Map-tie: selecting a signal row calls onCountrySelect(country) so App can
 *   set activeCountry → MapView flies to that country centroid.
 *
 * States: loading / empty / error — ALWAYS explicit (D-408).
 *   empty = EXPECTED (0 signals) — distinct from error, with informative copy.
 *   error = catch (network/server failure) — distinct from empty.
 *
 * Attribution (always visible):
 *   "Motor de convergencia propio · datos: USGS/NASA EONET/GDELT/GKG"
 *
 * Responsive: mobile-first 375px → desktop 1200px (ADR-008).
 * Design tokens only — no hardcoded hex values ({colors.*} / {rounded.*} / {typography.*}).
 */

import { useCallback, useEffect, useState } from 'react';
import { getConvergence, type ConvergenceCountry } from '../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trend arrow symbol */
function trendArrow(trend: 'rising' | 'falling' | 'stable' | null): string {
  if (trend === 'rising')  return '▲';
  if (trend === 'falling') return '▼';
  return '–';
}

/** Trend arrow color token */
function trendColor(trend: 'rising' | 'falling' | 'stable' | null): string {
  if (trend === 'rising')  return 'var(--color-danger)';
  if (trend === 'falling') return 'var(--color-success)';
  return 'var(--color-text-secondary)';
}

/** Strength bar color: amber → orange-red → red (mirrors CONVERGENCE_STROKE_COLOR ramp) */
function strengthColor(strength: number): string {
  if (strength >= 0.7) return 'var(--color-danger)';
  if (strength >= 0.4) return '#f97316';  // orange — between warning and danger
  return 'var(--color-warning)';
}

/**
 * Human-readable "desde hace N" from an ISO timestamp.
 * Returns e.g. "hace 3 días", "hace 2 horas", "hace menos de 1 min".
 */
function sinceLabel(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);

  if (days >= 1)  return `hace ${days} día${days === 1 ? '' : 's'}`;
  if (hours >= 1) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;
  if (mins >= 1)  return `hace ${mins} min`;
  return 'hace menos de 1 min';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; signals: ConvergenceCountry[] };

// ---------------------------------------------------------------------------
// ConvergencePanel
// ---------------------------------------------------------------------------

interface ConvergencePanelProps {
  /** Country currently selected — for visual highlight in list. */
  activeCountry: string | null;
  /** Called when user selects a signal row — parent syncs map fly-to (D-406/R-2). */
  onCountrySelect: (country: string) => void;
}

export default function ConvergencePanel({
  activeCountry,
  onCountrySelect,
}: ConvergencePanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'idle' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getConvergence()
      .then((signals) => {
        if (signals.length === 0) {
          // D-408: empty is EXPECTED — distinct from error, with informative copy
          setState({ status: 'empty' });
        } else {
          // Sort descending by strength (highest convergence first)
          const sorted = [...signals].sort((a, b) => b.strength - a.strength);
          setState({ status: 'ok', signals: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ status: 'error', message });
      });
  }, []);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="convergence-panel">
      <h2 className="convergence-panel__heading">Convergence Signals</h2>

      {/* Loading */}
      {state.status === 'loading' && (
        <div className="state-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Loading convergence signals...</span>
        </div>
      )}

      {/* Error — network or server failure */}
      {state.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Failed to load convergence data</div>
          <div>{state.message}</div>
          <button className="state-error__retry" onClick={load} type="button">
            Retry
          </button>
        </div>
      )}

      {/* Empty — D-408: expected case, informative copy, DISTINCT from error */}
      {state.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">◎</div>
          <div className="convergence-panel__empty-title">Sin convergencias activas</div>
          <div className="convergence-panel__empty-desc">
            La plataforma detecta convergencias cuando ≥2 fuentes de dato coinciden
            en deterioro en el mismo país. Vuelve más tarde o amplía el ventana de datos.
          </div>
        </div>
      )}

      {/* Data */}
      {state.status === 'ok' && (
        <ul
          className="convergence-panel__list"
          role="list"
          aria-label="Países por intensidad de convergencia"
        >
          {state.signals.map((s) => (
            <li
              key={s.country}
              className={`convergence-panel__row${activeCountry === s.country ? ' active' : ''}`}
              role="listitem"
            >
              <button
                type="button"
                className="convergence-panel__row-btn"
                onClick={() => onCountrySelect(s.country)}
                aria-label={`Select ${s.country} — convergence strength ${(s.strength * 100).toFixed(0)}%`}
                aria-pressed={activeCountry === s.country}
              >
                {/* Header: country + sourceCount badge */}
                <div className="convergence-panel__row-header">
                  <span className="convergence-panel__country-name">{s.country}</span>
                  <span
                    className="convergence-panel__source-badge"
                    title={`${s.sourceCount} fuente${s.sourceCount === 1 ? '' : 's'}`}
                  >
                    {s.sourceCount} src
                  </span>
                </div>

                {/* Family badges (events+signals) */}
                {s.families.length > 0 && (
                  <div className="convergence-panel__families" aria-label="Data families">
                    {s.families.map((f) => (
                      <span key={f} className="convergence-panel__family-badge">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Strength bar + numeric + trend */}
                <div className="convergence-panel__strength-row">
                  <div
                    className="convergence-panel__strength-track"
                    aria-hidden="true"
                    title={`Strength: ${(s.strength * 100).toFixed(0)}%`}
                  >
                    <div
                      className="convergence-panel__strength-fill"
                      style={{
                        width: `${Math.min(s.strength * 100, 100)}%`,
                        backgroundColor: strengthColor(s.strength),
                      }}
                    />
                  </div>
                  <span
                    className="convergence-panel__strength-num"
                    style={{ color: strengthColor(s.strength) }}
                    title="Strength (0-1)"
                  >
                    {(s.strength * 100).toFixed(0)}%
                  </span>

                  {/* Trend arrow */}
                  <span
                    className="convergence-panel__trend-arrow"
                    style={{ color: trendColor(s.trend) }}
                    title={`Trend: ${s.trend ?? 'stable'}`}
                    aria-label={`Trend: ${s.trend ?? 'stable'}`}
                  >
                    {trendArrow(s.trend)}
                  </span>
                </div>

                {/* Meta: topDimension + firstDetectedAt */}
                <div className="convergence-panel__row-meta">
                  {s.topDimension && (
                    <span
                      className="convergence-panel__top-dimension"
                      title={`Top dimension: ${s.topDimension}`}
                    >
                      {s.topDimension}
                    </span>
                  )}
                  <span className="convergence-panel__since">
                    {sinceLabel(s.firstDetectedAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Attribution — always visible (D-107 / feedback_data_tos) */}
      <footer className="convergence-panel__attribution" aria-label="Data attribution">
        Motor de convergencia propio{' '}
        <span className="convergence-panel__attr-sep" aria-hidden="true">·</span>{' '}
        datos:{' '}
        <a
          href="https://earthquake.usgs.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="convergence-panel__attr-link"
        >
          USGS
        </a>
        {' / '}
        <a
          href="https://eonet.gsfc.nasa.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="convergence-panel__attr-link"
        >
          NASA EONET
        </a>
        {' / '}
        <a
          href="https://www.gdeltproject.org"
          target="_blank"
          rel="noopener noreferrer"
          className="convergence-panel__attr-link"
        >
          GDELT
        </a>
        {' / '}
        <a
          href="https://blog.gdeltproject.org/gdelt-global-knowledge-graph/"
          target="_blank"
          rel="noopener noreferrer"
          className="convergence-panel__attr-link"
        >
          GKG
        </a>
      </footer>
    </div>
  );
}
