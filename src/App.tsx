import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import './App.css';
import { supabase, supabaseConfigured } from './supabase';

type TabId = 'overview' | 'insights' | 'alerts' | 'fields';
type SessionState = 'loading' | 'signed-out' | 'signed-in';
type AuthMode = 'create-account' | 'sign-in';
type DrawMode = 'circle' | 'free';
type Coordinate = [number, number];
type PolygonGeometry = {
  type: 'Polygon';
  coordinates: Coordinate[][];
};
type MapFeature = {
  type: 'Feature';
  geometry: PolygonGeometry | { type: 'Point'; coordinates: Coordinate };
  properties: Record<string, unknown>;
};
type FeatureCollection = {
  type: 'FeatureCollection';
  features: MapFeature[];
};
type FieldRecord = {
  id: string;
  fieldName: string;
  boundary: PolygonGeometry;
};
type RpcFieldRow = {
  id: string;
  field_name: string;
  boundary: unknown;
};

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
      'Add fields, draw boundaries, and keep each farmer focused on their own map.',
  },
];

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const MAPBOX_STYLE_URL =
  import.meta.env.VITE_MAPBOX_STYLE_URL?.trim() ||
  'mapbox://styles/mapbox/satellite-streets-v12';
const DEFAULT_CENTER: Coordinate = [
  Number(import.meta.env.VITE_MAPBOX_DEFAULT_LNG ?? 24.6727),
  Number(import.meta.env.VITE_MAPBOX_DEFAULT_LAT ?? -28.4793),
];
const DEFAULT_ZOOM = Number(import.meta.env.VITE_MAPBOX_DEFAULT_ZOOM ?? 5);
const SAVED_FIELDS_SOURCE_ID = 'saved-fields';
const DRAFT_BOUNDARY_SOURCE_ID = 'draft-boundary';
const DRAFT_POINTS_SOURCE_ID = 'draft-points';

function normaliseIdentityPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

function buildSyntheticEmail(firstName: string, surname: string) {
  const safeFirstName = normaliseIdentityPart(firstName) || 'farmer';
  const safeSurname = normaliseIdentityPart(surname) || 'account';
  return `${safeFirstName}.${safeSurname}@pivotsense.local`;
}

function buildFullName(firstName: string, surname: string) {
  return `${firstName.trim()} ${surname.trim()}`.trim();
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isPolygonGeometry(value: unknown): value is PolygonGeometry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: string }).type === 'Polygon' &&
    Array.isArray((value as { coordinates?: unknown }).coordinates)
  );
}

function parseWktPolygon(value: string): PolygonGeometry | null {
  const match = value.match(/POLYGON\s*\(\((.+)\)\)/i);
  if (!match) return null;

  const ring = match[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((pair) => pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map(([lng, lat]) => [lng, lat] as Coordinate);

  if (ring.length < 4) return null;

  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

function parseBoundary(value: unknown): PolygonGeometry | null {
  if (!value) return null;

  if (isPolygonGeometry(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed.startsWith('{')) {
      try {
        return parseBoundary(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }

    return parseWktPolygon(trimmed);
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: string }).type === 'Feature' &&
    'geometry' in value
  ) {
    return parseBoundary((value as { geometry?: unknown }).geometry);
  }

  return null;
}

function getPolygonBounds(polygon: PolygonGeometry) {
  const bounds = new mapboxgl.LngLatBounds();
  polygon.coordinates[0].forEach(([lng, lat]) => bounds.extend([lng, lat]));
  return bounds;
}

function createCirclePolygon(center: Coordinate, radiusMeters: number, steps = 48): PolygonGeometry {
  const latRadians = (center[1] * Math.PI) / 180;
  const latDegreesPerMeter = 1 / 111320;
  const lngDegreesPerMeter = 1 / (111320 * Math.max(Math.cos(latRadians), 0.00001));
  const ring: Coordinate[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    ring.push([
      center[0] + Math.cos(angle) * radiusMeters * lngDegreesPerMeter,
      center[1] + Math.sin(angle) * radiusMeters * latDegreesPerMeter,
    ]);
  }

  ring.push(ring[0]);

  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

function buildSavedFieldsGeoJson(fields: FieldRecord[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fields.map((field) => ({
      type: 'Feature',
      properties: {
        id: field.id,
        fieldName: field.fieldName,
      },
      geometry: field.boundary,
    })),
  };
}

function buildDraftBoundaryGeoJson(polygon: PolygonGeometry | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polygon
      ? [
          {
            type: 'Feature',
            geometry: polygon,
            properties: {},
          },
        ]
      : [],
  };
}

function buildDraftPointsGeoJson(
  drawMode: DrawMode,
  freePoints: Coordinate[],
  circleCenter: Coordinate | null,
  circleEdge: Coordinate | null,
): FeatureCollection {
  if (drawMode === 'free') {
    return {
      type: 'FeatureCollection',
      features: freePoints.map((coordinates, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          pointRole: index === 0 ? 'start' : 'point',
        },
      })),
    };
  }

  return {
    type: 'FeatureCollection',
    features: [circleCenter, circleEdge]
      .filter(isCoordinate)
      .map((coordinates, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          pointRole: index === 0 ? 'center' : 'edge',
        },
      })),
  };
}

