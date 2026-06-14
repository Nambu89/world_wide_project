/**
 * EventsPanel — global events from /api/events.
 *
 * Shows the top events by severity/recency with per-type toggles.
 * Groups toggles by category (natural / conflict).
 * Explicit loading / empty / error states.
 * Responsive: drawer on mobile (375px), sidebar on desktop (1200px) via CSS.
 *
 * Attribution (D-107 / feedback_data_tos):
 *  - "U.S. Geological Survey" (USGS earthquakes — U.S. public domain)
 *  - "Data: NASA EONET" (natural disasters — 17 U.S.C. §105, public domain)
 *  - "Source: The GDELT Project (gdeltproject.org)" (conflict/protest — free use with citation)
 */

import { useCallback, useEffect, useState } from 'react';
import { getEvents, type GlobalEvent, type EventFilter } from '../api/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 30;
const DEFAULT_MIN_SEVERITY = 20;

/** Event types grouped by category for the toggle UI */
const EVENT_TYPE_GROUPS: Array<{
  category: string;
  label: string;
  types: Array<{ key: string; label: string; icon: string }>;
}> = [
  {
    category: 'natural',
    label: 'Natural',
    types: [
      { key: 'earthquake', label: 'Earthquakes', icon: 'EQ' },
      { key: 'wildfire',   label: 'Wildfires',   icon: 'WF' },
      { key: 'volcano',    label: 'Volcanoes',    icon: 'VL' },
      { key: 'storm',      label: 'Storms',       icon: 'ST' },
      { key: 'flood',      label: 'Floods',       icon: 'FL' },
    ],
  },
  {
    category: 'conflict',
    label: 'Conflict',
    types: [
      { key: 'conflict', label: 'Conflicts', icon: 'CF' },
      { key: 'protest',  label: 'Protests',  icon: 'PT' },
    ],
  },
];

/** All event type keys that the panel knows about */
const ALL_TYPE_KEYS = EVENT_TYPE_GROUPS.flatMap((g) => g.types.map((t) => t.key));

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function severityColor(severity: number): string {
  if (severity >= 70) return 'var(--color-danger)';
  if (severity >= 40) return 'var(--color-warning)';
  return 'var(--color-accent)';
}

interface SeverityBadgeProps {
  severity: number;
}

function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <span
      className="events-panel__severity"
      style={{ backgroundColor: severityColor(severity) }}
      aria-label={`Severity ${severity}`}
      title={`Severity: ${severity}/100`}
    >
      {Math.round(severity)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: GlobalEvent;
}

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

const SOURCE_DISPLAY: Record<string, string> = {
  usgs:  'USGS',
  eonet: 'NASA EONET',
  gdelt: 'GDELT',
};

