/**
 * IntelPanel — "Inteligencia" panel (slice B).
 *
 * Feed of AI-generated cause→consequence insight cards, sorted by severity.
 * Per card: title + category + severity/confidence badges + triggers (chips) +
 * predicted consequences (list, the cascade) + affected economies/commodities.
 *
 * States: loading / empty / error — always explicit. The empty state is EXPECTED
 * when no LLM key is configured or the daily job hasn't generated a batch yet.
 * Map-tie (click → highlight involved countries/chokepoints) DEFERRED to slice C.
 */

import { useCallback, useEffect, useState } from 'react';
import { getInsights, type Insight, type InsightsResult } from '../api/client';

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; result: InsightsResult };

const sevRank: Record<Insight['severity'], number> = { alta: 2, media: 1, baja: 0 };
function sevColor(s: Insight['severity']): string {
  return s === 'alta' ? 'var(--color-danger)' : s === 'media' ? 'var(--color-warning)' : '#14b8a6';
}
function sevLabel(s: Insight['severity']): string {
  return s === 'alta' ? 'Alta' : s === 'media' ? 'Media' : 'Baja';
}

interface IntelPanelProps {
  /** Called when a card is clicked — App routes to map-tie (D-803). */
  onSelect?: (insight: Insight) => void;
  /** Id of the currently selected card — for visual highlight. */
  activeId?: string | null;
}

export default function IntelPanel({ onSelect, activeId }: IntelPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getInsights()
      .then((result) => {
        if (result.insights.length === 0) {
          setState({ status: 'empty' });
        } else {
          const sorted = {
            ...result,
            insights: [...result.insights].sort((a, b) => sevRank[b.severity] - sevRank[a.severity]),
          };
          setState({ status: 'ok', result: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        setState({ status: 'error', message });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="intel-panel">
      <h2 className="finance-panel__heading">Inteligencia</h2>

      {state.status === 'loading' && (
        <div className="state-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Generando inteligencia...</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Error al cargar la inteligencia</div>
          <div>{state.message}</div>
          <button className="state-error__retry" onClick={load} type="button">Reintentar</button>
        </div>
      )}

      {state.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">🧠</div>
          <div className="intel-panel__empty-title">Sin inteligencia generada todavía</div>
          <div className="intel-panel__empty-desc">
            El motor IA relaciona las señales activas y predice consecuencias en segundo plano.
            Requiere una clave LLM configurada; vuelve tras el próximo ciclo.
          </div>
        </div>
      )}

      {state.status === 'ok' && (
        <ul className="intel-list" role="list" aria-label="Tarjetas de inteligencia por severidad">
          {state.result.insights.map((c) => (
            <li key={c.id} data-sev={c.severity} className={`intel-card${activeId === c.id ? ' active' : ''}`} role="listitem">
              <button
                type="button"
                className="intel-card__btn"
                onClick={() => onSelect?.(c)}
                aria-pressed={activeId === c.id}
                aria-label={`Perspectiva: ${c.title}`}
              >
              <div className="intel-card__header">
                <span className="intel-card__title">{c.title}</span>
                <span
                  className="intel-card__severity"
                  style={{ color: sevColor(c.severity), borderColor: sevColor(c.severity) }}
                  title={`Severidad ${sevLabel(c.severity)} · confianza ${c.confidence}`}
                >
                  {sevLabel(c.severity)}
                </span>
              </div>

              <div className="intel-card__meta">
                <span className="intel-card__category">{c.category}</span>
                <span className="intel-card__confidence">confianza: {c.confidence}</span>
              </div>

              {c.triggers.length > 0 && (
                <div className="intel-card__triggers" aria-label="Disparadores">
                  {c.triggers.map((t, i) => (
                    <span key={i} className="intel-card__chip">{t}</span>
                  ))}
                </div>
              )}

              <ul className="intel-card__consequences" aria-label="Consecuencias predichas">
                {c.consequences.map((q, i) => (
                  <li key={i} className="intel-card__consequence">{q}</li>
                ))}
              </ul>

              {c.affected.length > 0 && (
                <div className="intel-card__affected">Afecta a: {c.affected.join(', ')}</div>
              )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="intel-panel__attribution" aria-label="Atribución">
        {state.status === 'ok' && state.result.model
          ? `Generado por IA (${state.result.model}) · predicción, no certeza`
          : 'Inteligencia generada por IA · predicción, no certeza'}
      </footer>
    </div>
  );
}
