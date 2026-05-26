import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import './App.css';
import { supabase, supabaseConfigured } from './supabase';

type TabId = 'insights' | 'fields' | 'actions';
type AppState = 'loading' | 'signed-out' | 'signed-in';
type AppScreen = 'workspace' | 'add-field' | 'edit-field';
type AppRoute = {
  tabId: TabId;
  screen: AppScreen;
  fieldId?: string | null;
};
type DrawMode = 'circle' | 'free';
type Coordinate = [number, number];
type FieldType = 'pivot' | 'normal';
type PolygonGeometry = {
  type: 'Polygon';
  coordinates: Coordinate[][];
};
type PointGeometry = {
  type: 'Point';
  coordinates: Coordinate;
};
type LineStringGeometry = {
  type: 'LineString';
  coordinates: Coordinate[];
};
type MapFeature = {
  type: 'Feature';
  geometry: PolygonGeometry | PointGeometry | LineStringGeometry;
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
  pivotAngleDegrees: number | null;
};
type RpcFieldRow = {
  id: string;
  field_name: string;
  boundary: unknown;
  field_type?: string | null;
  pivot_angle_degrees?: number | null;
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
    id: 'fields',
    label: 'Overview',
    title: 'Field boundaries',
    description:
      'Add fields, draw boundaries, and keep each farmer focused on their own map.',
  },
  {
    id: 'actions',
    label: 'Actions',
    title: 'Log a pivot action',
    description:
      'Record how far the pivot moved and how many millimetres of water it applied.',
  },
  {
    id: 'insights',
    label: 'Insights',
    title: 'Agronomy insights',
    description:
      'This tab is ready for recommendations, anomaly summaries, and sensor-driven guidance.',
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
const SAVED_PIVOT_SOURCE_ID = 'saved-pivot';
const DRAFT_PIVOT_SOURCE_ID = 'draft-pivot';
const STORED_FARMER_KEY = 'pivot-sense.active-farmer';
const TOUCH_HIT_RADIUS_PX = 28;
const TAB_ROOT_PATHS: Record<TabId, string> = {
  insights: '/insights',
  fields: '/fields',
  actions: '/actions',
};
const ADD_FIELD_PATH = '/fields/add';
const EDIT_FIELD_PATH_PREFIX = '/fields/';

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
  if (pathname.startsWith(EDIT_FIELD_PATH_PREFIX) && pathname !== ADD_FIELD_PATH) {
    const fieldId = pathname.slice(EDIT_FIELD_PATH_PREFIX.length);
    if (fieldId) {
      return {
        tabId: 'fields',
        screen: 'edit-field',
        fieldId: decodeURIComponent(fieldId),
      };
    }
  }

  switch (pathname) {
    case '/':
    case '/fields':
      return { tabId: 'fields', screen: 'workspace' };
    case '/fields/add':
      return { tabId: 'fields', screen: 'add-field' };
    case '/insights':
      return { tabId: 'insights', screen: 'workspace' };
    case '/actions':
      return { tabId: 'actions', screen: 'workspace' };
    default:
      return { tabId: 'fields', screen: 'workspace' };
  }
}

