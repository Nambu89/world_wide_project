/**
 * RadarPanel — Geoeconomic radar (T-20 / D-206).
 *
 * Responsibility: one panel per domain (D-206). NOT a sub-tab inside EventsPanel.
 * Shows 6 geoeconomic sections, each collapsible (accordion).
 * Per section: ranked headlines (by |tone|), trend indicator, top entities.
 *
 * political_instability: no dedicated signal layer (reuses events geo).
 * Map-tie: selecting a section calls `onSectionSelect(section)` so App can
 * make the corresponding SIGNAL_LAYER visible.
 *
 * Attribution (feedback_data_tos — always visible):
 *   "Source: The GDELT Project (gdeltproject.org)"
 *
 * Responsive: mobile-first 375px, inherits panel-wrapper layout from App.
 *
 * ADR-008: breakpoints via CSS tokens ({--bp-mobile} / {--bp-desktop}).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSignals,
  getSignalTrend,
  type RadarSignal,
  type SignalTrendPoint,
} from '../api/client';

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

export const RADAR_SECTIONS = [
  {
    key: 'political_instability' as const,
    label: 'Political Instability',
    icon: 'PI',
    color: 'var(--color-danger)',
    hasSignalLayer: false,  // reuses events geo — no sig-* toggle key
    toggleKey: null,
  },
  {
    key: 'commodities_energy' as const,
    label: 'Commodities & Energy',
    icon: 'CE',
    color: '#f59e0b',
    hasSignalLayer: true,
    toggleKey: 'sig-commodities-energy',
  },
  {
    key: 'critical_minerals' as const,
    label: 'Critical Minerals',
    icon: 'CM',
    color: '#14b8a6',
    hasSignalLayer: true,
    toggleKey: 'sig-critical-minerals',
  },
  {
    key: 'semis_ai_tech' as const,
    label: 'Semis & AI Tech',
    icon: 'AT',
    color: '#818cf8',
    hasSignalLayer: true,
    toggleKey: 'sig-semis-ai-tech',
  },
  {
    key: 'digital_infra_cyber' as const,
    label: 'Digital Infra & Cyber',
    icon: 'DC',
    color: '#38bdf8',
    hasSignalLayer: true,
    toggleKey: 'sig-digital-infra-cyber',
  },
  {
    key: 'trade_sanctions' as const,
    label: 'Trade & Sanctions',
    icon: 'TS',
    color: '#fb7185',
    hasSignalLayer: true,
    toggleKey: 'sig-trade-sanctions',
  },
] as const;

export type RadarSectionKey = (typeof RADAR_SECTIONS)[number]['key'];

/** Toggle keys exported for App.tsx initial activeLayers set */
export const SIGNAL_TOGGLE_KEYS: string[] = RADAR_SECTIONS
  .filter((s) => s.toggleKey !== null)
  .map((s) => s.toggleKey as string);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; signals: RadarSignal[]; trend: SignalTrendPoint[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 10;
// 24 h ago
const DEFAULT_SINCE = () => Date.now() - 24 * 60 * 60 * 1000;

function formatDate(isoOrNull: string | null): string {
  if (!isoOrNull) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(isoOrNull));
  } catch {
    return isoOrNull;
  }
}

function toneLabel(tone: number | null): string {
  if (tone == null) return '—';
  if (tone < -5) return 'Very Negative';
  if (tone < -2) return 'Negative';
  if (tone < 0) return 'Slightly Neg.';
  if (tone === 0) return 'Neutral';
  if (tone < 2) return 'Slightly Pos.';
  if (tone < 5) return 'Positive';
  return 'Very Positive';
}

function toneColor(tone: number | null): string {
  if (tone == null) return 'var(--color-text-secondary)';
  if (tone < -3) return 'var(--color-danger)';
  if (tone < 0) return 'var(--color-warning)';
  return 'var(--color-success)';
}

/** Extract top N unique entity names from a list of signals. */
function topEntities(signals: RadarSignal[], field: 'organizations' | 'persons', n = 5): string[] {
  const counts = new Map<string, number>();
  for (const sig of signals) {
    for (const e of sig[field]) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([e]) => e);
}