function ensureGeoJsonSource(map: mapboxgl.Map, id: string, data: FeatureCollection) {
  const existingSource = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data as never);
    return;
  }

  map.addSource(id, {
    type: 'geojson',
    data: data as never,
  });
}

function ensureMapLayers(map: mapboxgl.Map) {
  if (!map.getLayer('saved-fields-fill')) {
    map.addLayer({
      id: 'saved-fields-fill',
      type: 'fill',
      source: SAVED_FIELDS_SOURCE_ID,
      paint: {
        'fill-color': '#2f7d3b',
        'fill-opacity': 0.18,
      },
    });
  }

  if (!map.getLayer('saved-fields-line')) {
    map.addLayer({
      id: 'saved-fields-line',
      type: 'line',
      source: SAVED_FIELDS_SOURCE_ID,
      paint: {
        'line-color': '#1f5d2b',
        'line-width': 2,
      },
    });
  }

  if (!map.getLayer('draft-boundary-fill')) {
    map.addLayer({
      id: 'draft-boundary-fill',
      type: 'fill',
      source: DRAFT_BOUNDARY_SOURCE_ID,
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': 0.2,
      },
    });
  }

  if (!map.getLayer('draft-boundary-line')) {
    map.addLayer({
      id: 'draft-boundary-line',
      type: 'line',
      source: DRAFT_BOUNDARY_SOURCE_ID,
      paint: {
        'line-color': '#d97706',
        'line-width': 2.5,
        'line-dasharray': [2, 1],
      },
    });
  }

  if (!map.getLayer('draft-points')) {
    map.addLayer({
      id: 'draft-points',
      type: 'circle',
      source: DRAFT_POINTS_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match',
          ['get', 'pointRole'],
          'start',
          '#ffffff',
          'center',
          '#ffffff',
          '#f59e0b',
        ],
        'circle-stroke-color': '#d97706',
        'circle-stroke-width': 2,
      },
    });
  }
}

function buildFreePolygon(points: Coordinate[]) {
  if (points.length < 3) return null;
  return {
    type: 'Polygon',
    coordinates: [[...points, points[0]]],
  } satisfies PolygonGeometry;
}

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

