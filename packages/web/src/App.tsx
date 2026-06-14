/**
 * App — root layout.
 *
 * Mobile-first: map fills 100vh, panel is a bottom drawer (collapsible).
 * Desktop (>=1200px): map shrinks, panel is a side column (CSS handles this).
 *
 * Layer toggles sit over the map via absolute positioning.
 *
 * T-13: EventsPanel mounted alongside FinancePanel.
 *  - Panel tabs: Finance | Events
 *  - Event type toggles are owned by App and threaded into both EventsPanel
 *    (for the list filter) and MapView (via activeLayers Set).
 *  - activeLayers = finance toggles (TOGGLE_KEYS from layers.config) +
 *    event type toggles (EVENTS_TOGGLE_KEYS from EventsPanel).
 *    All default to ON so the map is populated on load.
 */

import { useState } from 'react';
import MapView from './map/MapView';
import FinancePanel from './panels/FinancePanel';
import EventsPanel, { EVENTS_TOGGLE_KEYS } from './panels/EventsPanel';
import { LAYERS, TOGGLE_KEYS } from './map/layers.config';

// ---------------------------------------------------------------------------
// Active layer set helpers
// ---------------------------------------------------------------------------

/**
 * Build the initial activeLayers Set.
 * Includes all map layer toggle keys + all event type toggle keys.
 * All start enabled so the map is populated on first load.
 */
function buildInitialActive(): Set<string> {
  return new Set([...TOGGLE_KEYS, ...EVENTS_TOGGLE_KEYS]);
}

// ---------------------------------------------------------------------------
// Panel tab types
// ---------------------------------------------------------------------------

type PanelTab = 'finance' | 'events';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [activeLayers, setActiveLayers] = useState<Set<string>>(buildInitialActive);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('events');

  /** Toggle a single layer key in the activeLayers set. */
  const toggleLayer = (key: string) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Label for a legacy map toggle (non-events). */
  const labelForKey = (key: string): string => {
    return LAYERS.find((l) => l.toggleKey === key)?.label?.split(' ')[0] ?? key;
  };

  // Non-event legacy toggle keys (finance domain, etc.)
  // After T-13 there are none (all layers now use evt-* keys), but kept for
  // forward-compat when finance map layers are added.
  const legacyToggleKeys = TOGGLE_KEYS.filter(
    (k) => !EVENTS_TOGGLE_KEYS.includes(k)
  );

  const panelTitle = activeTab === 'finance' ? 'Finance' : 'Events';

  return (
    <div className="app-layout">
      {/* Map — fills viewport on mobile, shrinks on desktop via CSS */}
      <MapView activeLayers={activeLayers} />

      {/* Layer toggle controls (non-events legacy; event types controlled in panel) */}
      {legacyToggleKeys.length > 0 && (
        <nav className="layer-toggles" aria-label="Map layer controls">
          {legacyToggleKeys.map((key) => (
            <button
              key={key}
              className={`layer-toggle-btn${activeLayers.has(key) ? ' active' : ''}`}
              onClick={() => toggleLayer(key)}
              type="button"
              aria-pressed={activeLayers.has(key)}
              aria-label={`Toggle ${labelForKey(key)} layer`}
            >
              {labelForKey(key)}
            </button>
          ))}
        </nav>
      )}

      {/* Panel — drawer on mobile, sidebar on desktop */}
      <aside
        className={`panel-wrapper${drawerOpen ? '' : ' collapsed'}`}
        aria-label="Data panel"
      >
        {/* Drawer handle — only shown on mobile (hidden via CSS on desktop) */}
        <div
          className="panel-handle"
          onClick={() => setDrawerOpen((o) => !o)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setDrawerOpen((o) => !o)}
          role="button"
          tabIndex={0}
          aria-expanded={drawerOpen}
          aria-controls="panel-content"
          aria-label={drawerOpen ? 'Collapse panel' : 'Expand panel'}
        >
          <span className="panel-handle-title">{panelTitle}</span>
          <div className="panel-handle-bar" aria-hidden="true" />
        </div>

        {/* Panel tab switcher */}
        <div className="panel-tabs" role="tablist" aria-label="Domain panels">
          <button
            role="tab"
            type="button"
            className={`panel-tab${activeTab === 'finance' ? ' active' : ''}`}
            aria-selected={activeTab === 'finance'}
            aria-controls="panel-content"
            onClick={() => setActiveTab('finance')}
          >
            Finance
          </button>
          <button
            role="tab"
            type="button"
            className={`panel-tab${activeTab === 'events' ? ' active' : ''}`}
            aria-selected={activeTab === 'events'}
            aria-controls="panel-content"
            onClick={() => setActiveTab('events')}
          >
            Events
          </button>
        </div>

        {/* Panel content */}
        <div className="panel-content" id="panel-content" role="tabpanel" aria-label={`${panelTitle} panel`}>
          {activeTab === 'finance' && <FinancePanel />}
          {activeTab === 'events' && (
            <EventsPanel
              activeTypes={activeLayers}
              onToggle={toggleLayer}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