/** Compute average tone for a set of signals. */
function avgTone(signals: RadarSignal[]): number | null {
  const tones = signals.map((s) => s.tone).filter((t): t is number => t != null);
  if (tones.length === 0) return null;
  return tones.reduce((a, b) => a + b, 0) / tones.length;
}

// ---------------------------------------------------------------------------
// TrendBar — simple inline sparkline via canvas
// ---------------------------------------------------------------------------

interface TrendBarProps {
  trend: SignalTrendPoint[];
}

function TrendBar({ trend }: TrendBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || trend.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const maxVol = Math.max(...trend.map((p) => p.volume), 1);
    const barW = Math.max(2, Math.floor(width / trend.length) - 1);

    trend.forEach((p, i) => {
      const h = Math.round((p.volume / maxVol) * (height - 2));
      const tone = p.avgTone ?? 0;
      // Color: negative tone → warning/danger, positive → success
      const color =
        tone < -3
          ? 'rgba(239,68,68,0.8)'
          : tone < 0
          ? 'rgba(245,158,11,0.8)'
          : 'rgba(34,197,94,0.7)';
      ctx.fillStyle = color;
      ctx.fillRect(i * (barW + 1), height - h, barW, h);
    });
  }, [trend]);

  if (trend.length === 0) return null;
  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={28}
      className="radar-panel__trend-canvas"
      aria-label="Signal volume trend"
      title="Volume trend (24h, colored by tone)"
    />
  );
}

// ---------------------------------------------------------------------------
// SectionAccordion
// ---------------------------------------------------------------------------

interface SectionAccordionProps {
  sectionMeta: (typeof RADAR_SECTIONS)[number];
  isActive: boolean;
  onSelect: () => void;
}

