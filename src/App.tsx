import { useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import './App.css';

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
      'Mapbox is loaded here so farmers can eventually define their field edges.',
  },
];

const navLinks = [
  { href: '#overview', label: 'How it works' },
  { href: '#overview', label: 'Pricing' },
  { href: '#overview', label: 'Stories' },
  { href: '#overview', label: 'Sign in' },
];

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const MAPBOX_STYLE_URL =
  import.meta.env.VITE_MAPBOX_STYLE_URL?.trim() || 'mapbox://styles/mapbox/satellite-streets-v12';
const DEFAULT_CENTER: [number, number] = [
  Number(import.meta.env.VITE_MAPBOX_DEFAULT_LNG ?? 24.6727),
  Number(import.meta.env.VITE_MAPBOX_DEFAULT_LAT ?? -28.4793),
];
const DEFAULT_ZOOM = Number(import.meta.env.VITE_MAPBOX_DEFAULT_ZOOM ?? 5);

function Logo() {
  return (
    <a href="#top" className="brand" aria-label="PivotSense home">
      <img
        src={`${import.meta.env.BASE_URL}images/pivotflow-mark-classic-green-square-512.png`}
        alt=""
        className="brand-mark"
        width={28}
        height={28}
      />
      <span className="brand-name">PivotSense</span>
    </a>
  );
}

function FieldMapPanel() {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    MAPBOX_ACCESS_TOKEN ? 'loading' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN || !mapRef.current) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    let cancelled = false;
    setStatus('loading');

    try {
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: MAPBOX_STYLE_URL,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: true,
      });

      mapInstanceRef.current = map;

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.on('load', () => {
        if (cancelled) return;
        setStatus('ready');
        setErrorMessage(null);
      });

      map.on('error', (e) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(e.error?.message ?? 'Mapbox failed to load.');
      });
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Mapbox failed to initialise.',
      );
    }

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <section className="map-panel">
      <div className="panel-copy">
        <span className="panel-tag">Mapbox</span>
        <h2>Field map canvas</h2>
        <p>
          This screen only handles the map bootstrapping. Boundary drawing can
          be added later on top of this container.
        </p>
      </div>

      {!MAPBOX_ACCESS_TOKEN ? (
        <div className="map-state-card" data-testid="maps-setup-needed">
          <h3>Mapbox setup needed</h3>
          <p>
            Add <code>VITE_MAPBOX_ACCESS_TOKEN</code> to your local Vite env
            (use a public <code>pk.*</code> token from your Mapbox account).
          </p>
          <p>
            Optional: <code>VITE_MAPBOX_STYLE_URL</code> to override the default
            satellite-streets style.
          </p>
        </div>
      ) : null}

      {MAPBOX_ACCESS_TOKEN ? (
        <div className="map-shell">
          <div className="map-status-row">
            <span className={`status-pill status-${status}`}>
              {status === 'loading' && 'Loading map'}
              {status === 'ready' && 'Map ready'}
              {status === 'error' && 'Map error'}
            </span>
            <span className="map-meta" aria-live="polite">
              {status === 'loading' && 'Connecting to Mapbox...'}
              {status === 'ready' && 'Mapbox is active.'}
              {status === 'error' && errorMessage}
            </span>
          </div>
          <div
            id={mapId}
            ref={mapRef}
            className="map-canvas"
            data-testid="mapbox-canvas"
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

          <nav className="nav-links" aria-label="Main tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeTab ? 'nav-tab is-active' : 'nav-tab'}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={tab.id === activeTab}
              >
                {tab.label}
              </button>
            ))}
          </nav>

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
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeTab ? 'mobile-tab is-active' : 'mobile-tab'}
                onClick={() => {
                  setActiveTab(tab.id);
                  setMenuOpen(false);
                }}
                aria-pressed={tab.id === activeTab}
              >
                {tab.label}
              </button>
            ))}
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
                Mapbox integration.
              </p>
            </div>
          </section>

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
