/**
 * ChokepointsPanel — "Rutas / Chokepoints" panel (slice A).
 *
 * Lists trade chokepoints sorted by disruption score (desc). Per row:
 * nameEs + status badge (Estable/Vigilancia/Disrupción) + score bar + commodities +
 * dependent economies + DOCUMENTED economic-impact cascade (impactEs, always visible).
 * Map-tie: selecting a row calls onSelect(id) → App sets activeChokepoint → MapView flies.
 *
 * States: loading / empty / error — always explicit. Responsive (ADR-008).
 */

import { useCallback, useEffect, useState } from 'react';
import { getChokepoints, type Chokepoint } from '../api/client';

type CpState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; rows: Chokepoint[] };

function statusColor(s: Chokepoint['status']): string {
  return s === 'disrupted' ? 'var(--color-danger)' : s === 'watch' ? 'var(--color-warning)' : '#14b8a6';
}
function statusLabel(s: Chokepoint['status']): string {
  return s === 'disrupted' ? 'Disrupción' : s === 'watch' ? 'Vigilancia' : 'Estable';
}

interface ChokepointsPanelProps {
  activeChokepoint: string | null;
  onSelect: (id: string) => void;
}

export default function ChokepointsPanel({ activeChokepoint, onSelect }: ChokepointsPanelProps) {
  const [state, setState] = useState<CpState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getChokepoints()
      .then((rows) => {
        if (rows.length === 0) {
          setState({ status: 'empty' });
        } else {
          const sorted = [...rows].sort((a, b) => b.score - a.score);
          setState({ status: 'ok', rows: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ status: 'error', message });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="chokepoints-panel">
      <h2 className="finance-panel__heading">Rutas comerciales</h2>

      {state.status === 'loading' && (
        <div className="state-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Cargando rutas...</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Error al cargar las rutas</div>
          <div>{state.message}</div>
          <button className="state-error__retry" onClick={load} type="button">Reintentar</button>
        </div>
      )}

      {state.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">⚓</div>
          <div>No hay datos de rutas disponibles</div>
        </div>
      )}

      {state.status === 'ok' && (
        <ul className="chokepoints-list" role="list" aria-label="Rutas por nivel de disrupción">
          {state.rows.map((c) => (
            <li
              key={c.id}
              className={`chokepoints-row${activeChokepoint === c.id ? ' active' : ''}`}
              style={{ listStyle: 'none' }}
            >
              <button
                type="button"
                className="chokepoints-row__btn"
                onClick={() => onSelect(c.id)}
                aria-pressed={activeChokepoint === c.id}
                aria-label={`Seleccionar ${c.nameEs} — estado ${statusLabel(c.status)}`}
              >
                <div className="chokepoints-row__header">
                  <span className="chokepoints-row__name">{c.nameEs}</span>
                  <span
                    className="chokepoints-row__status"
                    style={{ color: statusColor(c.status), borderColor: statusColor(c.status) }}
                  >
                    {statusLabel(c.status)}
                  </span>
                </div>

                <div className="chokepoints-row__bar" aria-hidden="true" title={`Riesgo: ${(c.score * 100).toFixed(0)}%`}>
                  <div
                    className="chokepoints-row__bar-fill"
                    style={{ width: `${Math.min(c.score * 100, 100)}%`, backgroundColor: statusColor(c.status) }}
                  />
                </div>

                {c.commodities.length > 0 && (
                  <div className="chokepoints-row__commodities">
                    {c.commodities.map((m) => (
                      <span key={m} className="chokepoints-row__chip">{m}</span>
                    ))}
                  </div>
                )}

                <p className="chokepoints-row__impact">{c.impactEs}</p>

                <div className="chokepoints-row__meta">
                  <span className="chokepoints-row__share">{c.worldShare}</span>
                  {c.dependentEconomies.length > 0 && (
                    <span className="chokepoints-row__deps">Afecta a: {c.dependentEconomies.join(', ')}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="chokepoints-panel__attribution" aria-label="Atribución de datos">
        Rutas comerciales (datos propios) · disrupción derivada de GDELT/USGS/GKG
      </footer>
    </div>
  );
}
