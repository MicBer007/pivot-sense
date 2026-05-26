import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import './App.css';
import { supabase, supabaseConfigured } from './supabase';

type TabId = 'overview' | 'insights' | 'alerts' | 'fields';
type AppState = 'loading' | 'signed-out' | 'signed-in';
type AppScreen = 'workspace' | 'add-field';
type AppRoute = {
  tabId: TabId;
  screen: AppScreen;
};
type DrawMode = 'circle' | 'free';
type Coordinate = [number, number];
type FieldType = 'pervits' | 'normal';
type PivotAlignment =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west';
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
  fieldType: FieldType;
  pivotAlignment: PivotAlignment | null;
};
type RpcFieldRow = {
  id: string;
  field_name: string;
  boundary: unknown;
  field_type?: string | null;
  pivot_alignment?: string | null;
};
type RpcFarmerRow = {
  id: string;
  name: string;
  was_created?: boolean;
};
type StoredFarmer = {
  id: string;
  name: string;
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
const STORED_FARMER_KEY = 'pivot-sense.active-farmer';
const TAB_ROOT_PATHS: Record<TabId, string> = {
  overview: '/overview',
  insights: '/insights',
  alerts: '/alerts',
  fields: '/fields',
};
const ADD_FIELD_PATH = '/fields/add';
const PIVOT_ALIGNMENT_OPTIONS: { value: PivotAlignment; label: string }[] = [
  { value: 'north', label: 'North' },
  { value: 'north-east', label: 'North-east' },
  { value: 'east', label: 'East' },
  { value: 'south-east', label: 'South-east' },
  { value: 'south', label: 'South' },
  { value: 'south-west', label: 'South-west' },
  { value: 'west', label: 'West' },
  { value: 'north-west', label: 'North-west' },
];

function readStoredFarmer() {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(STORED_FARMER_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredFarmer>;
    if (!parsed.id || !parsed.name) {
      return null;
    }

    return {
      id: parsed.id,
      name: parsed.name,
    } satisfies StoredFarmer;
  } catch {
    return null;
  }
}

function writeStoredFarmer(farmer: StoredFarmer) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORED_FARMER_KEY, JSON.stringify(farmer));
}

function clearStoredFarmer() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORED_FARMER_KEY);
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function readAppRouteFromLocation(): AppRoute {
  if (typeof window === 'undefined') {
    return { tabId: 'fields', screen: 'workspace' };
  }

  const pathname = normalizePathname(window.location.pathname);
  switch (pathname) {
    case '/':
    case '/fields':
      return { tabId: 'fields', screen: 'workspace' };
    case '/fields/add':
      return { tabId: 'fields', screen: 'add-field' };
    case '/overview':
      return { tabId: 'overview', screen: 'workspace' };
    case '/insights':
      return { tabId: 'insights', screen: 'workspace' };
    case '/alerts':
      return { tabId: 'alerts', screen: 'workspace' };
    default:
      return { tabId: 'fields', screen: 'workspace' };
  }
}

function buildRoutePath(route: AppRoute) {
  return route.screen === 'add-field' ? ADD_FIELD_PATH : TAB_ROOT_PATHS[route.tabId];
}

