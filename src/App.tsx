import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import './App.css';
import { supabase, supabaseConfigured } from './supabase';

type TabId = 'overview' | 'insights' | 'alerts' | 'fields';
type SessionState = 'loading' | 'signed-out' | 'signed-in';
type AuthMode = 'magic-link' | 'password';

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

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const MAPBOX_STYLE_URL =
  import.meta.env.VITE_MAPBOX_STYLE_URL?.trim() ||
  'mapbox://styles/mapbox/satellite-streets-v12';
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

      map.on('error', (event) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(event.error?.message ?? 'Mapbox failed to load.');
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
          This screen only handles the map bootstrapping. Boundary drawing can be
          added later on top of this container.
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
        <span className="panel-tag">
          Tab {tabs.findIndex(({ id }) => id === tab.id) + 1}
        </span>
        <h2>{tab.title}</h2>
        <p>{tab.description}</p>
      </div>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('fields');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [authMode, setAuthMode] = useState<AuthMode>('magic-link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [signingInWithPassword, setSigningInWithPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const activeConfig = tabs.find(({ id }) => id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setSessionState('signed-out');
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;

      if (error) {
        setAuthError(error.message);
        setSessionState('signed-out');
        return;
      }

      setSessionState(data.session ? 'signed-in' : 'signed-out');
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSessionState(session ? 'signed-in' : 'signed-out');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleMagicLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseConfigured || !supabase) {
      setAuthError('Supabase auth is not configured yet.');
      return;
    }

    setSendingMagicLink(true);
    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setSendingMagicLink(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthMessage('Magic link sent. Check your email to open PivotSense.');
  }

  async function handlePasswordSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseConfigured || !supabase) {
      setAuthError('Supabase auth is not configured yet.');
      return;
    }

    setSigningInWithPassword(true);
    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSigningInWithPassword(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setPassword('');
    setAuthMessage('Signed in. This browser will keep the session cached.');
  }

  async function handlePasswordSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) return;

    if (password.length < 8) {
      setAuthError('Use at least 8 characters for the password.');
      return;
    }

    if (password !== passwordConfirm) {
      setAuthError('Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setSavingPassword(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setPassword('');
    setPasswordConfirm('');
    setAuthMessage('Password saved. You can use email and password next time.');
  }

  async function handleSignOut() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthMessage(null);
    setAuthError(null);
  }

  if (sessionState === 'loading') {
    return (
      <div className="page auth-page" id="top">
        <main className="auth-shell">
          <section className="auth-card">
            <Logo />
            <div className="auth-copy">
              <span className="badge">PivotSense</span>
              <h1>Checking session</h1>
              <p>Connecting to Supabase authentication.</p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (sessionState === 'signed-out') {
    return (
      <div className="page auth-page" id="top">
        <main className="auth-shell">
          <section className="auth-card" data-testid="auth-card">
            <Logo />
            <div className="auth-copy">
              <span className="badge">PivotSense</span>
              <h1>Sign in to view your fields</h1>
              <p>
                Your signed-in user session is what the field RLS policies rely
                on. The browser keeps that session cached until you sign out.
              </p>
            </div>

            {!supabaseConfigured ? (
              <div className="auth-state-card" data-testid="supabase-setup-needed">
                <h3>Supabase setup needed</h3>
                <p>
                  Add <code>VITE_SUPABASE_URL</code> and{' '}
                  <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to your local Vite env.
                </p>
              </div>
            ) : (
              <>
                <div className="auth-mode-switch" role="tablist" aria-label="Sign in method">
                  <button
                    type="button"
                    className={authMode === 'magic-link' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                    onClick={() => {
                      setAuthMode('magic-link');
                      setAuthError(null);
                      setAuthMessage(null);
                    }}
                  >
                    Magic link
                  </button>
                  <button
                    type="button"
                    className={authMode === 'password' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                    onClick={() => {
                      setAuthMode('password');
                      setAuthError(null);
                      setAuthMessage(null);
                    }}
                  >
                    Password
                  </button>
                </div>

                {authMode === 'magic-link' ? (
                  <form className="auth-form" onSubmit={handleMagicLinkSubmit}>
                    <label className="auth-label" htmlFor="email">
                      Email address
                    </label>
                    <input
                      id="email"
                      className="auth-input"
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="farmer@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="btn btn-primary auth-submit"
                      disabled={sendingMagicLink}
                    >
                      {sendingMagicLink ? 'Sending...' : 'Send magic link'}
                    </button>
                  </form>
                ) : (
                  <form className="auth-form" onSubmit={handlePasswordSignIn}>
                    <label className="auth-label" htmlFor="email-password">
                      Email address
                    </label>
                    <input
                      id="email-password"
                      className="auth-input"
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="farmer@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                    <label className="auth-label" htmlFor="password">
                      Password
                    </label>
                    <input
                      id="password"
                      className="auth-input"
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="btn btn-primary auth-submit"
                      disabled={signingInWithPassword}
                    >
                      {signingInWithPassword ? 'Signing in...' : 'Sign in with password'}
                    </button>
                  </form>
                )}
              </>
            )}

            {authMessage ? (
              <p className="auth-feedback auth-feedback-success" aria-live="polite">
                {authMessage}
              </p>
            ) : null}

            {authError ? (
              <p className="auth-feedback auth-feedback-error" aria-live="polite">
                {authError}
              </p>
            ) : null}
          </section>
        </main>
      </div>
    );
  }

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
          <div className="nav-cta">
            <button type="button" className="btn btn-secondary" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </div>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((value) => !value)}
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
            <button
              type="button"
              className="btn btn-secondary mobile-cta mobile-menu-button"
              onClick={() => {
                setMenuOpen(false);
                void handleSignOut();
              }}
            >
              Sign out
            </button>
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
                Signed-in workspace for each farmer, with field data protected by
                Supabase RLS and a dedicated field map screen for Mapbox
                integration.
              </p>
            </div>
            <div className="account-card">
              <p className="eyebrow">Account</p>
              <h2>Set a password once</h2>
              <p>
                Use the magic link once, then save a password here for faster
                sign-in on new devices. This browser session already stays cached.
              </p>
              <form className="auth-form" onSubmit={handlePasswordSetup}>
                <label className="auth-label" htmlFor="new-password">
                  New password
                </label>
                <input
                  id="new-password"
                  className="auth-input"
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                />
                <label className="auth-label" htmlFor="confirm-password">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  className="auth-input"
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  placeholder="Repeat the password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="submit"
                  className="btn btn-secondary auth-submit"
                  disabled={savingPassword}
                >
                  {savingPassword ? 'Saving...' : 'Save password'}
                </button>
              </form>
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
