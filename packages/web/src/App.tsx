/**
 * App — root layout.
 *
 * Mobile-first: map fills 100vh, panel is a bottom drawer (collapsible).
 * Desktop (>=1200px): map shrinks, panel is a side column (CSS handles this).
 *
 * Layer toggles sit over the map via absolute positioning.
 *
 * T-13: EventsPanel mounted alongside FinancePanel.
 * T-20: RadarPanel (3rd tab) + activeSection state for map-tie.
 * T-26: RiskPanel (4th tab 'Risk') + activeCountry state for map-tie.
 *   - Panel tabs: Finance | Events | Radar | Risk
 *   - activeLayers includes 'cii' toggle key (default ON).
 *   - Selecting a country in RiskPanel sets activeCountry → MapView flies to centroid.
 */

import { useState } from 'react';
import MapView from './map/MapView';
import FinancePanel from './panels/FinancePanel';
import EventsPanel, { EVENTS_TOGGLE_KEYS } from './panels/EventsPanel';
import RadarPanel, {
  SIGNAL_TOGGLE_KEYS,
  type RadarSectionKey,
} from './panels/RadarPanel';
import RiskPanel from './panels/RiskPanel';
import { LAYERS, TOGGLE_KEYS } from './map/layers.config';

// ---------------------------------------------------------------------------
// Active layer set helpers
// ---------------------------------------------------------------------------

/**
 * Build the initial activeLayers Set.
 * Includes all map layer toggle keys + event type keys + signal section keys.
 * All start enabled so the map is populated on first load.
 */
function buildInitialActive(): Set<string> {
  return new Set([...TOGGLE_KEYS, ...EVENTS_TOGGLE_KEYS, ...SIGNAL_TOGGLE_KEYS]);
}

// ---------------------------------------------------------------------------
// Panel tab types
// ---------------------------------------------------------------------------

type PanelTab = 'finance' | 'events' | 'radar' | 'risk';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [activeLayers, setActiveLayers] = useState<Set<string>>(buildInitialActive);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('events');
  /**
   * activeSection: the currently selected radar section.
   * Selecting a section in RadarPanel → enables the sig-* toggle for that section
   * in activeLayers (or, for political_instability, enables evt-conflict + evt-protest).
   * State is React-owned — NO imperative map calls.
   */
  const [activeSection, setActiveSection] = useState<RadarSectionKey | null>(null);
  /**
   * activeCountry: the country selected in RiskPanel (T-26 map-tie).
   * MapView reads it to flyTo that country's centroid; the panel row highlights.
   */
  const [activeCountry, setActiveCountry] = useState<string | null>(null);

  /** Toggle a single layer key in the activeLayers set. */
  const toggleLayer = (key: string) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * Called by RadarPanel when user selects a section.
   * Ensures the corresponding map layer is visible (declarative toggle).
   * political_instability → enable evt-conflict + evt-protest.
   * Other sections → enable their sig-* key.
   */
  const handleSectionSelect = (section: RadarSectionKey) => {
    setActiveSection(section);
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (section === 'political_instability') {
        next.add('evt-conflict');
        next.add('evt-protest');
      } else {
        // Map section key to toggle key (e.g. 'commodities_energy' → 'sig-commodities-energy')
        const toggleKey = `sig-${section.replace(/_/g, '-')}`;
        next.add(toggleKey);
      }
      return next;
    });
  };

  /**
   * Called by RiskPanel when user selects a country (map-tie).
   * Ensures the CII layer is visible and flags the country for MapView.flyTo.
   */
  const handleCountrySelect = (country: string) => {
    setActiveCountry(country);
    setActiveLayers((prev) => {
      const next = new Set(prev);
      next.add('cii');
      return next;
    });
  };

  /** Label for a legacy map toggle (non-events). */
  const labelForKey = (key: string): string => {
    return LAYERS.find((l) => l.toggleKey === key)?.label?.split(' ')[0] ?? key;
  };

  // Non-event / non-signal legacy toggle keys (finance domain, etc.)
  // After T-13 there are none (all layers now use evt-* or sig-* keys), but kept for
  // forward-compat when finance map layers are added.
  const legacyToggleKeys = TOGGLE_KEYS.filter(
    (k) => !EVENTS_TOGGLE_KEYS.includes(k) && !SIGNAL_TOGGLE_KEYS.includes(k)
  );

  const panelTitle =
    activeTab === 'finance' ? 'Finance'
    : activeTab === 'events' ? 'Events'
    : activeTab === 'radar' ? 'Radar'
    : 'Risk';

  return (
    <div className="app-layout">
      {/* Map — fills viewport on mobile, shrinks on desktop via CSS */}
      <MapView activeLayers={activeLayers} activeCountry={activeCountry} />

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
          <button
            role="tab"
            type="button"
            className={`panel-tab${activeTab === 'radar' ? ' active' : ''}`}
            aria-selected={activeTab === 'radar'}
            aria-controls="panel-content"
            onClick={() => setActiveTab('radar')}
          >
            Radar
          </button>
          <button
            role="tab"
            type="button"
            className={`panel-tab${activeTab === 'risk' ? ' active' : ''}`}
            aria-selected={activeTab === 'risk'}
            aria-controls="panel-content"
            onClick={() => setActiveTab('risk')}
          >
            Risk
          </button>
        </div>

        {/* Panel content */}
        <div
          className="panel-content"
          id="panel-content"
          role="tabpanel"
          aria-label={`${panelTitle} panel`}
        >
          {activeTab === 'finance' && <FinancePanel />}
          {activeTab === 'events' && (
            <EventsPanel
              activeTypes={activeLayers}
              onToggle={toggleLayer}
            />
          )}
          {activeTab === 'radar' && (
            <RadarPanel
              activeSection={activeSection}
              onSectionSelect={handleSectionSelect}
            />
          )}
          {activeTab === 'risk' && (
            <RiskPanel
              activeCountry={activeCountry}
              onCountrySelect={handleCountrySelect}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