function EventRow({ event }: EventRowProps) {
  const dateStr = formatDate(event.occurredAt ?? event.capturedAt);
  const sourceLabel = SOURCE_DISPLAY[event.source] ?? event.source.toUpperCase();

  return (
    <li className="events-panel__event-row">
      <div className="events-panel__event-header">
        <SeverityBadge severity={event.severity} />
        <div className="events-panel__event-info">
          <div className="events-panel__event-title">
            {event.url ? (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="events-panel__event-link"
              >
                {event.title}
              </a>
            ) : (
              event.title
            )}
          </div>
          <div className="events-panel__event-meta">
            <span className="events-panel__event-type">{event.eventType}</span>
            {event.country && (
              <>
                <span className="events-panel__meta-sep" aria-hidden="true">·</span>
                <span>{event.country}</span>
              </>
            )}
            {dateStr && (
              <>
                <span className="events-panel__meta-sep" aria-hidden="true">·</span>
                <time dateTime={event.occurredAt ?? event.capturedAt}>{dateStr}</time>
              </>
            )}
            <span className="events-panel__meta-sep" aria-hidden="true">·</span>
            <span className="events-panel__event-source">{sourceLabel}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; events: GlobalEvent[] };

// ---------------------------------------------------------------------------
// EventsPanel
// ---------------------------------------------------------------------------

interface EventsPanelProps {
  /** Controlled set of active layer toggles; panel writes to parent via onToggle. */
  activeTypes: Set<string>;
  onToggle: (eventType: string) => void;
}

export default function EventsPanel({ activeTypes, onToggle }: EventsPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'loading' });

  const load = useCallback(() => {
    setPanelState({ status: 'loading' });

    const filter: EventFilter = {
      minSeverity: DEFAULT_MIN_SEVERITY,
      limit: DEFAULT_LIMIT,
    };

    getEvents(filter)
      .then((response) => {
        if (response.events.length === 0) {
          setPanelState({ status: 'empty' });
        } else {
          // Sort by severity desc, then by capturedAt desc
          const sorted = [...response.events].sort((a, b) => {
            const sevDiff = b.severity - a.severity;
            if (sevDiff !== 0) return sevDiff;
            return b.capturedAt.localeCompare(a.capturedAt);
          });
          setPanelState({ status: 'ok', events: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setPanelState({ status: 'error', message });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filtered events list: only show event types that are toggled on
  const visibleEvents =
    panelState.status === 'ok'
      ? panelState.events.filter((e) => activeTypes.has(`evt-${e.eventType}`))
      : [];

  return (
    <div className="events-panel">
      <h2 className="events-panel__heading">Global Events</h2>

      {/* ----------------------------------------------------------------
          Toggle controls — grouped by category (natural / conflict)
          Each toggle mirrors a toggleKey in layers.config.ts (evt-{type})
          ---------------------------------------------------------------- */}
      <div className="events-panel__toggles" role="group" aria-label="Event type filters">
        {EVENT_TYPE_GROUPS.map((group) => (
          <div key={group.category} className="events-panel__toggle-group">
            <div className="events-panel__toggle-group-label" aria-hidden="true">
              {group.label}
            </div>
            <div className="events-panel__toggle-row">
              {group.types.map((t) => {
                const toggleKey = `evt-${t.key}`;
                const active = activeTypes.has(toggleKey);
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={`events-panel__toggle-btn${active ? ' active' : ''}`}
                    onClick={() => onToggle(toggleKey)}
                    aria-pressed={active}
                    aria-label={`Toggle ${t.label}`}
                    title={t.label}
                  >
                    <span className="events-panel__toggle-icon" aria-hidden="true">
                      {t.icon}
                    </span>
                    <span className="events-panel__toggle-label">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------------------
          Loading state
          ---------------------------------------------------------------- */}
      {panelState.status === 'loading' && (
        <div className="state-loading" role="status" aria-label="Loading events">
          <div className="spinner" aria-hidden="true" />
          <span>Loading events...</span>
        </div>
      )}

      {/* ----------------------------------------------------------------
          Error state
          ---------------------------------------------------------------- */}
      {panelState.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Failed to load events</div>
          <div>{panelState.message}</div>
          <button className="state-error__retry" onClick={load} type="button">
            Retry
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          Empty state
          ---------------------------------------------------------------- */}
      {panelState.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">--</div>
          <div>No events above severity {DEFAULT_MIN_SEVERITY}</div>
          <div>Check back later — the scheduler updates every 15 minutes.</div>
        </div>
      )}

      {/* ----------------------------------------------------------------
          Empty-after-filter state (data loaded but all types toggled off)
          ---------------------------------------------------------------- */}
      {panelState.status === 'ok' && visibleEvents.length === 0 && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">--</div>
          <div>All event types are hidden</div>
          <div>Enable at least one type above to see events.</div>
        </div>
      )}

      {/* ----------------------------------------------------------------
          Events list — top by severity / recency
          ---------------------------------------------------------------- */}
      {panelState.status === 'ok' && visibleEvents.length > 0 && (
        <ul className="events-panel__list" role="list" aria-label="Top global events">
          {visibleEvents.map((event) => (
            <EventRow key={event.key} event={event} />
          ))}
        </ul>
      )}

      {/* ----------------------------------------------------------------
          Attribution block (D-107 / feedback_data_tos)
          Always visible regardless of load state.
          ---------------------------------------------------------------- */}
      <footer className="events-panel__attribution" aria-label="Data attribution">
        <span>U.S. Geological Survey</span>
        <span className="events-panel__attr-sep" aria-hidden="true">·</span>
        <span>Data: NASA EONET</span>
        <span className="events-panel__attr-sep" aria-hidden="true">·</span>
        <a
          href="https://www.gdeltproject.org"
          target="_blank"
          rel="noopener noreferrer"
          className="events-panel__attr-link"
        >
          Source: The GDELT Project (gdeltproject.org)
        </a>
      </footer>
    </div>
  );
}

/** All toggle keys managed by EventsPanel (for App.tsx initial state) */
export const EVENTS_TOGGLE_KEYS: string[] = ALL_TYPE_KEYS.map((k) => `evt-${k}`);