function buildRoutePath(route: AppRoute) {
  if (route.screen === 'add-field') {
    return ADD_FIELD_PATH;
  }

  if (route.screen === 'edit-field' && route.fieldId) {
    return `${EDIT_FIELD_PATH_PREFIX}${encodeURIComponent(route.fieldId)}`;
  }

  return TAB_ROOT_PATHS[route.tabId];
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

function parseFieldRecord(record: RpcFieldRow): FieldRecord | null {
  const boundary = parseBoundary(record.boundary);
  if (!boundary) return null;

  return {
    id: record.id,
    fieldName: record.field_name,
    boundary,
    fieldType: parseFieldType(record.field_type),
    pivotAngleDegrees: parsePivotAngleDegrees(record.pivot_angle_degrees),
  } satisfies FieldRecord;
}

async function fetchFieldsForFarmer(currentFarmerId: string) {
  if (!supabase || !currentFarmerId) {
    return {
      data: [] as FieldRecord[],
      error: null as string | null,
    };
  }

  const { data, error } = await supabase.rpc('get_fields_for_farmer', {
    input_farmer_id: currentFarmerId,
  });

  if (error) {
    return {
      data: [] as FieldRecord[],
      error: error.message,
    };
  }

  return {
    data: ((data ?? []) as RpcFieldRow[])
      .map(parseFieldRecord)
      .filter((field: FieldRecord | null): field is FieldRecord => Boolean(field)),
    error: null as string | null,
  };
}

function parseFieldType(value: unknown): FieldType {
  return value === 'pivot' || value === 'pervits' ? 'pivot' : 'normal';
}

function normalizeAngleDegrees(value: number) {
  const normalized = Math.round(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatFieldType(fieldType: FieldType) {
  return fieldType === 'pivot' ? 'Pivots' : 'Normal';
}

function parsePivotAngleDegrees(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return normalizeAngleDegrees(parsed);
}

function formatPivotAngleDegrees(angleDegrees: number | null) {
  return angleDegrees === null ? null : `${normalizeAngleDegrees(angleDegrees)} deg`;
}

function getCircleCoordinate(
  center: Coordinate,
  radiusMeters: number,
  angleDegrees: number,
): Coordinate {
  const latRadians = (center[1] * Math.PI) / 180;
  const latDegreesPerMeter = 1 / 111320;
  const lngDegreesPerMeter = 1 / (111320 * Math.max(Math.cos(latRadians), 0.00001));
  const radians = (normalizeAngleDegrees(angleDegrees) * Math.PI) / 180;

  return [
    center[0] + Math.sin(radians) * radiusMeters * lngDegreesPerMeter,
    center[1] + Math.cos(radians) * radiusMeters * latDegreesPerMeter,
  ];
}

function computeDefaultPivotRadius(map: mapboxgl.Map, centerPoint: mapboxgl.Point): number {
  const centerLngLat = map.unproject(centerPoint);
  const offsetLngLat = map.unproject(new mapboxgl.Point(centerPoint.x + 80, centerPoint.y));
  return centerLngLat.distanceTo(offsetLngLat);
}

function getPivotAngleDegrees(center: Coordinate, target: Coordinate) {
  const deltaLng = target[0] - center[0];
  const deltaLat = target[1] - center[1];
  const radians = Math.atan2(deltaLng, deltaLat);
  return normalizeAngleDegrees((radians * 180) / Math.PI);
}

function deriveCircleFromPolygon(
  polygon: PolygonGeometry,
): { center: Coordinate; radiusMeters: number } | null {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return null;

  const openRing = ring.slice(0, -1);
  if (openRing.length < 3) return null;

  const center = openRing.reduce(
    (current, [lng, lat]) => [current[0] + lng / openRing.length, current[1] + lat / openRing.length],
    [0, 0] as Coordinate,
  );

  const centerLngLat = new mapboxgl.LngLat(center[0], center[1]);
  const radiusMeters =
    openRing.reduce(
      (sum, coordinates) => sum + centerLngLat.distanceTo(new mapboxgl.LngLat(coordinates[0], coordinates[1])),
      0,
    ) / openRing.length;

  return radiusMeters > 0 ? { center, radiusMeters } : null;
}

function buildPivotOverlayGeoJson(
  entries: Array<{
    id: string;
    center: Coordinate;
    radiusMeters: number;
    pivotAngleDegrees: number;
  }>,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.flatMap((entry) => {
      const handle = getCircleCoordinate(entry.center, entry.radiusMeters, entry.pivotAngleDegrees);

      return [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [entry.center, handle],
          },
          properties: {
            id: entry.id,
            overlayRole: 'arm',
            pivotAngleDegrees: normalizeAngleDegrees(entry.pivotAngleDegrees),
          },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: handle,
          },
          properties: {
            id: entry.id,
            overlayRole: 'handle',
            pivotAngleDegrees: normalizeAngleDegrees(entry.pivotAngleDegrees),
          },
        },
      ];
    }),
  };
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
        pivotAngleDegrees: formatPivotAngleDegrees(field.pivotAngleDegrees),
        mapLabel:
          field.fieldType === 'pivot' && field.pivotAngleDegrees !== null
            ? `${field.fieldName} - Pivots - ${formatPivotAngleDegrees(field.pivotAngleDegrees)}`
            : `${field.fieldName} - Normal`,
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

  if (!map.getLayer('saved-pivot-arm')) {
    map.addLayer({
      id: 'saved-pivot-arm',
      type: 'line',
      source: SAVED_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'arm'],
      paint: {
        'line-color': '#14532d',
        'line-width': 2.5,
      },
    });
  }

  if (!map.getLayer('saved-pivot-handle')) {
    map.addLayer({
      id: 'saved-pivot-handle',
      type: 'circle',
      source: SAVED_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'handle'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#14532d',
        'circle-stroke-color': '#f7fbf7',
        'circle-stroke-width': 1.5,
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
        'circle-radius': 10,
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

  if (!map.getLayer('draft-pivot-arm')) {
    map.addLayer({
      id: 'draft-pivot-arm',
      type: 'line',
      source: DRAFT_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'arm'],
      paint: {
        'line-color': '#b45309',
        'line-width': 3,
      },
    });
  }

  if (!map.getLayer('draft-pivot-handle')) {
    map.addLayer({
      id: 'draft-pivot-handle',
      type: 'circle',
      source: DRAFT_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'handle'],
      paint: {
        'circle-radius': 12,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#ffffff',
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

function TabIcon({ tabId }: { tabId: TabId }) {
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    focusable: false as const,
    className: 'bottom-tab-icon',
  };

  if (tabId === 'fields') {
    return (
      <svg {...common}>
        <path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z" />
        <path d="M9 4 V18" />
        <path d="M15 6 V20" />
      </svg>
    );
  }

  if (tabId === 'actions') {
    return (
      <svg {...common}>
        <path d="M12 4c-3 4-5 6.5-5 9.2A5 5 0 0 0 17 13.2C17 10.5 15 8 12 4Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 18h16" />
      <path d="M7 18V11" />
      <path d="M12 18V7" />
      <path d="M17 18v-5" />
    </svg>
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

function FieldNameInput({
  fieldNameDraft,
  onFieldNameChange,
}: {
  fieldNameDraft: string;
  onFieldNameChange: (value: string) => void;
}) {
  return (
    <div className="field-name-card">
      <label className="auth-label" htmlFor="field-name">
        Field name
      </label>
      <input
        id="field-name"
        className="auth-input"
        type="text"
        placeholder="North pivot"
        value={fieldNameDraft}
        onChange={(event) => onFieldNameChange(event.target.value)}
      />
    </div>
  );
}

function FieldEditorCard({
  mode,
  fieldType,
  pivotAngleDraft,
  savingField,
  deletingField,
  disablePrimaryAction,
  onPrimaryAction,
  onCancel,
  onResetDraft,
  onDelete,
}: {
  mode: 'create' | 'edit';
  fieldType: FieldType;
  pivotAngleDraft: number | null;
  savingField: boolean;
  deletingField: boolean;
  disablePrimaryAction: boolean;
  onPrimaryAction: () => void;
  onCancel: () => void;
  onResetDraft?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="field-creation-card">
      <div className="field-creation-grid">
        <div className="field-meta-banner" aria-live="polite">
          <span className="field-type-pill">{formatFieldType(fieldType)} field</span>
        </div>
        {fieldType === 'pivot' ? (
          <p className="pivot-angle-readout">
            Current pivot angle: <strong>{formatPivotAngleDegrees(pivotAngleDraft)}</strong>
          </p>
        ) : null}
        <div className="field-action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onPrimaryAction}
            disabled={disablePrimaryAction}
          >
            {savingField
              ? mode === 'create'
                ? 'Saving field...'
                : 'Saving changes...'
              : mode === 'create'
                ? 'Confirm boundary'
                : 'Save changes'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          {mode === 'create' && onResetDraft ? (
            <button type="button" className="btn btn-secondary" onClick={onResetDraft}>
              Reset draft
            </button>
          ) : null}
          {mode === 'edit' && onDelete ? (
            <button
              type="button"
              className="btn btn-secondary btn-danger"
              onClick={onDelete}
              disabled={deletingField}
            >
              {deletingField ? 'Deleting field...' : 'Delete field'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FieldMapPanel({
  currentFarmerId,
  mode,
  editedFieldId,
  onAddField,
  onEditField,
  onCancelFieldScreen,
  onFieldSaved,
  onFieldDeleted,
}: {
  currentFarmerId: string;
  mode: 'overview' | 'create' | 'edit';
  editedFieldId?: string;
  onAddField?: () => void;
  onEditField?: (fieldId: string) => void;
  onCancelFieldScreen?: () => void;
  onFieldSaved?: (fieldName: string) => void;
  onFieldDeleted?: (fieldName: string) => void;
}) {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const pivotDragActiveRef = useRef(false);
  const pivotPointerIdRef = useRef<number | null>(null);
  const activePivotCenterRef = useRef<Coordinate | null>(null);
  const draftPivotHandleRef = useRef<Coordinate | null>(null);
  const isAddingFieldRef = useRef(false);
  const isEditingFieldRef = useRef(false);
  const drawModeRef = useRef<DrawMode>('circle');
  const circleCenterRef = useRef<Coordinate | null>(null);
  const circleRadiusLockedRef = useRef(false);
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
  const [pivotAngleDraft, setPivotAngleDraft] = useState(0);
  const [freePoints, setFreePoints] = useState<Coordinate[]>([]);
  const [freePolygonComplete, setFreePolygonComplete] = useState(false);
  const [circleCenter, setCircleCenter] = useState<Coordinate | null>(null);
  const [circleRadiusMeters, setCircleRadiusMeters] = useState<number | null>(null);
  const [circleRadiusLocked, setCircleRadiusLocked] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [deletingField, setDeletingField] = useState(false);
  const isAddingField = mode === 'create';
  const isEditingField = mode === 'edit';
  const selectedField = isEditingField
    ? fields.find((field) => field.id === editedFieldId) ?? null
    : null;
  const selectedCircle =
    selectedField?.fieldType === 'pivot' ? deriveCircleFromPolygon(selectedField.boundary) : null;
  const draftFieldType: FieldType = isEditingField
    ? selectedField?.fieldType ?? 'normal'
    : drawMode === 'circle'
      ? 'pivot'
      : 'normal';

  const freePolygon = freePolygonComplete ? buildFreePolygon(freePoints) : null;
  const circlePolygon =
    circleCenter && circleRadiusMeters && circleRadiusMeters > 5
      ? createCirclePolygon(circleCenter, circleRadiusMeters)
      : null;
  const draftPolygon = isEditingField
    ? selectedField?.boundary ?? null
    : drawMode === 'free'
      ? freePolygon
      : circlePolygon;
  const circlePreviewEdge =
    circleCenter && circleRadiusMeters && circleRadiusMeters > 0 && !circleRadiusLocked
      ? getCircleCoordinate(circleCenter, circleRadiusMeters, 0)
      : null;
  const visibleFields = isEditingField ? (selectedField ? [selectedField] : []) : fields;
  const savedPivotEntries = (isEditingField ? [] : fields).flatMap((field) => {
    if (field.fieldType !== 'pivot' || field.pivotAngleDegrees === null) return [];

    const circle = deriveCircleFromPolygon(field.boundary);
    if (!circle) return [];

    return [
      {
        id: field.id,
        center: circle.center,
        radiusMeters: circle.radiusMeters,
        pivotAngleDegrees: field.pivotAngleDegrees,
      },
    ];
  });
  const draftPivotEntries = isEditingField
    ? selectedField?.fieldType === 'pivot' && selectedCircle
      ? [
          {
            id: selectedField.id,
            center: selectedCircle.center,
            radiusMeters: selectedCircle.radiusMeters,
            pivotAngleDegrees: pivotAngleDraft,
          },
        ]
      : []
    : draftFieldType === 'pivot' &&
        circleCenter &&
        circleRadiusMeters &&
        circleRadiusMeters > 5 &&
        circleRadiusLocked
      ? [
          {
            id: 'draft',
            center: circleCenter,
            radiusMeters: circleRadiusMeters,
            pivotAngleDegrees: pivotAngleDraft,
          },
        ]
      : [];
  const draftPivotHandle =
    draftPivotEntries.length > 0
      ? getCircleCoordinate(
          draftPivotEntries[0].center,
          draftPivotEntries[0].radiusMeters,
          draftPivotEntries[0].pivotAngleDegrees,
        )
      : null;

  useEffect(() => {
    activePivotCenterRef.current = isEditingField ? selectedCircle?.center ?? null : circleCenter;
    draftPivotHandleRef.current = draftPivotHandle;
    isAddingFieldRef.current = isAddingField;
    isEditingFieldRef.current = isEditingField;
    drawModeRef.current = drawMode;
    circleCenterRef.current = circleCenter;
    circleRadiusLockedRef.current = circleRadiusLocked;
  }, [
    isEditingField,
    selectedCircle,
    circleCenter,
    draftPivotHandle,
    isAddingField,
    drawMode,
    circleRadiusLocked,
  ]);

  function resetDraftState(nextMode: DrawMode = drawMode) {
    setDrawMode(nextMode);
    setPivotAngleDraft(0);
    setFreePoints([]);
    setFreePolygonComplete(false);
    setCircleCenter(null);
    setCircleRadiusMeters(null);
    setCircleRadiusLocked(false);
    setFieldMessage(null);
    setFieldError(null);
  }

  async function loadFields() {
    setFieldsLoading(true);
    setFieldError(null);
    const result = await fetchFieldsForFarmer(currentFarmerId);
    setFields(result.data);
    if (result.error) {
      setFieldError(result.error);
    }
    setFieldsLoading(false);
  }

  function updatePivotHandleFromLngLat(center: Coordinate, lngLat: mapboxgl.LngLat) {
    setPivotAngleDraft(getPivotAngleDegrees(center, [lngLat.lng, lngLat.lat]));
    if (isEditingFieldRef.current) {
      return;
    }
    const radius = new mapboxgl.LngLat(center[0], center[1]).distanceTo(lngLat);
    if (radius >= 5) {
      setCircleRadiusMeters(radius);
    }
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

    setSavingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('create_field', {
      input_farmer_id: currentFarmerId,
      input_field_name: fieldNameDraft.trim(),
      input_boundary: draftPolygon,
      input_field_type: draftFieldType,
      input_pivot_angle_degrees: draftFieldType === 'pivot' ? pivotAngleDraft : null,
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

  async function handleSaveFieldChanges() {
    if (!supabase) {
      setFieldError('Supabase is not configured.');
      return;
    }

    if (!currentFarmerId) {
      setFieldError('Choose a farmer before saving the field.');
      return;
    }

    if (!selectedField) {
      setFieldError('Field not found.');
      return;
    }

    if (!fieldNameDraft.trim()) {
      setFieldError('Add the field name before saving.');
      return;
    }

    setSavingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('update_field', {
      input_farmer_id: currentFarmerId,
      input_field_id: selectedField.id,
      input_field_name: fieldNameDraft.trim(),
      input_pivot_angle_degrees: selectedField.fieldType === 'pivot' ? pivotAngleDraft : null,
    });

    setSavingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    const savedFieldName = fieldNameDraft.trim();
    setFieldMessage(`Updated ${savedFieldName}.`);
    await loadFields();
    onFieldSaved?.(savedFieldName);
  }

  async function handleDeleteField() {
    if (!supabase) {
      setFieldError('Supabase is not configured.');
      return;
    }

    if (!selectedField) {
      setFieldError('Field not found.');
      return;
    }

    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selectedField.fieldName}?`)) {
      return;
    }

    setDeletingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('delete_field', {
      input_farmer_id: currentFarmerId,
      input_field_id: selectedField.id,
    });

    setDeletingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    onFieldDeleted?.(selectedField.fieldName);
  }

  useEffect(() => {
    void loadFields();
  }, [currentFarmerId]);

  useEffect(() => {
    if (mode === 'create') {
      setFieldNameDraft('');
      resetDraftState('circle');
      setFieldMessage('Enter a field name, then place the boundary on the map.');
      return;
    }

    setFreePoints([]);
    setFreePolygonComplete(false);
    setCircleCenter(null);
    setCircleRadiusMeters(null);
    setCircleRadiusLocked(false);
    setFieldMessage(null);
    setFieldError(null);
  }, [mode, editedFieldId]);

  useEffect(() => {
    if (!isEditingField || !selectedField) return;
    setFieldNameDraft(selectedField.fieldName);
    setPivotAngleDraft(selectedField.pivotAngleDegrees ?? 0);
  }, [isEditingField, selectedField]);

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
        clickTolerance: 10,
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

    ensureGeoJsonSource(map, SAVED_FIELDS_SOURCE_ID, buildSavedFieldsGeoJson(visibleFields));
    ensureGeoJsonSource(map, SAVED_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(savedPivotEntries));
    ensureGeoJsonSource(map, DRAFT_BOUNDARY_SOURCE_ID, buildDraftBoundaryGeoJson(draftPolygon));
    ensureGeoJsonSource(
      map,
      DRAFT_POINTS_SOURCE_ID,
      buildDraftPointsGeoJson(drawMode, freePoints, circleCenter, circlePreviewEdge),
    );
    ensureGeoJsonSource(map, DRAFT_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(draftPivotEntries));
    ensureMapLayers(map);
  }, [
    status,
    visibleFields,
    savedPivotEntries,
    draftPolygon,
    drawMode,
    freePoints,
    circleCenter,
    circlePreviewEdge,
    draftPivotEntries,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || status !== 'ready') return;

    if (visibleFields.length === 0 && !draftPolygon) {
      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: 900,
      });
      return;
    }

    const polygons = draftPolygon ? [draftPolygon] : visibleFields.map((field) => field.boundary);
    const bounds = polygons.reduce((currentBounds, polygon) => {
      const nextBounds = getPolygonBounds(polygon);
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
  }, [status, visibleFields, draftPolygon]);

  useEffect(() => {
    const activeMap = mapInstanceRef.current;
    if (!activeMap || status !== 'ready') return;
    const map = activeMap;
    const canvas = map.getCanvas();
    const canvasElement = map.getCanvasContainer();

    function getLngLatFromPointerEvent(event: PointerEvent) {
      const bounds = canvasElement.getBoundingClientRect();
      const point = [event.clientX - bounds.left, event.clientY - bounds.top] as [number, number];
      return map.unproject(point);
    }

    function updateCursorFromPointerEvent(event: PointerEvent) {
      const draftPivotHandle = draftPivotHandleRef.current;
      if (!draftPivotHandle) {
        canvas.style.cursor = '';
        return;
      }

      const bounds = canvasElement.getBoundingClientRect();
      const handlePoint = map.project(draftPivotHandle);
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const distance = Math.hypot(handlePoint.x - pointerX, handlePoint.y - pointerY);
      canvas.style.cursor = distance <= TOUCH_HIT_RADIUS_PX ? 'grab' : '';
    }

    function handleMapClick(event: mapboxgl.MapMouseEvent) {
      if (!isAddingField) {
        if (!isEditingField && onEditField) {
          const features = map.queryRenderedFeatures(event.point, {
            layers: ['saved-fields-fill', 'saved-fields-line'],
          });
          const clickedFieldId = features[0]?.properties?.id;
          if (typeof clickedFieldId === 'string') {
            onEditField(clickedFieldId);
          }
        }
        return;
      }

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
          if (clickDistance <= TOUCH_HIT_RADIUS_PX) {
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
        const center: Coordinate = [event.lngLat.lng, event.lngLat.lat];
        const defaultRadius = computeDefaultPivotRadius(map, event.point);
        setCircleCenter(center);
        setCircleRadiusMeters(defaultRadius);
        setCircleRadiusLocked(true);
        setPivotAngleDraft(0);
        setFieldMessage('Drag the orange handle to size the pivot and set the angle, then confirm.');
        return;
      }
    }

    function handleMouseMove(event: mapboxgl.MapMouseEvent) {
      const activePivotCenter = activePivotCenterRef.current;
      if (pivotDragActiveRef.current && activePivotCenter) {
        canvas.style.cursor = 'grabbing';
        updatePivotHandleFromLngLat(activePivotCenter, event.lngLat);
        return;
      }

      const isAddingField = isAddingFieldRef.current;
      if (!isAddingField && !isEditingField) {
        const features = map.queryRenderedFeatures(event.point, {
          layers: ['saved-fields-fill', 'saved-fields-line'],
        });
        canvas.style.cursor = features.length > 0 ? 'pointer' : '';
      }
    }

    function stopPivotDrag() {
      if (!pivotDragActiveRef.current) return;

      pivotDragActiveRef.current = false;
      const activePointerId = pivotPointerIdRef.current;
      pivotPointerIdRef.current = null;
      if (!map.dragPan.isEnabled()) {
        map.dragPan.enable();
      }
      if (activePointerId !== null && canvasElement.hasPointerCapture(activePointerId)) {
        try {
          canvasElement.releasePointerCapture(activePointerId);
        } catch {}
      }
      canvas.style.cursor = '';
      setFieldMessage(
        isEditingFieldRef.current
          ? 'Pivot position set. Save changes when ready.'
          : 'Pivot position set. Confirm the boundary to save the field.',
      );
    }

    function handlePointerDown(event: PointerEvent) {
      const activePivotCenter = activePivotCenterRef.current;
      const draftPivotHandle = draftPivotHandleRef.current;
      if (!activePivotCenter || !draftPivotHandle) {
        return;
      }

      const isAddingField = isAddingFieldRef.current;
      const circleCenter = circleCenterRef.current;
      const circleRadiusLocked = circleRadiusLockedRef.current;
      const drawMode = drawModeRef.current;
      if (isAddingField && (!circleCenter || !circleRadiusLocked || drawMode !== 'circle')) {
        return;
      }

      const bounds = canvasElement.getBoundingClientRect();
      const handlePoint = map.project(draftPivotHandle);
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const distance = Math.hypot(handlePoint.x - pointerX, handlePoint.y - pointerY);

      if (distance > TOUCH_HIT_RADIUS_PX) {
        return;
      }

      event.preventDefault();
      pivotDragActiveRef.current = true;
      pivotPointerIdRef.current = event.pointerId;
      canvas.style.cursor = 'grabbing';
      map.dragPan.disable();
      canvasElement.setPointerCapture(event.pointerId);
      const lngLat = getLngLatFromPointerEvent(event);
      updatePivotHandleFromLngLat(activePivotCenter, lngLat);
      setFieldMessage('Dragging pivot arm. Release to keep the current position.');
    }

    function handlePointerMove(event: PointerEvent) {
      const activePivotCenter = activePivotCenterRef.current;
      if (!activePivotCenter) {
        return;
      }

      if (pivotDragActiveRef.current) {
        event.preventDefault();
        canvas.style.cursor = 'grabbing';
        const lngLat = getLngLatFromPointerEvent(event);
        updatePivotHandleFromLngLat(activePivotCenter, lngLat);
        return;
      }

      updateCursorFromPointerEvent(event);
    }

    function handlePointerUp() {
      stopPivotDrag();
    }

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);
    canvasElement.addEventListener('pointerdown', handlePointerDown);
    canvasElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      stopPivotDrag();
      canvas.style.cursor = '';
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
      canvasElement.removeEventListener('pointerdown', handlePointerDown);
      canvasElement.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    status,
    isAddingField,
    isEditingField,
    fieldNameDraft,
    drawMode,
    freePoints,
    freePolygonComplete,
    circleCenter,
    circleRadiusLocked,
    onEditField,
  ]);

  return (
    <section className="map-panel">
      {mode === 'overview' ? (
        <header className="field-panel-header">
          <h2 className="field-panel-title">Field boundaries</h2>
        </header>
      ) : null}

      {mode !== 'overview' ? (
        <FieldNameInput
          fieldNameDraft={fieldNameDraft}
          onFieldNameChange={setFieldNameDraft}
        />
      ) : null}

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

      {fieldsLoading ? (
        <div className="map-state-card">
          <h3>Loading fields</h3>
          <p>Fetching saved boundaries for this farmer.</p>
        </div>
      ) : null}

      {!fieldsLoading && isEditingField && !selectedField ? (
        <div className="map-state-card">
          <h3>Field not found</h3>
          <p>The requested field could not be found for this farmer.</p>
        </div>
      ) : null}

      {MAPBOX_ACCESS_TOKEN ? (
        <div className="map-shell">
          {!(status === 'ready' && mode === 'overview') ? (
            <div className="map-status-row">
              <span className={`status-pill status-${status}`}>
                {status === 'loading' && 'Loading map'}
                {status === 'ready' && 'Map ready'}
                {status === 'error' && 'Map error'}
              </span>
              <span className="map-meta" aria-live="polite">
                {status === 'loading' && 'Connecting to Mapbox...'}
                {status === 'ready' &&
                  (isEditingField
                    ? 'Adjust the field details and save when ready.'
                    : 'Draw the field boundary and confirm it.')}
                {status === 'error' && errorMessage}
              </span>
            </div>
          ) : null}
          <div className={isAddingField ? 'map-stage is-drawing' : 'map-stage'}>
            <div
              id={mapId}
              ref={mapRef}
              className={mode === 'overview' ? 'map-canvas map-canvas-overview' : 'map-canvas'}
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

      {mode === 'overview' ? (
        <div className="field-action-bar">
          <button type="button" className="btn btn-primary field-add-btn" onClick={onAddField}>
            <span className="field-add-btn-glyph" aria-hidden="true">+</span>
            Add a field
          </button>
        </div>
      ) : null}

      {!fieldsLoading && mode === 'overview' && fields.length === 0 ? (
        <div className="map-state-card">
          <h3>No fields yet</h3>
          <p>This farmer has not created any fields yet. Use the add field button to start.</p>
        </div>
      ) : null}

      {!fieldsLoading && mode === 'overview' && fields.length > 0 ? (
        <div className="map-state-card">
          <h3>{fields.length === 1 ? '1 field saved' : `${fields.length} fields saved`}</h3>
          <p>
            {fields.length === 1
              ? `Click the map or edit ${fields[0].fieldName} below.`
              : 'Click any field on the map or use the edit buttons below.'}
          </p>
          <div className="field-summary-list">
            {fields.map((field) => (
              <article key={field.id} className="field-summary-card">
                <div className="field-summary-header">
                  <strong>{field.fieldName}</strong>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onEditField?.(field.id)}
                  >
                    Edit field
                  </button>
                </div>
                <p className="field-summary-meta">
                  {field.fieldType === 'pivot'
                    ? `Pivot angle: ${formatPivotAngleDegrees(field.pivotAngleDegrees) ?? 'Not set'}`
                    : 'No pivot position tracked for normal fields.'}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {mode !== 'overview' ? (
        <FieldEditorCard
          mode={isEditingField ? 'edit' : 'create'}
          fieldType={draftFieldType}
          pivotAngleDraft={draftFieldType === 'pivot' ? pivotAngleDraft : null}
          savingField={savingField}
          deletingField={deletingField}
          disablePrimaryAction={savingField || !fieldNameDraft.trim() || (isAddingField && !draftPolygon)}
          onPrimaryAction={() =>
            void (isEditingField ? handleSaveFieldChanges() : handleConfirmBoundary())
          }
          onCancel={() => onCancelFieldScreen?.()}
          onResetDraft={isAddingField ? () => resetDraftState(drawMode) : undefined}
          onDelete={isEditingField ? () => void handleDeleteField() : undefined}
        />
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

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeClockwiseMovement(startAngle: number, endAngle: number) {
  const start = normalizeAngleDegrees(startAngle);
  const end = normalizeAngleDegrees(endAngle);
  return (end - start + 360) % 360;
}

const PIVOT_DIAL_SIZE = 220;
const PIVOT_DIAL_RADIUS = 92;

function PivotDial({
  startAngle,
  endAngle,
  onChange,
}: {
  startAngle: number;
  endAngle: number;
  onChange: (nextAngle: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const center = PIVOT_DIAL_SIZE / 2;
  const start = normalizeAngleDegrees(startAngle);
  const end = normalizeAngleDegrees(endAngle);

  function angleToPoint(angle: number) {
    const radians = (normalizeAngleDegrees(angle) * Math.PI) / 180;
    return {
      x: center + Math.sin(radians) * PIVOT_DIAL_RADIUS,
      y: center - Math.cos(radians) * PIVOT_DIAL_RADIUS,
    };
  }

  function pointerToAngle(event: PointerEvent | React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return end;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - center;
    const y = event.clientY - rect.top - center;
    const radians = Math.atan2(x, -y);
    return normalizeAngleDegrees((radians * 180) / Math.PI);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.preventDefault();
    draggingRef.current = true;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onChange(pointerToAngle(event));
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    event.preventDefault();
    onChange(pointerToAngle(event));
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
    } catch {}
  }

  const startPoint = angleToPoint(start);
  const endPoint = angleToPoint(end);

  return (
    <svg
      ref={svgRef}
      className="pivot-dial"
      width={PIVOT_DIAL_SIZE}
      height={PIVOT_DIAL_SIZE}
      viewBox={`0 0 ${PIVOT_DIAL_SIZE} ${PIVOT_DIAL_SIZE}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label="New pivot angle"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={end}
    >
      <circle
        cx={center}
        cy={center}
        r={PIVOT_DIAL_RADIUS}
        fill="rgba(47, 125, 59, 0.08)"
        stroke="#cfd9d2"
        strokeWidth={1.5}
      />
      <line
        x1={center}
        y1={center}
        x2={startPoint.x}
        y2={startPoint.y}
        stroke="#8aa394"
        strokeWidth={2}
        strokeDasharray="4 4"
      />
      <circle cx={startPoint.x} cy={startPoint.y} r={5} fill="#8aa394" />
      <line
        x1={center}
        y1={center}
        x2={endPoint.x}
        y2={endPoint.y}
        stroke="#14532d"
        strokeWidth={3}
      />
      <circle
        cx={endPoint.x}
        cy={endPoint.y}
        r={10}
        fill="#f59e0b"
        stroke="#ffffff"
        strokeWidth={2}
      />
      <circle cx={center} cy={center} r={4} fill="#14532d" />
    </svg>
  );
}

function ActionsPanel({ currentFarmerId }: { currentFarmerId: string }) {
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [endDate, setEndDate] = useState<string>(() => todayDateString());
  const [newAngle, setNewAngle] = useState<number>(0);
  const [movementOverride, setMovementOverride] = useState<string>('');
  const [mmAppliedRaw, setMmAppliedRaw] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const pivotFields = fields.filter((field) => field.fieldType === 'pivot');
  const selectedField = pivotFields.find((field) => field.id === selectedFieldId) ?? null;
  const startAngle = selectedField?.pivotAngleDegrees ?? 0;
  const draggedMovement = computeClockwiseMovement(startAngle, newAngle);
  const movementDegrees = movementOverride.trim() === ''
    ? draggedMovement
    : Math.max(0, Math.min(360, Math.round(Number(movementOverride) || 0)));
  const movementPct = movementDegrees / 360;
  const mmAppliedNumber = Number(mmAppliedRaw);
  const mmAppliedValid = mmAppliedRaw.trim() !== '' && Number.isFinite(mmAppliedNumber) && mmAppliedNumber >= 0;
  const effectiveMm = mmAppliedValid ? mmAppliedNumber * movementPct : 0;

  async function loadPivotFields() {
    if (!currentFarmerId) return;
    setLoadingFields(true);
    setLoadError(null);
    const result = await fetchFieldsForFarmer(currentFarmerId);
    setFields(result.data);
    if (result.error) {
      setLoadError(result.error);
    }
    setLoadingFields(false);
  }

  useEffect(() => {
    void loadPivotFields();
  }, [currentFarmerId]);

  useEffect(() => {
    if (selectedField) {
      setNewAngle(selectedField.pivotAngleDegrees ?? 0);
      setMovementOverride('');
    }
  }, [selectedFieldId, selectedField?.pivotAngleDegrees]);

  async function handleSave() {
    if (!supabase) {
      setSaveError('Supabase is not configured.');
      return;
    }
    if (!currentFarmerId) {
      setSaveError('Choose a farmer first.');
      return;
    }
    if (!selectedField) {
      setSaveError('Pick a pivot field.');
      return;
    }
    if (!endDate) {
      setSaveError('Set the end date.');
      return;
    }
    if (!mmAppliedValid) {
      setSaveError('Enter the millimetres applied at the pivot.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    const { error } = await supabase.rpc('log_action', {
      input_farmer_id: currentFarmerId,
      input_field_id: selectedField.id,
      input_end_date: endDate,
      input_movement_degrees: movementDegrees,
      input_mm_applied_at_pivot: mmAppliedNumber,
      input_new_pivot_angle_degrees: normalizeAngleDegrees(newAngle),
    });

    setSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    setSaveMessage(
      `Logged ${effectiveMm.toFixed(2)} mm across ${selectedField.fieldName}.`,
    );
    setMmAppliedRaw('');
    setMovementOverride('');
    await loadPivotFields();
  }

  if (!loadingFields && pivotFields.length === 0) {
    return (
      <section className="actions-panel" aria-labelledby="actions-title">
        <h2 id="actions-title">Log a pivot action</h2>
        <div className="map-state-card">
          <h3>No pivot fields</h3>
          <p>
            Add a pivot field on the Fields tab first, then come back to log an
            irrigation action against it.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="actions-panel" aria-labelledby="actions-title">
      <header className="actions-header">
        <h2 id="actions-title">Log a pivot action</h2>
        <p>
          Pick a pivot, drag it to where it stopped, and enter the millimetres
          the pivot put down at full output.
        </p>
      </header>

      {loadingFields ? (
        <div className="map-state-card">
          <h3>Loading fields</h3>
          <p>Fetching pivot fields for this farmer.</p>
        </div>
      ) : null}

      {loadError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {loadError}
        </p>
      ) : null}

      {!loadingFields ? (
        <div className="actions-form">
          <label className="auth-label" htmlFor="actions-field">
            Pivot field
          </label>
          <select
            id="actions-field"
            className="auth-input"
            value={selectedFieldId}
            onChange={(event) => setSelectedFieldId(event.target.value)}
          >
            <option value="">Select a pivot...</option>
            {pivotFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.fieldName} ({formatPivotAngleDegrees(field.pivotAngleDegrees) ?? 'no angle'})
              </option>
            ))}
          </select>

          <label className="auth-label" htmlFor="actions-end-date">
            Action date
          </label>
          <input
            id="actions-end-date"
            className="auth-input"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />

          {selectedField ? (
            <>
              <div className="pivot-dial-wrap">
                <PivotDial
                  startAngle={startAngle}
                  endAngle={newAngle}
                  onChange={setNewAngle}
                />
                <dl className="pivot-dial-readout">
                  <div>
                    <dt>Start</dt>
                    <dd>{normalizeAngleDegrees(startAngle)}°</dd>
                  </div>
                  <div>
                    <dt>End</dt>
                    <dd>{normalizeAngleDegrees(newAngle)}°</dd>
                  </div>
                  <div>
                    <dt>Movement</dt>
                    <dd>{movementDegrees}° ({(movementPct * 100).toFixed(1)}%)</dd>
                  </div>
                </dl>
              </div>

              <div className="actions-quick-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setMovementOverride('360');
                    setNewAngle(normalizeAngleDegrees(startAngle));
                  }}
                >
                  Full sweep (360°)
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setMovementOverride('');
                    setNewAngle(normalizeAngleDegrees(startAngle));
                  }}
                >
                  Reset to start
                </button>
              </div>

              <label className="auth-label" htmlFor="actions-movement-override">
                Movement (degrees) — override
              </label>
              <input
                id="actions-movement-override"
                className="auth-input"
                type="number"
                min={0}
                max={360}
                step={1}
                placeholder={`${draggedMovement}`}
                value={movementOverride}
                onChange={(event) => setMovementOverride(event.target.value)}
              />

              <label className="auth-label" htmlFor="actions-mm">
                Millimetres at pivot
              </label>
              <input
                id="actions-mm"
                className="auth-input"
                type="number"
                min={0}
                step="0.1"
                placeholder="e.g. 20"
                value={mmAppliedRaw}
                onChange={(event) => setMmAppliedRaw(event.target.value)}
              />

              <div className="actions-effective-readout">
                <span>Spread across field:</span>
                <strong>{mmAppliedValid ? `${effectiveMm.toFixed(2)} mm` : '—'}</strong>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving || !mmAppliedValid}
              >
                {saving ? 'Saving action...' : 'Log action'}
              </button>
            </>
          ) : null}

          {saveMessage ? (
            <p className="auth-feedback auth-feedback-success" aria-live="polite">
              {saveMessage}
            </p>
          ) : null}

          {saveError ? (
            <p className="auth-feedback auth-feedback-error" aria-live="polite">
              {saveError}
            </p>
          ) : null}
        </div>
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

  function handleOpenEditFieldScreen(fieldId: string) {
    setAccountMenuOpen(false);
    setFieldFlowMessage(null);
    navigateTo({ tabId: 'fields', screen: 'edit-field', fieldId });
  }

  function handleCloseFieldScreen() {
    setAccountMenuOpen(false);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldCreated(fieldName: string) {
    setFieldFlowMessage(`Saved ${fieldName}.`);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldUpdated(fieldName: string) {
    setFieldFlowMessage(`Updated ${fieldName}.`);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldDeleted(fieldName: string) {
    setFieldFlowMessage(`Deleted ${fieldName}.`);
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
        </div>
      </header>

      <main className="app-shell">
        <div className="container">
          {activeScreen === 'workspace' ? (
            <section
              className={
                activeTab === 'fields' ? 'workspace-card' : 'content-card workspace-card'
              }
            >
              {activeTab === 'fields' ? (
                <>
                  <FieldMapPanel
                    key="fields-overview"
                    currentFarmerId={currentFarmerId}
                    mode="overview"
                    onAddField={handleOpenAddFieldScreen}
                    onEditField={handleOpenEditFieldScreen}
                  />
                  {fieldFlowMessage ? (
                    <p className="auth-feedback auth-feedback-success" aria-live="polite">
                      {fieldFlowMessage}
                    </p>
                  ) : null}
                </>
              ) : activeTab === 'actions' ? (
                <ActionsPanel currentFarmerId={currentFarmerId} />
              ) : (
                <PlaceholderPanel tab={tabs.find(({ id }) => id === activeTab) ?? tabs[0]} />
              )}
            </section>
          ) : (
            <section className="content-card route-card" aria-labelledby="field-route-title">
              <header className="content-header route-header">
                <div>
                  <p className="eyebrow">Field setup</p>
                  <h2 id="field-route-title">
                    {activeScreen === 'edit-field' ? 'Edit field' : 'Add field'}
                  </h2>
                  <p className="route-copy">
                    {activeScreen === 'edit-field'
                      ? `Update the saved field for ${currentFarmerName || 'this farmer'}.`
                      : `Draw and save a field for ${currentFarmerName || 'this farmer'} on a separate screen.`}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={handleCloseFieldScreen}>
                  Back to fields
                </button>
              </header>

              <FieldMapPanel
                key={activeScreen === 'edit-field' ? `field-edit-${route.fieldId}` : 'field-create'}
                currentFarmerId={currentFarmerId}
                mode={activeScreen === 'edit-field' ? 'edit' : 'create'}
                editedFieldId={route.fieldId ?? undefined}
                onCancelFieldScreen={handleCloseFieldScreen}
                onFieldSaved={activeScreen === 'edit-field' ? handleFieldUpdated : handleFieldCreated}
                onFieldDeleted={handleFieldDeleted}
              />
            </section>
          )}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Main tabs">
        {tabs.map((tab) => {
          const isActive = activeScreen === 'workspace' && tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              className={isActive ? 'bottom-tab is-active' : 'bottom-tab'}
              onClick={() => navigateTo({ tabId: tab.id, screen: 'workspace' })}
              aria-pressed={isActive}
            >
              <span className="bottom-tab-icon-wrap">
                <TabIcon tabId={tab.id} />
              </span>
              <span className="bottom-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