function writeAppRoute(route: AppRoute, replace = false) {
  if (typeof window === 'undefined') return;

  const nextPath = buildRoutePath(route);
  const nextUrl = `${nextPath}${window.location.search}`;
  const currentUrl = `${normalizePathname(window.location.pathname)}${window.location.search}`;
  if (nextUrl === currentUrl) return;

  window.history[replace ? 'replaceState' : 'pushState'](null, '', nextUrl);
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

function parseFieldType(value: unknown): FieldType {
  return value === 'pervits' ? 'pervits' : 'normal';
}

function parsePivotAlignment(value: unknown): PivotAlignment | null {
  return PIVOT_ALIGNMENT_OPTIONS.some((option) => option.value === value)
    ? (value as PivotAlignment)
    : null;
}

function formatFieldType(fieldType: FieldType) {
  return fieldType === 'pervits' ? 'Pervits' : 'Normal';
}

function formatPivotAlignment(alignment: PivotAlignment | null) {
  if (!alignment) return null;
  return PIVOT_ALIGNMENT_OPTIONS.find((option) => option.value === alignment)?.label ?? alignment;
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
        fieldType: formatFieldType(field.fieldType),
        pivotAlignment: formatPivotAlignment(field.pivotAlignment),
        mapLabel:
          field.fieldType === 'pervits' && field.pivotAlignment
            ? `${field.fieldName} · Pervits · ${formatPivotAlignment(field.pivotAlignment)}`
            : `${field.fieldName} · Normal`,
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

  if (!map.getLayer('saved-fields-label')) {
    map.addLayer({
      id: 'saved-fields-label',
      type: 'symbol',
      source: SAVED_FIELDS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'mapLabel'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-offset': [0, 0],
      },
      paint: {
        'text-color': '#16351e',
        'text-halo-color': '#f7fbf7',
        'text-halo-width': 1.2,
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

function AccountSwitchIcon() {
  return (
    <svg
      className="account-switch-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12.2a3.2 3.2 0 1 0-3.2-3.2 3.2 3.2 0 0 0 3.2 3.2Z" />
      <path d="M17.4 17.2a5.9 5.9 0 0 0-10.8 0" />
    </svg>
  );
}

function FieldMapPanel({
  currentFarmerId,
  mode,
  onAddField,
  onCancelAddField,
  onFieldSaved,
}: {
  currentFarmerId: string;
  mode: 'overview' | 'create';
  onAddField?: () => void;
  onCancelAddField?: () => void;
  onFieldSaved?: (fieldName: string) => void;
}) {
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
  const [fieldNameDraft, setFieldNameDraft] = useState('');
  const [drawMode, setDrawMode] = useState<DrawMode>('circle');
  const [pivotAlignmentDraft, setPivotAlignmentDraft] = useState<PivotAlignment>('north');
  const [freePoints, setFreePoints] = useState<Coordinate[]>([]);
  const [freePolygonComplete, setFreePolygonComplete] = useState(false);
  const [circleCenter, setCircleCenter] = useState<Coordinate | null>(null);
  const [circleRadiusMeters, setCircleRadiusMeters] = useState<number | null>(null);
  const [circleRadiusLocked, setCircleRadiusLocked] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const isAddingField = mode === 'create';
  const draftFieldType: FieldType = drawMode === 'circle' ? 'pervits' : 'normal';

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
    setPivotAlignmentDraft('north');
    setFreePoints([]);
    setFreePolygonComplete(false);
    setCircleCenter(null);
    setCircleRadiusMeters(null);
    setCircleRadiusLocked(false);
    setFieldMessage(null);
    setFieldError(null);
  }

  async function loadFields() {
    if (!supabase || !currentFarmerId) {
      setFields([]);
      setFieldsLoading(false);
      return;
    }

    setFieldsLoading(true);
    setFieldError(null);

    const { data, error } = await supabase.rpc('get_fields_for_farmer', {
      input_farmer_id: currentFarmerId,
    });

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
          fieldType: parseFieldType(record.field_type),
          pivotAlignment: parsePivotAlignment(record.pivot_alignment),
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

    if (!currentFarmerId) {
      setFieldError('Choose a farmer before saving a field.');
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

    if (draftFieldType === 'pervits' && !pivotAlignmentDraft) {
      setFieldError('Choose the current pivot alignment before confirming the boundary.');
      return;
    }

    setSavingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('create_field', {
      input_farmer_id: currentFarmerId,
      input_field_name: fieldNameDraft.trim(),
      input_boundary: draftPolygon,
      input_field_type: draftFieldType,
      input_pivot_alignment: draftFieldType === 'pervits' ? pivotAlignmentDraft : null,
    });

    setSavingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    const savedFieldName = fieldNameDraft.trim();
    setFieldMessage(`Saved ${savedFieldName}.`);
    setFieldNameDraft('');
    resetDraftState('circle');
    await loadFields();
    onFieldSaved?.(savedFieldName);
  }

  useEffect(() => {
    void loadFields();
  }, [currentFarmerId]);

  useEffect(() => {
    setFieldNameDraft('');
    resetDraftState('circle');

    if (mode === 'create') {
      setFieldMessage('Enter a field name, then place the boundary on the map.');
    }
  }, [mode]);

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
      <div className="field-panel-copy">
        {!isAddingField ? <h2 className="field-panel-title">Field boundaries</h2> : null}
        {!isAddingField ? (
          <button type="button" className="btn btn-primary" onClick={onAddField}>
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
            <p className="draw-help">
              {drawMode === 'circle'
                ? 'Circle mode creates a Pervits field: click once for the center, move to size it, click again to lock the boundary.'
                : 'Free mode: click each boundary point, then click the first point to close the field.'}
            </p>
            <div className="field-meta-banner" aria-live="polite">
              <span className="field-type-pill">{formatFieldType(draftFieldType)} field</span>
              {draftFieldType === 'pervits' ? (
                <span className="field-meta-copy">Set the pivot arm alignment before saving.</span>
              ) : (
                <span className="field-meta-copy">Free mode saves this as a normal field.</span>
              )}
            </div>
            {draftFieldType === 'pervits' ? (
              <>
                <label className="auth-label" htmlFor="pivot-alignment">
                  Current pivot alignment
                </label>
                <select
                  id="pivot-alignment"
                  className="auth-input"
                  value={pivotAlignmentDraft}
                  onChange={(event) => setPivotAlignmentDraft(event.target.value as PivotAlignment)}
                >
                  {PIVOT_ALIGNMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <div className="field-action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmBoundary()}
                disabled={savingField || !draftPolygon || !fieldNameDraft.trim()}
              >
                {savingField ? 'Saving field...' : 'Confirm boundary'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onCancelAddField}>
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
          <div className="field-summary-list">
            {fields.map((field) => (
              <article key={field.id} className="field-summary-card">
                <div className="field-summary-header">
                  <strong>{field.fieldName}</strong>
                  <span className="field-type-pill">{formatFieldType(field.fieldType)}</span>
                </div>
                <p className="field-summary-meta">
                  {field.fieldType === 'pervits'
                    ? `Pivot alignment: ${formatPivotAlignment(field.pivotAlignment) ?? 'Not set'}`
                    : 'No pivot alignment tracked for normal fields.'}
                </p>
              </article>
            ))}
          </div>
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
          <div className={isAddingField ? 'map-stage is-drawing' : 'map-stage'}>
            <div
              id={mapId}
              ref={mapRef}
              className={isAddingField ? 'map-canvas' : 'map-canvas map-canvas-overview'}
              data-testid="mapbox-canvas"
            />
            {isAddingField ? (
              <div className="map-draw-controls" role="tablist" aria-label="Boundary mode">
                <button
                  type="button"
                  aria-label="Circle mode"
                  title="Circle mode"
                  className={drawMode === 'circle' ? 'map-draw-button is-active' : 'map-draw-button'}
                  onClick={() => resetDraftState('circle')}
                >
                  <span className="sr-only">Circle mode</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="6.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Free mode"
                  title="Free mode"
                  className={drawMode === 'free' ? 'map-draw-button is-active' : 'map-draw-button'}
                  onClick={() => resetDraftState('free')}
                >
                  <span className="sr-only">Free mode</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 16.5 9 8l5 6 5-7" />
                    <circle cx="5" cy="16.5" r="1.4" />
                    <circle cx="9" cy="8" r="1.4" />
                    <circle cx="14" cy="14" r="1.4" />
                    <circle cx="19" cy="7" r="1.4" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
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
    <section className="placeholder-panel" aria-labelledby={`${tab.id}-placeholder-title`}>
      <h2 id={`${tab.id}-placeholder-title`}>{tab.label}</h2>
      <p>{tab.description}</p>
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readAppRouteFromLocation());
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [appState, setAppState] = useState<AppState>('loading');
  const [farmerNameInput, setFarmerNameInput] = useState('');
  const [currentFarmerName, setCurrentFarmerName] = useState('');
  const [currentFarmerId, setCurrentFarmerId] = useState('');
  const [farmerMessage, setFarmerMessage] = useState<string | null>(null);
  const [farmerError, setFarmerError] = useState<string | null>(null);
  const [fieldFlowMessage, setFieldFlowMessage] = useState<string | null>(null);
  const [savingFarmer, setSavingFarmer] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const activeTab = route.tabId;
  const activeScreen = route.screen;

  useEffect(() => {
    function handleLocationChange() {
      setRoute(readAppRouteFromLocation());
    }

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  function navigateTo(nextRoute: AppRoute, replace = false) {
    writeAppRoute(nextRoute, replace);
    setRoute(nextRoute);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setAppState('signed-out');
      return;
    }

    let mounted = true;
    const storedFarmer = readStoredFarmer();

    if (!storedFarmer) {
      setAppState('signed-out');
      return () => {
        mounted = false;
      };
    }

    setFarmerNameInput(storedFarmer.name);

    supabase
      .rpc('get_farmer', { input_farmer_id: storedFarmer.id })
      .then(({ data, error }) => {
        if (!mounted) return;

        if (error) {
          clearStoredFarmer();
          setFarmerError(error.message);
          setAppState('signed-out');
          return;
        }

        const farmer = (data as RpcFarmerRow[] | null)?.[0];
        if (!farmer) {
          clearStoredFarmer();
          setAppState('signed-out');
          return;
        }

        const nextFarmer = {
          id: farmer.id,
          name: farmer.name,
        } satisfies StoredFarmer;

        writeStoredFarmer(nextFarmer);
        setCurrentFarmerId(nextFarmer.id);
        setCurrentFarmerName(nextFarmer.name);
        setFarmerMessage(null);
        setFarmerError(null);
        setAppState('signed-in');
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (appState !== 'signed-in' || typeof window === 'undefined') return;

    const currentPath = normalizePathname(window.location.pathname);
    const expectedPath = buildRoutePath(route);
    if (currentPath !== expectedPath) {
      writeAppRoute(route, true);
    }
  }, [appState, route]);

  async function handleFarmerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseConfigured || !supabase) {
      setFarmerError('Supabase is not configured yet.');
      return;
    }

    if (!farmerNameInput.trim()) {
      setFarmerError('Add a farmer name first.');
      return;
    }

    setSavingFarmer(true);
    setFarmerError(null);
    setFarmerMessage(null);

    const { data, error } = await supabase.rpc('upsert_farmer', {
      input_name: farmerNameInput.trim(),
    });

    setSavingFarmer(false);

    if (error) {
      setFarmerError(error.message);
      return;
    }

    const farmer = (data as RpcFarmerRow[] | null)?.[0];
    if (!farmer) {
      setFarmerError('Farmer profile could not be created.');
      return;
    }

    const nextFarmer = {
      id: farmer.id,
      name: farmer.name,
    } satisfies StoredFarmer;

    writeStoredFarmer(nextFarmer);
    setCurrentFarmerId(nextFarmer.id);
    setCurrentFarmerName(nextFarmer.name);
    setFarmerMessage(
      farmer.was_created
        ? `Farmer profile created for ${farmer.name}.`
        : `Continuing as ${farmer.name}.`,
    );
    setAppState('signed-in');
  }

  function handleSwitchFarmer() {
    setAccountMenuOpen(false);
    clearStoredFarmer();
    navigateTo({ tabId: 'fields', screen: 'workspace' }, true);
    setFarmerMessage(null);
    setFarmerError(null);
    setFieldFlowMessage(null);
    setCurrentFarmerId('');
    setCurrentFarmerName('');
    setFarmerNameInput('');
    setAppState('signed-out');
  }

  function handleOpenAddFieldScreen() {
    setAccountMenuOpen(false);
    setFieldFlowMessage(null);
    navigateTo({ tabId: 'fields', screen: 'add-field' });
  }

  function handleCloseAddFieldScreen() {
    setAccountMenuOpen(false);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldSaved(fieldName: string) {
    setFieldFlowMessage(`Saved ${fieldName}.`);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  if (appState === 'loading') {
    return (
      <div className="page auth-page" id="top">
        <main className="auth-shell">
          <section className="auth-card">
            <Logo />
            <div className="auth-copy">
              <h1>Checking farmer profile</h1>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (appState === 'signed-out') {
    return (
      <div className="page auth-page" id="top">
        <main className="auth-shell">
          <section className="auth-card" data-testid="auth-card">
            <Logo />
            <div className="auth-copy">
              <h1>Open your farmer workspace</h1>
              <p>
                Enter a farmer name. This browser will remember that farmer and keep
                field data linked to the same farmer record.
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
              <form className="auth-form" onSubmit={handleFarmerSubmit}>
                <label className="auth-label" htmlFor="farmer-name">
                  Name
                </label>
                <input
                  id="farmer-name"
                  className="auth-input"
                  type="text"
                  name="farmer-name"
                  autoComplete="name"
                  value={farmerNameInput}
                  onChange={(event) => setFarmerNameInput(event.target.value)}
                  placeholder="Frikkie Demo Farmer"
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={savingFarmer}
                >
                  {savingFarmer ? 'Opening workspace...' : 'Continue'}
                </button>
              </form>
            )}

            {farmerMessage ? (
              <p className="auth-feedback auth-feedback-success" aria-live="polite">
                {farmerMessage}
              </p>
            ) : null}

            {farmerError ? (
              <p className="auth-feedback auth-feedback-error" aria-live="polite">
                {farmerError}
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

          {activeScreen === 'workspace' ? (
            <nav className="nav-links" aria-label="Main tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === activeTab ? 'nav-tab is-active' : 'nav-tab'}
                  onClick={() => navigateTo({ tabId: tab.id, screen: 'workspace' })}
                  aria-pressed={tab.id === activeTab}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          ) : (
            <div className="route-crumb">
              <button type="button" className="btn btn-secondary" onClick={handleCloseAddFieldScreen}>
                Back to fields
              </button>
            </div>
          )}
          <div className="nav-cta" ref={accountMenuRef}>
            <button
              type="button"
              className="account-switch-button"
              aria-label="Open account menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              title="Account"
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              <AccountSwitchIcon />
            </button>
            {accountMenuOpen ? (
              <div className="account-menu" role="menu" aria-label="Account actions">
                <button
                  type="button"
                  className="account-menu-item"
                  role="menuitem"
                  onClick={handleSwitchFarmer}
                >
                  Switch farmer
                </button>
              </div>
            ) : null}
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
            {activeScreen === 'workspace' ? (
              tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === activeTab ? 'mobile-tab is-active' : 'mobile-tab'}
                  onClick={() => {
                    navigateTo({ tabId: tab.id, screen: 'workspace' });
                  }}
                  aria-pressed={tab.id === activeTab}
                >
                  {tab.label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="mobile-tab"
                onClick={() => {
                  handleCloseAddFieldScreen();
                  setMenuOpen(false);
                }}
              >
                Back to fields
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary mobile-cta mobile-menu-button"
              onClick={() => {
                setMenuOpen(false);
                handleSwitchFarmer();
              }}
            >
              Switch farmer
            </button>
          </div>
        ) : null}
      </header>

      <main className="app-shell">
        <div className="container">
          {activeScreen === 'workspace' ? (
            <section className="content-card workspace-card">
              {activeTab === 'fields' ? (
                <>
                  <FieldMapPanel
                    key="fields-overview"
                    currentFarmerId={currentFarmerId}
                    mode="overview"
                    onAddField={handleOpenAddFieldScreen}
                  />
                  {fieldFlowMessage ? (
                    <p className="auth-feedback auth-feedback-success" aria-live="polite">
                      {fieldFlowMessage}
                    </p>
                  ) : null}
                </>
              ) : (
                <PlaceholderPanel tab={tabs.find(({ id }) => id === activeTab) ?? tabs[0]} />
              )}
            </section>
          ) : (
            <section className="content-card route-card" aria-labelledby="field-route-title">
              <header className="content-header route-header">
                <div>
                  <p className="eyebrow">Field setup</p>
                  <h2 id="field-route-title">Add field</h2>
                  <p className="route-copy">
                    Draw and save a field for {currentFarmerName || 'this farmer'} on a separate screen.
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={handleCloseAddFieldScreen}>
                  Back to fields
                </button>
              </header>

              <FieldMapPanel
                key="field-create"
                currentFarmerId={currentFarmerId}
                mode="create"
                onCancelAddField={handleCloseAddFieldScreen}
                onFieldSaved={handleFieldSaved}
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