function SectionAccordion({ sectionMeta, isActive, onSelect }: SectionAccordionProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SectionState>({ status: 'idle' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    const since = DEFAULT_SINCE();

    Promise.all([
      getSignals({ section: sectionMeta.key, since, limit: DEFAULT_LIMIT }),
      getSignalTrend(sectionMeta.key, { since }),
    ])
      .then(([signals, trend]) => {
        if (signals.length === 0) {
          setState({ status: 'empty' });
        } else {
          setState({ status: 'ok', signals, trend });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ status: 'error', message });
      });
  }, [sectionMeta.key]);

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && state.status === 'idle') {
      load();
    }
    onSelect();
  };

  const currentTone =
    state.status === 'ok' ? avgTone(state.status === 'ok' ? state.signals : []) : null;

  return (
    <div
      className={`radar-panel__section${open ? ' open' : ''}${isActive ? ' active' : ''}`}
      aria-expanded={open}
    >
      {/* Section header / toggle */}
      <button
        type="button"
        className="radar-panel__section-hdr"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${sectionMeta.label}`}
        style={{ '--section-color': sectionMeta.color } as React.CSSProperties}
      >
        <span
          className="radar-panel__section-icon"
          aria-hidden="true"
          style={{ backgroundColor: sectionMeta.color }}
        >
          {sectionMeta.icon}
        </span>
        <span className="radar-panel__section-label">{sectionMeta.label}</span>

        {/* Inline tone indicator — visible even when collapsed */}
        {state.status === 'ok' && (
          <span
            className="radar-panel__tone-badge"
            style={{ color: toneColor(currentTone) }}
            title={`Avg tone: ${currentTone?.toFixed(1) ?? '—'}`}
          >
            {toneLabel(currentTone)}
          </span>
        )}
        {state.status === 'loading' && (
          <span className="radar-panel__section-loading" aria-label="Loading" />
        )}
        <span className="radar-panel__chevron" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Accordion body */}
      {open && (
        <div className="radar-panel__section-body">
          {/* Loading */}
          {state.status === 'loading' && (
            <div className="state-loading" role="status">
              <div className="spinner" aria-hidden="true" />
              <span>Loading signals...</span>
            </div>
          )}

          {/* Error */}
          {state.status === 'error' && (
            <div className="state-error" role="alert">
              <div className="state-error__title">Failed to load signals</div>
              <div>{state.message}</div>
              <button className="state-error__retry" onClick={load} type="button">
                Retry
              </button>
            </div>
          )}

          {/* Empty */}
          {state.status === 'empty' && (
            <div className="state-empty" role="status">
              <div className="state-empty__icon" aria-hidden="true">--</div>
              <div>No signals in the last 24h</div>
              <div>Check back later — scheduler updates every 15 min.</div>
            </div>
          )}

          {/* Data */}
          {state.status === 'ok' && (
            <>
              {/* Trend sparkline + tone summary */}
              <div className="radar-panel__trend-row">
                <TrendBar trend={state.trend} />
                <span
                  className="radar-panel__tone-label"
                  style={{ color: toneColor(currentTone) }}
                  title="Average tone of signals in the last 24h (GDELT GKG GlobalEventTone)"
                >
                  {currentTone != null ? currentTone.toFixed(1) : '—'}
                  <span className="radar-panel__tone-sub"> avg tone</span>
                </span>
              </div>

              {/* Top headlines */}
              <ul
                className="radar-panel__headlines"
                role="list"
                aria-label={`Top signals for ${sectionMeta.label}`}
              >
                {state.signals.map((sig) => (
                  <li key={sig.key} className="radar-panel__headline-row">
                    {sig.tone != null && (
                      <span
                        className="radar-panel__headline-tone"
                        style={{ color: toneColor(sig.tone) }}
                        title={`Tone: ${sig.tone.toFixed(1)}`}
                      >
                        {sig.tone.toFixed(1)}
                      </span>
                    )}
                    <div className="radar-panel__headline-body">
                      <div className="radar-panel__headline-title">
                        {sig.url ? (
                          <a
                            href={sig.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="radar-panel__headline-link"
                          >
                            {sig.title}
                          </a>
                        ) : (
                          sig.title
                        )}
                      </div>
                      <div className="radar-panel__headline-meta">
                        {sig.country && (
                          <span className="radar-panel__headline-country">{sig.country}</span>
                        )}
                        {sig.occurredAt && (
                          <time
                            dateTime={sig.occurredAt}
                            className="radar-panel__headline-date"
                          >
                            {formatDate(sig.occurredAt)}
                          </time>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Top entities */}
              {(() => {
                const orgs = topEntities(state.signals, 'organizations');
                const persons = topEntities(state.signals, 'persons');
                if (orgs.length === 0 && persons.length === 0) return null;
                return (
                  <div className="radar-panel__entities">
                    {orgs.length > 0 && (
                      <div className="radar-panel__entity-group">
                        <div className="radar-panel__entity-label">Organizations</div>
                        <div className="radar-panel__entity-chips">
                          {orgs.map((e) => (
                            <span key={e} className="radar-panel__entity-chip">
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {persons.length > 0 && (
                      <div className="radar-panel__entity-group">
                        <div className="radar-panel__entity-label">People</div>
                        <div className="radar-panel__entity-chips">
                          {persons.map((e) => (
                            <span key={e} className="radar-panel__entity-chip">
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadarPanel
// ---------------------------------------------------------------------------

interface RadarPanelProps {
  /** Currently active section in the map (for visual highlight). */
  activeSection: RadarSectionKey | null;
  /** Called when user selects a section — parent syncs map layer. */
  onSectionSelect: (section: RadarSectionKey) => void;
}

export default function RadarPanel({ activeSection, onSectionSelect }: RadarPanelProps) {
  return (
    <div className="radar-panel">
      <h2 className="radar-panel__heading">Geoeconomic Radar</h2>

      <div className="radar-panel__sections" role="list" aria-label="Radar sections">
        {RADAR_SECTIONS.map((sec) => (
          <SectionAccordion
            key={sec.key}
            sectionMeta={sec}
            isActive={activeSection === sec.key}
            onSelect={() => onSectionSelect(sec.key)}
          />
        ))}
      </div>

      {/* Attribution — always visible (feedback_data_tos / D-107) */}
      <footer className="radar-panel__attribution" aria-label="Data attribution">
        <a
          href="https://www.gdeltproject.org"
          target="_blank"
          rel="noopener noreferrer"
          className="radar-panel__attr-link"
        >
          Source: The GDELT Project (gdeltproject.org)
        </a>
      </footer>
    </div>
  );
}
