/**
 * App — root layout.
 *
 * Mobile-first:  map fills 100vh, panel is a bottom drawer (collapsible).
 * Desktop (>=1200px): map shrinks, panel is a side column (CSS handles this).
 *
 * Layer toggles sit over the map via absolute positioning.
 */

import { useState } from 'react';
import MapView from './map/MapView';
import FinancePanel from './panels/FinancePanel';
import { TOGGLE_KEYS, LAYERS } from './map/layers.config';

/** Build initial active set — all keys on by default */
function buildInitialActive(): Set<string> {
  return new Set(TOGGLE_KEYS);
}

/** Human-readable label for a toggle key (uses first layer with that key) */
function labelForKey(key: string): string {
  return LAYERS.find((l) => l.toggleKey === key)?.label?.split(' ')[0] ?? key;
}

export default function App() {
  const [activeLayers, setActiveLayers] = useState<Set<string>>(buildInitialActive);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleLayer = (key: string) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="app-layout">
      {/* Map — fills viewport on mobile, shrinks on desktop via CSS */}
      <MapView activeLayers={activeLayers} />

      {/* Layer toggle controls */}
      <nav className="layer-toggles" aria-label="Map layer controls">
        {TOGGLE_KEYS.map((key) => (
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
          <span className="panel-handle-title">Finance</span>
          <div className="panel-handle-bar" aria-hidden="true" />
        </div>

        {/* Panel content */}
        <div className="panel-content" id="panel-content" role="region" aria-label="Finance panel">
          <FinancePanel />
        </div>
      </aside>
    </div>
  );
}