function FieldMapPanel({ currentUserId }: { currentUserId: string }) {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    MAPBOX_ACCESS_TOKEN ? 'loading' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldMessage, setFieldMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [fieldNameDraft, setFieldNameDraft] = useState('');
  const [drawMode, setDrawMode] = useState<DrawMode>('circle');
  const [freePoints, setFreePoints] = useState<Coordinate[]>([]);
  const [freePolygonComplete, setFreePolygonComplete] = useState(false);
  const [circleCenter, setCircleCenter] = useState<Coordinate | null>(null);
  const [circleRadiusMeters, setCircleRadiusMeters] = useState<number | null>(null);
  const [circleRadiusLocked, setCircleRadiusLocked] = useState(false);
  const [savingField, setSavingField] = useState(false);

  const freePolygon = freePolygonComplete ? buildFreePolygon(freePoints) : null;
  const circlePolygon =
    circleCenter && circleRadiusMeters && circleRadiusMeters > 5
      ? createCirclePolygon(circleCenter, circleRadiusMeters)
      : null;
  const draftPolygon = drawMode === 'free' ? freePolygon : circlePolygon;
  const circleEdge =
    circleCenter && circleRadiusMeters && circleRadiusMeters > 0
      ? ([
          circleCenter[0] + circleRadiusMeters / (111320 * Math.max(Math.cos((circleCenter[1] * Math.PI) / 180), 0.00001)),
          circleCenter[1],
        ] as Coordinate)
      : null;

  function resetDraftState(nextMode: DrawMode = drawMode) {
    setDrawMode(nextMode);
    setFreePoints([]);
    setFreePolygonComplete(false);
    setCircleCenter(null);
    setCircleRadiusMeters(null);
    setCircleRadiusLocked(false);
    setFieldMessage(null);
    setFieldError(null);
  }

  function startAddingField() {
    setIsAddingField(true);
    setFieldNameDraft('');
    resetDraftState('circle');
    setFieldMessage('Enter a field name, then place the boundary on the map.');
  }

  function cancelAddingField() {
    setIsAddingField(false);
    setFieldNameDraft('');
    resetDraftState('circle');
  }

  async function loadFields() {
    if (!supabase || !currentUserId) {
      setFields([]);
      setFieldsLoading(false);
      return;
    }

    setFieldsLoading(true);
    setFieldError(null);

    const { data, error } = await supabase.rpc('get_my_fields');

    if (error) {
      setFieldError(error.message);
      setFieldsLoading(false);
      return;
    }

    const parsedFields = ((data ?? []) as RpcFieldRow[])
      .map((record) => {
        const boundary = parseBoundary(record.boundary);
        if (!boundary) return null;

        return {
          id: record.id,
          fieldName: record.field_name,
          boundary,
        } satisfies FieldRecord;
      })
      .filter((field: FieldRecord | null): field is FieldRecord => Boolean(field));

    setFields(parsedFields);
    setFieldsLoading(false);
  }

  async function handleConfirmBoundary() {
    if (!supabase) {
      setFieldError('Supabase is not configured.');
      return;
    }

    if (!fieldNameDraft.trim()) {
      setFieldError('Add the field name before confirming the boundary.');
      return;
    }

    if (!draftPolygon) {
      setFieldError('Finish drawing the boundary before confirming it.');
      return;
    }

    setSavingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('create_field', {
      input_field_name: fieldNameDraft.trim(),
      input_boundary: draftPolygon,
    });

    setSavingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    setFieldMessage(`Saved ${fieldNameDraft.trim()}.`);
    setIsAddingField(false);
    setFieldNameDraft('');
    resetDraftState('circle');
    await loadFields();
  }

  useEffect(() => {
    void loadFields();
  }, [currentUserId]);

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

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || status !== 'ready') return;

    ensureGeoJsonSource(map, SAVED_FIELDS_SOURCE_ID, buildSavedFieldsGeoJson(fields));
    ensureGeoJsonSource(map, DRAFT_BOUNDARY_SOURCE_ID, buildDraftBoundaryGeoJson(draftPolygon));
    ensureGeoJsonSource(
      map,
      DRAFT_POINTS_SOURCE_ID,
      buildDraftPointsGeoJson(drawMode, freePoints, circleCenter, circleEdge),
    );
    ensureMapLayers(map);
  }, [status, fields, draftPolygon, drawMode, freePoints, circleCenter, circleEdge]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || status !== 'ready' || isAddingField) return;

    if (fields.length === 0) {
      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 900,
      });
      return;
    }

    const bounds = fields.reduce((currentBounds, field) => {
      const nextBounds = getPolygonBounds(field.boundary);
      nextBounds.toArray().forEach((point) => currentBounds.extend(point));
      return currentBounds;
    }, new mapboxgl.LngLatBounds());

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 72,
        maxZoom: 15,
        duration: 900,
      });
    }
  }, [status, fields, isAddingField]);

  useEffect(() => {
    const activeMap = mapInstanceRef.current;
    if (!activeMap || status !== 'ready') return;
    const map = activeMap;

    function handleMapClick(event: mapboxgl.MapMouseEvent) {
      if (!isAddingField) return;

      if (!fieldNameDraft.trim()) {
        setFieldError('Add the field name first, then draw the boundary.');
        return;
      }

      setFieldError(null);

      if (drawMode === 'free') {
        if (freePolygonComplete) return;

        if (freePoints.length >= 3) {
          const firstPoint = map.project(freePoints[0]);
          const clickDistance = Math.hypot(firstPoint.x - event.point.x, firstPoint.y - event.point.y);
          if (clickDistance <= 18) {
            setFreePolygonComplete(true);
            setFieldMessage('Boundary closed. Confirm the boundary to save the field.');
            return;
          }
        }

        setFreePoints((current) => [...current, [event.lngLat.lng, event.lngLat.lat]]);
        setFieldMessage(
          freePoints.length + 1 >= 3
            ? 'Keep clicking boundary points. Click the first point to close the field.'
            : 'Add at least three boundary points.',
        );
        return;
      }

      if (!circleCenter) {
        setCircleCenter([event.lngLat.lng, event.lngLat.lat]);
        setCircleRadiusMeters(null);
        setCircleRadiusLocked(false);
        setFieldMessage('Move the pointer to size the circle, then click again to lock it.');
        return;
      }

      const radius = new mapboxgl.LngLat(circleCenter[0], circleCenter[1]).distanceTo(
        event.lngLat,
      );
      setCircleRadiusMeters(radius);
      setCircleRadiusLocked(true);
      setFieldMessage('Circle ready. Confirm the boundary to save the field.');
    }

    function handleMouseMove(event: mapboxgl.MapMouseEvent) {
      if (!isAddingField || drawMode !== 'circle' || !circleCenter || circleRadiusLocked) {
        return;
      }

      const radius = new mapboxgl.LngLat(circleCenter[0], circleCenter[1]).distanceTo(
        event.lngLat,
      );
      setCircleRadiusMeters(radius);
    }

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);

    return () => {
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
    };
  }, [
    status,
    isAddingField,
    fieldNameDraft,
    drawMode,
    freePoints,
    freePolygonComplete,
    circleCenter,
    circleRadiusLocked,
  ]);

  return (
    <section className="map-panel">
      <div className="panel-copy field-panel-copy">
        <div>
          <span className="panel-tag">Mapbox</span>
          <h2>Field map canvas</h2>
          <p>
            Save a named field boundary, then reopen this page to see all fields in
            view.
          </p>
        </div>
        {!isAddingField ? (
          <button type="button" className="btn btn-primary" onClick={startAddingField}>
            Add field
          </button>
        ) : null}
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

      {isAddingField ? (
        <div className="field-creation-card">
          <div className="field-creation-grid">
            <label className="auth-label" htmlFor="field-name">
              Field name
            </label>
            <input
              id="field-name"
              className="auth-input"
              type="text"
              placeholder="North pivot"
              value={fieldNameDraft}
              onChange={(event) => setFieldNameDraft(event.target.value)}
            />
            <div className="draw-mode-group" role="tablist" aria-label="Boundary mode">
              <button
                type="button"
                className={drawMode === 'circle' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                onClick={() => resetDraftState('circle')}
              >
                Circle mode
              </button>
              <button
                type="button"
                className={drawMode === 'free' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                onClick={() => resetDraftState('free')}
              >
                Free mode
              </button>
            </div>
            <p className="draw-help">
              {drawMode === 'circle'
                ? 'Circle mode: click once for the center, move to size it, click again to lock the boundary.'
                : 'Free mode: click each boundary point, then click the first point to close the field.'}
            </p>
            <div className="field-action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmBoundary()}
                disabled={savingField || !draftPolygon || !fieldNameDraft.trim()}
              >
                {savingField ? 'Saving field...' : 'Confirm boundary'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={cancelAddingField}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => resetDraftState(drawMode)}>
                Reset draft
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fieldsLoading ? (
        <div className="map-state-card">
          <h3>Loading fields</h3>
          <p>Fetching saved boundaries for this farmer.</p>
        </div>
      ) : null}

      {!fieldsLoading && fields.length === 0 ? (
        <div className="map-state-card">
          <h3>No fields yet</h3>
          <p>This farmer has not created any fields yet. Use the add field button to start.</p>
        </div>
      ) : null}

      {!fieldsLoading && fields.length > 0 ? (
        <div className="map-state-card">
          <h3>{fields.length === 1 ? '1 field saved' : `${fields.length} fields saved`}</h3>
          <p>
            {fields.length === 1
              ? `The map zooms to ${fields[0].fieldName}.`
              : 'The map zooms to include every saved field.'}
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

      {fieldMessage ? (
        <p className="auth-feedback auth-feedback-success" aria-live="polite">
          {fieldMessage}
        </p>
      ) : null}

      {fieldError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {fieldError}
        </p>
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
  const [authMode, setAuthMode] = useState<AuthMode>('create-account');
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [signingInWithPassword, setSigningInWithPassword] = useState(false);
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

      const fullName =
        data.session?.user.user_metadata.full_name ??
        buildFullName(
          data.session?.user.user_metadata.first_name ?? '',
          data.session?.user.user_metadata.surname ?? '',
        );
      setCurrentUserName(fullName);
      setCurrentUserId(data.session?.user.id ?? '');
      setSessionState(data.session ? 'signed-in' : 'signed-out');
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const fullName =
        session?.user.user_metadata.full_name ??
        buildFullName(
          session?.user.user_metadata.first_name ?? '',
          session?.user.user_metadata.surname ?? '',
        );
      setCurrentUserName(fullName);
      setCurrentUserId(session?.user.id ?? '');
      setSessionState(session ? 'signed-in' : 'signed-out');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseConfigured || !supabase) {
      setAuthError('Supabase auth is not configured yet.');
      return;
    }

    if (password.length < 8) {
      setAuthError('Use at least 8 characters for the password.');
      return;
    }

    if (password !== passwordConfirm) {
      setAuthError('Passwords do not match.');
      return;
    }

    const syntheticEmail = buildSyntheticEmail(firstName, surname);
    const fullName = buildFullName(firstName, surname);

    setCreatingAccount(true);
    setAuthError(null);
    setAuthMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email: syntheticEmail,
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          surname: surname.trim(),
          full_name: fullName,
        },
      },
    });

    setCreatingAccount(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    if (!data.session) {
      setAuthError(
        'Signup created an account but did not create a live session. Check whether email confirmation is still enabled in Supabase Auth.',
      );
      return;
    }

    setPassword('');
    setPasswordConfirm('');
    setCurrentUserName(fullName);
    setCurrentUserId(data.session.user.id);
    setAuthMessage('Account created. This browser will keep the session cached.');
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

    const syntheticEmail = buildSyntheticEmail(firstName, surname);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password,
    });

    setSigningInWithPassword(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setPassword('');
    setPasswordConfirm('');
    const fullName =
      data.user?.user_metadata.full_name ??
      buildFullName(firstName, surname);
    setCurrentUserName(fullName);
    setCurrentUserId(data.user?.id ?? '');
    setAuthMessage('Signed in. This browser will keep the session cached.');
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
    setCurrentUserName('');
    setCurrentUserId('');
  }

  if (sessionState === 'loading') {
    return (
      <div className="page auth-page" id="top">
        <main className="auth-shell">
          <section className="auth-card">
            <Logo />
            <div className="auth-copy">
              <h1>Checking session</h1>
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
              <h1>Sign in to view your fields</h1>
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
                    className={authMode === 'create-account' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                    onClick={() => {
                      setAuthMode('create-account');
                      setAuthError(null);
                      setAuthMessage(null);
                    }}
                  >
                    Create account
                  </button>
                  <button
                    type="button"
                    className={authMode === 'sign-in' ? 'auth-mode-button is-active' : 'auth-mode-button'}
                    onClick={() => {
                      setAuthMode('sign-in');
                      setAuthError(null);
                      setAuthMessage(null);
                    }}
                  >
                    Sign in
                  </button>
                </div>

                {authMode === 'create-account' ? (
                  <form className="auth-form" onSubmit={handleCreateAccount}>
                    <label className="auth-label" htmlFor="first-name">
                      Name
                    </label>
                    <input
                      id="first-name"
                      className="auth-input"
                      type="text"
                      name="first-name"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      required
                    />
                    <label className="auth-label" htmlFor="surname">
                      Surname
                    </label>
                    <input
                      id="surname"
                      className="auth-input"
                      type="text"
                      name="surname"
                      autoComplete="family-name"
                      value={surname}
                      onChange={(event) => setSurname(event.target.value)}
                      required
                    />
                    <label className="auth-label" htmlFor="create-password">
                      Password
                    </label>
                    <input
                      id="create-password"
                      className="auth-input"
                      type="password"
                      name="password"
                      autoComplete="new-password"
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
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      required
                      minLength={8}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary auth-submit"
                      disabled={creatingAccount}
                    >
                      {creatingAccount ? 'Creating account...' : 'Create account'}
                    </button>
                  </form>
                ) : (
                  <form className="auth-form" onSubmit={handlePasswordSignIn}>
                    <label className="auth-label" htmlFor="sign-in-name">
                      Name
                    </label>
                    <input
                      id="sign-in-name"
                      className="auth-input"
                      type="text"
                      name="first-name"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      required
                    />
                    <label className="auth-label" htmlFor="sign-in-surname">
                      Surname
                    </label>
                    <input
                      id="sign-in-surname"
                      className="auth-input"
                      type="text"
                      name="surname"
                      autoComplete="family-name"
                      value={surname}
                      onChange={(event) => setSurname(event.target.value)}
                      required
                    />
                    <label className="auth-label" htmlFor="sign-in-password">
                      Password
                    </label>
                    <input
                      id="sign-in-password"
                      className="auth-input"
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="btn btn-primary auth-submit"
                      disabled={signingInWithPassword}
                    >
                      {signingInWithPassword ? 'Signing in...' : 'Sign in'}
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
              <h2>Signed in</h2>
              <p>
                {currentUserName || 'Farmer'} is signed in. This browser keeps the
                session cached for easier access on the same device.
              </p>
              <p className="account-note">
                Email linking can be added later without changing the field RLS
                structure.
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
              <FieldMapPanel currentUserId={currentUserId} />
            ) : (
              <PlaceholderPanel tab={activeConfig} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
