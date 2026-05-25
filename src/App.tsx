import { useEffect, useId, useRef, useState } from 'react';
import './App.css';
import { loadGoogleMaps } from './googleMaps';

type TabId = 'overview' | 'insights' | 'alerts' | 'fields';

type TabConfig = {
  id: TabId;
  label: string;
  title: string;
  description: string;
};

const tabs: TabConfig[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'PivotSense overview',
    description:
      'High-level farm health, yield trends, and current season status can live here.',
  },
  {
    id: 'insights',
    label: 'Insights',
    title: 'Agronomy insights',
    description:
      'This tab is ready for recommendations, anomaly summaries, and sensor-driven guidance.',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    title: 'Priority alerts',
    description:
      'Use this area for irrigation issues, disease warnings, and urgent operational prompts.',
  },
  {
    id: 'fields',
    label: 'Fields',
    title: 'Field boundaries',
    description:
      'Google Maps is loaded here so farmers can eventually define their field edges.',
  },
];

const navLinks = [
  { href: '#overview', label: 'How it works' },
  { href: '#overview', label: 'Pricing' },
  { href: '#overview', label: 'Stories' },
  { href: '#overview', label: 'Sign in' },
];

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID?.trim();
const DEFAULT_CENTER = {
  lat: Number(import.meta.env.VITE_GOOGLE_MAPS_DEFAULT_LAT ?? -28.4793),
  lng: Number(import.meta.env.VITE_GOOGLE_MAPS_DEFAULT_LNG ?? 24.6727),
};
const DEFAULT_ZOOM = Number(import.meta.env.VITE_GOOGLE_MAPS_DEFAULT_ZOOM ?? 5);

function Logo() {
  return (
    <a href="#top" className="brand" aria-label="PivotSense home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 4 v8 l5 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">PivotSense</span>
    </a>
  );
}

function FieldMapPanel() {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    GOOGLE_MAPS_API_KEY ? 'loading' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !mapRef.current) {
      return;
    }

    const apiKey = GOOGLE_MAPS_API_KEY;
    let cancelled = false;

    async function setupMap() {
      try {
        setStatus('loading');
        const maps = await loadGoogleMaps(apiKey);

        if (cancelled || !mapRef.current) {
          return;
        }

        new maps.Map(mapRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapId: GOOGLE_MAP_ID || undefined,
          mapTypeControl: true,
          fullscreenControl: false,
          streetViewControl: false,
        });

        setStatus('ready');
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Google Maps failed to load.',
        );
      }
    }

    void setupMap();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="map-panel">
      <div className="panel-copy">
        <span className="panel-tag">Google Maps</span>
        <h2>Field map canvas</h2>
        <p>
          This screen only handles the map bootstrapping. Boundary drawing can
          be added later on top of this container.
        </p>
      </div>

      {!GOOGLE_MAPS_API_KEY ? (
        <div className="map-state-card" data-testid="maps-setup-needed">
          <h3>Google Maps setup needed</h3>
          <p>
            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your local Vite env and
            enable the Maps JavaScript API in Google Cloud.
          </p>
          <p>
            Optional: set <code>VITE_GOOGLE_MAP_ID</code> if you want a custom
            styled map.
          </p>
        </div>
      ) : null}

      {GOOGLE_MAPS_API_KEY ? (
        <div className="map-shell">
          <div className="map-status-row">
            <span className={`status-pill status-${status}`}>
              {status === 'loading' && 'Loading map'}
              {status === 'ready' && 'Map ready'}
              {status === 'error' && 'Map error'}
            </span>
            <span className="map-meta" aria-live="polite">
              {status === 'loading' && 'Connecting to Google Maps...'}
              {status === 'ready' && 'Google Maps is active.'}
              {status === 'error' && errorMessage}
            </span>
          </div>
          <div
            id={mapId}
            ref={mapRef}
            className="map-canvas"
            data-testid="google-map-canvas"
          />
        </div>
      ) : null}
    </section>
  );
}

function PlaceholderPanel({ tab }: { tab: TabConfig }) {
  return (
    <section className="placeholder-panel">
      <div className="panel-copy">
        <span className="panel-tag">Tab {tabs.findIndex(({ id }) => id === tab.id) + 1}</span>
        <h2>{tab.title}</h2>
        <p>{tab.description}</p>
      </div>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('fields');
  const [menuOpen, setMenuOpen] = useState(false);
  const activeConfig = tabs.find(({ id }) => id === activeTab) ?? tabs[0];

  return (
    <div className="page" id="top">
      <header className="navbar">
        <div className="navbar-inner">
          <Logo />

          <nav className="nav-links" aria-label="Main">
            {navLinks.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="nav-cta">
            <a href="#signup" className="btn btn-primary">Start free trial</a>
          </div>

          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">Toggle menu</span>
            <span className="nav-toggle-bar" />
            <span className="nav-toggle-bar" />
            <span className="nav-toggle-bar" />
          </button>
        </div>

        {menuOpen ? (
          <div id="mobile-menu" className="mobile-menu">
            {navLinks.map((link) => (
              <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            <a href="#signup" className="btn btn-primary mobile-cta" onClick={() => setMenuOpen(false)}>
              Start free trial
            </a>
          </div>
        ) : null}
      </header>

      <main className="app-shell">
        <div className="container">
          <section className="hero-card">
            <div className="hero-copy">
              <span className="badge">PivotSense</span>
              <h1>Farmer workspace</h1>
              <p>
                Four-tab mobile-ready shell with a dedicated field map screen for
                Google Maps integration.
              </p>
            </div>
          </section>

          <nav className="tab-bar" aria-label="Main tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeTab ? 'tab-button is-active' : 'tab-button'}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={tab.id === activeTab}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <section className="content-card" aria-labelledby="tab-title">
            <header className="content-header">
              <div>
                <p className="eyebrow">Current tab</p>
                <h2 id="tab-title">{activeConfig.title}</h2>
              </div>
            </header>

            {activeTab === 'fields' ? (
              <FieldMapPanel />
            ) : (
              <PlaceholderPanel tab={activeConfig} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
