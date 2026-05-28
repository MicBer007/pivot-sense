import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
type PivotSweepDirection = 1 | -1;
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
type WaterPerDayRow = {
  day: string;
  fieldId: string;
  fieldName: string;
  totalMm: number;
};
type ActionRecord = {
  id: string;
  fieldId: string;
  fieldName: string;
  endDate: string;
  movementDegrees: number;
  mmAppliedAtPivot: number;
  startPivotAngleDegrees: number;
  sweepDirection: PivotSweepDirection;
  createdAt: string;
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
const ACTION_FIELDS_SOURCE_ID = 'action-fields';
const ACTION_SELECTED_FIELD_SOURCE_ID = 'action-selected-field';
const ACTION_SWEEP_SOURCE_ID = 'action-sweep';
const ACTION_START_PIVOT_SOURCE_ID = 'action-start-pivot';
const ACTION_END_PIVOT_SOURCE_ID = 'action-end-pivot';
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

async function fetchWaterPerDayForFarmer(currentFarmerId: string, days = 7) {
  if (!supabase || !currentFarmerId) {
    return {
      data: [] as WaterPerDayRow[],
      error: null as string | null,
    };
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('actions')
    .select('end_date, mm_applied_at_pivot, field_id, fields!inner(id, field_name, farmer_id)')
    .eq('fields.farmer_id', currentFarmerId)
    .gte('end_date', cutoffIso);

  if (error) {
    return {
      data: [] as WaterPerDayRow[],
      error: error.message,
    };
  }

  type ActionRow = {
    end_date: string;
    mm_applied_at_pivot: number | string | null;
    field_id: string;
    fields: { id: string; field_name: string; farmer_id: string } | null;
  };

  return {
    data: ((data ?? []) as unknown as ActionRow[]).map((row) => ({
      day: row.end_date,
      fieldId: row.field_id,
      fieldName: row.fields?.field_name ?? 'Unknown field',
      totalMm: Number(row.mm_applied_at_pivot ?? 0),
    })),
    error: null as string | null,
  };
}

async function fetchActionsForFarmer(currentFarmerId: string) {
  if (!supabase || !currentFarmerId) {
    return {
      data: [] as ActionRecord[],
      error: null as string | null,
    };
  }

  const { data, error } = await supabase
    .from('actions')
    .select(
      'id, end_date, movement_degrees, mm_applied_at_pivot, start_pivot_angle_degrees, sweep_direction, created_at, field_id, fields!inner(id, field_name, farmer_id)',
    )
    .eq('fields.farmer_id', currentFarmerId)
    .order('end_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    return {
      data: [] as ActionRecord[],
      error: error.message,
    };
  }

  type ActionRow = {
    id: string;
    end_date: string;
    movement_degrees: number | string | null;
    mm_applied_at_pivot: number | string | null;
    start_pivot_angle_degrees: number | string | null;
    sweep_direction: number | string | null;
    created_at: string;
    field_id: string;
    fields: { id: string; field_name: string; farmer_id: string } | null;
  };

  return {
    data: ((data ?? []) as unknown as ActionRow[]).map((row) => ({
      id: row.id,
      fieldId: row.field_id,
      fieldName: row.fields?.field_name ?? 'Unknown field',
      endDate: row.end_date,
      movementDegrees: Number(row.movement_degrees ?? 0),
      mmAppliedAtPivot: Number(row.mm_applied_at_pivot ?? 0),
      startPivotAngleDegrees: normalizeAngleDegrees(Number(row.start_pivot_angle_degrees ?? 0)),
      sweepDirection: Number(row.sweep_direction ?? 1) < 0 ? -1 : 1,
      createdAt: row.created_at,
    })) satisfies ActionRecord[],
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

function isSilentMapboxResourceError(event: mapboxgl.ErrorEvent) {
  const error = event.error as Error & { status?: number; statusCode?: number };
  const statusCode = error.status ?? error.statusCode;
  return statusCode === 403 || error.message.includes('403');
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

function getPolygonsBounds(polygons: PolygonGeometry[]) {
  const bounds = polygons.reduce((currentBounds, polygon) => {
    const nextBounds = getPolygonBounds(polygon);
    nextBounds.toArray().forEach((point) => currentBounds.extend(point));
    return currentBounds;
  }, new mapboxgl.LngLatBounds());

  return bounds.isEmpty() ? null : bounds;
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

function buildFieldSelectionGeoJson(fields: FieldRecord[]): FeatureCollection {
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

function buildPivotSweepGeoJson(
  center: Coordinate | null,
  radiusMeters: number | null,
  startAngle: number,
  movementDegrees: number,
  direction: PivotSweepDirection = 1,
): FeatureCollection {
  if (!center || !radiusMeters || radiusMeters <= 0 || movementDegrees <= 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  const normalizedMovement = Math.min(360, Math.max(0, movementDegrees));
  const steps = Math.max(8, Math.ceil(normalizedMovement / 6));
  const ring: Coordinate[] = [center];

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (direction * normalizedMovement * index) / steps;
    ring.push(getCircleCoordinate(center, radiusMeters, angle));
  }

  ring.push(center);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
        properties: {},
      },
    ],
  };
}

function ensureGeoJsonSource(map: mapboxgl.Map, id: string, data: FeatureCollection) {
  if (map.getSource(id)) return;

  map.addSource(id, {
    type: 'geojson',
    data: data as never,
  });
}

function setGeoJsonSourceData(map: mapboxgl.Map, id: string, data: FeatureCollection) {
  const existingSource = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
  existingSource?.setData(data as never);
}

function emptyFeatureCollection(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
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

function ensureFieldMapSourcesAndLayers(map: mapboxgl.Map) {
  ensureGeoJsonSource(map, SAVED_FIELDS_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, SAVED_PIVOT_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, DRAFT_BOUNDARY_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, DRAFT_POINTS_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, DRAFT_PIVOT_SOURCE_ID, emptyFeatureCollection());
  ensureMapLayers(map);
}

function ensureActionMapLayers(map: mapboxgl.Map) {
  if (!map.getLayer('action-fields-fill')) {
    map.addLayer({
      id: 'action-fields-fill',
      type: 'fill',
      source: ACTION_FIELDS_SOURCE_ID,
      paint: {
        'fill-color': '#2f7d3b',
        'fill-opacity': 0.08,
      },
    });
  }

  if (!map.getLayer('action-fields-line')) {
    map.addLayer({
      id: 'action-fields-line',
      type: 'line',
      source: ACTION_FIELDS_SOURCE_ID,
      paint: {
        'line-color': '#1f5d2b',
        'line-width': 2,
      },
    });
  }

  if (!map.getLayer('action-fields-label')) {
    map.addLayer({
      id: 'action-fields-label',
      type: 'symbol',
      source: ACTION_FIELDS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'fieldName'],
        'text-size': 13,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });
  }

  if (!map.getLayer('action-selected-field-fill')) {
    map.addLayer({
      id: 'action-selected-field-fill',
      type: 'fill',
      source: ACTION_SELECTED_FIELD_SOURCE_ID,
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': 0.1,
      },
    });
  }

  if (!map.getLayer('action-selected-field-line')) {
    map.addLayer({
      id: 'action-selected-field-line',
      type: 'line',
      source: ACTION_SELECTED_FIELD_SOURCE_ID,
      paint: {
        'line-color': '#f59e0b',
        'line-width': 3,
      },
    });
  }

  if (!map.getLayer('action-sweep-fill')) {
    map.addLayer({
      id: 'action-sweep-fill',
      type: 'fill',
      source: ACTION_SWEEP_SOURCE_ID,
      paint: {
        'fill-color': '#2563eb',
        'fill-opacity': 0.28,
      },
    });
  }

  if (!map.getLayer('action-start-pivot-arm')) {
    map.addLayer({
      id: 'action-start-pivot-arm',
      type: 'line',
      source: ACTION_START_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'arm'],
      paint: {
        'line-color': '#64748b',
        'line-width': 2.5,
        'line-dasharray': [1.5, 1.5],
      },
    });
  }

  if (!map.getLayer('action-start-pivot-handle')) {
    map.addLayer({
      id: 'action-start-pivot-handle',
      type: 'circle',
      source: ACTION_START_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'handle'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#64748b',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }

  if (!map.getLayer('action-end-pivot-arm')) {
    map.addLayer({
      id: 'action-end-pivot-arm',
      type: 'line',
      source: ACTION_END_PIVOT_SOURCE_ID,
      filter: ['==', ['get', 'overlayRole'], 'arm'],
      paint: {
        'line-color': '#14532d',
        'line-width': 3,
      },
    });
  }

  if (!map.getLayer('action-end-pivot-handle')) {
    map.addLayer({
      id: 'action-end-pivot-handle',
      type: 'circle',
      source: ACTION_END_PIVOT_SOURCE_ID,
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

function ensureActionMapSourcesAndLayers(map: mapboxgl.Map) {
  ensureGeoJsonSource(map, ACTION_FIELDS_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, ACTION_SELECTED_FIELD_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, ACTION_SWEEP_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, ACTION_START_PIVOT_SOURCE_ID, emptyFeatureCollection());
  ensureGeoJsonSource(map, ACTION_END_PIVOT_SOURCE_ID, emptyFeatureCollection());
  ensureActionMapLayers(map);
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
    <>
      {fieldType === 'pivot' ? (
        <div className="field-creation-card">
          <div className="field-creation-grid">
            <p className="pivot-angle-readout">
              Current pivot angle:{' '}
              <strong className="pivot-angle-value">
                {formatPivotAngleDegrees(pivotAngleDraft)}
              </strong>
            </p>
          </div>
        </div>
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
    </>
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
  const selectedFieldRef = useRef<FieldRecord | null>(null);
  const firstCameraSyncRef = useRef(true);
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
    if (onFieldSaved) {
      onFieldSaved(savedFieldName);
      return;
    }
    await loadFields();
  }

  async function handleSaveFieldChanges() {
    const fieldToSave =
      selectedField ??
      (selectedFieldRef.current?.id === editedFieldId ? selectedFieldRef.current : null);

    if (!supabase) {
      setFieldError('Supabase is not configured.');
      return;
    }

    if (!currentFarmerId) {
      setFieldError('Choose a farmer before saving the field.');
      return;
    }

    if (!fieldToSave) {
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
      input_field_id: fieldToSave.id,
      input_field_name: fieldNameDraft.trim(),
      input_pivot_angle_degrees: fieldToSave.fieldType === 'pivot' ? pivotAngleDraft : null,
    });

    setSavingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    const savedFieldName = fieldNameDraft.trim();
    setFieldMessage(`Updated ${savedFieldName}.`);
    if (onFieldSaved) {
      onFieldSaved(savedFieldName);
      return;
    }
    await loadFields();
  }

  async function handleDeleteField() {
    const fieldToDelete =
      selectedField ??
      (selectedFieldRef.current?.id === editedFieldId ? selectedFieldRef.current : null);

    if (!supabase) {
      setFieldError('Supabase is not configured.');
      return;
    }

    if (!fieldToDelete) {
      setFieldError('Field not found.');
      return;
    }

    if (typeof window !== 'undefined' && !window.confirm(`Delete ${fieldToDelete.fieldName}?`)) {
      return;
    }

    setDeletingField(true);
    setFieldError(null);
    setFieldMessage(null);

    const { error } = await supabase.rpc('delete_field', {
      input_farmer_id: currentFarmerId,
      input_field_id: fieldToDelete.id,
    });

    setDeletingField(false);

    if (error) {
      setFieldError(error.message);
      return;
    }

    onFieldDeleted?.(fieldToDelete.fieldName);
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
    selectedFieldRef.current = selectedField;
    setFieldNameDraft(selectedField.fieldName);
    setPivotAngleDraft(selectedField.pivotAngleDegrees ?? 0);
  }, [isEditingField, selectedField]);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN || !mapRef.current || fieldsLoading || mapInstanceRef.current) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    let cancelled = false;
    firstCameraSyncRef.current = true;
    setStatus('loading');
    const initialBounds = getPolygonsBounds(visibleFields.map((field) => field.boundary));

    try {
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: MAPBOX_STYLE_URL,
        ...(initialBounds
          ? {
              bounds: initialBounds,
              fitBoundsOptions: {
                padding: 72,
                maxZoom: 15,
                duration: 0,
              },
            }
          : {
              center: DEFAULT_CENTER,
              zoom: DEFAULT_ZOOM,
            }),
        attributionControl: true,
        clickTolerance: 10,
      });

      mapInstanceRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.on('load', () => {
        if (cancelled) return;
        ensureFieldMapSourcesAndLayers(map);
        setStatus('ready');
        setErrorMessage(null);
      });

      map.on('error', (event) => {
        if (cancelled) return;
        if (isSilentMapboxResourceError(event)) return;
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
  }, [fieldsLoading]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || status !== 'ready') return;

    setGeoJsonSourceData(map, SAVED_FIELDS_SOURCE_ID, buildSavedFieldsGeoJson(visibleFields));
    setGeoJsonSourceData(map, SAVED_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(savedPivotEntries));
    setGeoJsonSourceData(map, DRAFT_BOUNDARY_SOURCE_ID, buildDraftBoundaryGeoJson(draftPolygon));
    setGeoJsonSourceData(
      map,
      DRAFT_POINTS_SOURCE_ID,
      buildDraftPointsGeoJson(drawMode, freePoints, circleCenter, circlePreviewEdge),
    );
    setGeoJsonSourceData(map, DRAFT_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(draftPivotEntries));
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
        duration: firstCameraSyncRef.current ? 0 : 900,
      });
      firstCameraSyncRef.current = false;
      return;
    }

    const bounds = getPolygonsBounds(
      draftPolygon ? [draftPolygon] : visibleFields.map((field) => field.boundary),
    );

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 72,
        maxZoom: 15,
        duration: firstCameraSyncRef.current ? 0 : 900,
      });
      firstCameraSyncRef.current = false;
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

      {mode !== 'overview' && fieldMessage ? (
        <p className="auth-feedback auth-feedback-success" aria-live="polite">
          {fieldMessage}
        </p>
      ) : null}

      {mode !== 'overview' && fieldError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {fieldError}
        </p>
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
          {status === 'error' ? (
            <div className="map-status-row">
              <span className="map-meta" aria-live="polite">
                {errorMessage}
              </span>
            </div>
          ) : null}
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
          <div className={isAddingField ? 'map-stage is-drawing' : 'map-stage'}>
            <div
              id={mapId}
              ref={mapRef}
              className={mode === 'overview' ? 'map-canvas map-canvas-overview' : 'map-canvas'}
              data-testid="mapbox-canvas"
            />
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
          <h3>Your fields</h3>
          <div className="field-summary-list">
            {fields.map((field) => (
              <article key={field.id} className="field-summary-card">
                <div className="field-summary-header">
                  <strong>{field.fieldName}</strong>
                  <button
                    type="button"
                    className="btn btn-edit-field"
                    onClick={() => onEditField?.(field.id)}
                  >
                    Edit field
                  </button>
                </div>
                <p className="field-summary-meta">
                  {field.fieldType === 'pivot' ? (
                    <>
                      Pivot angle:{' '}
                      <em className="field-summary-angle">
                        {formatPivotAngleDegrees(field.pivotAngleDegrees) ?? 'Not set'}
                      </em>
                    </>
                  ) : (
                    'No pivot position tracked for normal fields.'
                  )}
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

      {mode === 'overview' && fieldMessage ? (
        <p className="auth-feedback auth-feedback-success" aria-live="polite">
          {fieldMessage}
        </p>
      ) : null}

      {mode === 'overview' && fieldError ? (
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

function computeEffectiveMm(mmAppliedAtPivot: number, movementDegrees: number) {
  return mmAppliedAtPivot * (movementDegrees / 360);
}

function formatActionDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const PIVOT_DRAG_JITTER_DEGREES = 2;
const PIVOT_DIRECTION_SWITCH_DEGREES = 12;

function computeSignedAngleDelta(fromAngle: number, toAngle: number) {
  const from = normalizeAngleDegrees(fromAngle);
  const to = normalizeAngleDegrees(toAngle);
  return ((to - from + 540) % 360) - 180;
}

function computeDirectionalMovement(
  startAngle: number,
  endAngle: number,
  direction: PivotSweepDirection,
) {
  const start = normalizeAngleDegrees(startAngle);
  const end = normalizeAngleDegrees(endAngle);
  return direction === 1 ? (end - start + 360) % 360 : (start - end + 360) % 360;
}

function computeAngleDistance(angleA: number, angleB: number) {
  return Math.abs(computeSignedAngleDelta(angleA, angleB));
}

function ActionLogView({
  currentFarmerId,
  onBack,
  onLogged,
}: {
  currentFarmerId: string;
  onBack: () => void;
  onLogged: () => void;
}) {
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const firstCameraSyncRef = useRef(true);
  const lastCameraFitKeyRef = useRef<string | null>(null);
  const pivotDragActiveRef = useRef(false);
  const pivotPointerIdRef = useRef<number | null>(null);
  const selectedCircleRef = useRef<{ center: Coordinate; radiusMeters: number } | null>(null);
  const endPivotHandleRef = useRef<Coordinate | null>(null);
  const lastDragAngleRef = useRef<number | null>(null);
  const startAngleRef = useRef(0);
  const dragSweepDirectionRef = useRef<PivotSweepDirection>(1);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    MAPBOX_ACCESS_TOKEN ? 'loading' : 'idle',
  );
  const [, setMapErrorMessage] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>(() => todayDateString());
  const [newAngle, setNewAngle] = useState<number>(0);
  const [dragSweepDirection, setDragSweepDirection] = useState<PivotSweepDirection>(1);
  const [mmAppliedRaw, setMmAppliedRaw] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [step, setStep] = useState<'select' | 'details'>('select');

  const pivotFields = fields.filter((field) => field.fieldType === 'pivot');
  const selectedField = pivotFields.find((field) => field.id === selectedFieldId) ?? null;
  const startAngle = selectedField?.pivotAngleDegrees ?? 0;
  const movementDegrees = computeDirectionalMovement(startAngle, newAngle, dragSweepDirection);
  const sweepDirection = dragSweepDirection;
  const movementPct = movementDegrees / 360;
  const mmAppliedNumber = Number(mmAppliedRaw);
  const mmAppliedValid = mmAppliedRaw.trim() !== '' && Number.isFinite(mmAppliedNumber) && mmAppliedNumber >= 0;
  const effectiveMm = mmAppliedValid ? mmAppliedNumber * movementPct : 0;
  const selectedCircle =
    selectedField?.fieldType === 'pivot' ? deriveCircleFromPolygon(selectedField.boundary) : null;
  const endPivotHandle =
    selectedCircle && selectedField
      ? getCircleCoordinate(selectedCircle.center, selectedCircle.radiusMeters, newAngle)
      : null;
  const selectedPivotEntry =
    selectedCircle && selectedField
      ? [
          {
            id: selectedField.id,
            center: selectedCircle.center,
            radiusMeters: selectedCircle.radiusMeters,
            pivotAngleDegrees: startAngle,
          },
        ]
      : [];
  const endPivotEntry =
    selectedCircle && selectedField
      ? [
          {
            id: selectedField.id,
            center: selectedCircle.center,
            radiusMeters: selectedCircle.radiusMeters,
            pivotAngleDegrees: newAngle,
          },
        ]
      : [];

  function resetDragMovement(direction: PivotSweepDirection = 1) {
    lastDragAngleRef.current = null;
    dragSweepDirectionRef.current = direction;
    setDragSweepDirection(direction);
  }

  useEffect(() => {
    selectedCircleRef.current = selectedCircle;
    endPivotHandleRef.current = endPivotHandle;
    startAngleRef.current = startAngle;
  }, [selectedCircle, endPivotHandle, startAngle]);

  async function loadPivotFields(showLoading = true) {
    if (!currentFarmerId) return;
    if (showLoading) {
      setLoadingFields(true);
    }
    setLoadError(null);
    const result = await fetchFieldsForFarmer(currentFarmerId);
    setFields(result.data);
    if (result.error) {
      setLoadError(result.error);
    }
    if (showLoading) {
      setLoadingFields(false);
    }
  }

  useEffect(() => {
    void loadPivotFields();
  }, [currentFarmerId]);

  useEffect(() => {
    if (selectedField) {
      setNewAngle(selectedField.pivotAngleDegrees ?? 0);
      resetDragMovement();
    }
  }, [selectedFieldId, selectedField?.pivotAngleDegrees]);

  useEffect(() => {
    if (selectedFieldId && !pivotFields.some((field) => field.id === selectedFieldId)) {
      setSelectedFieldId('');
    }
  }, [pivotFields, selectedFieldId]);

  useEffect(() => {
    if (loadingFields || step !== 'select' || !MAPBOX_ACCESS_TOKEN || !mapRef.current) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    let cancelled = false;
    firstCameraSyncRef.current = true;
    lastCameraFitKeyRef.current = null;
    setMapStatus('loading');
    const initialBounds = getPolygonsBounds(
      (selectedField ? [selectedField] : pivotFields).map((field) => field.boundary),
    );

    try {
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: MAPBOX_STYLE_URL,
        ...(initialBounds
          ? {
              bounds: initialBounds,
              fitBoundsOptions: {
                padding: 72,
                maxZoom: 15,
                duration: 0,
              },
            }
          : {
              center: DEFAULT_CENTER,
              zoom: DEFAULT_ZOOM,
            }),
        attributionControl: true,
        clickTolerance: 10,
      });

      mapInstanceRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      function markMapReady() {
        if (cancelled) return;
        ensureActionMapSourcesAndLayers(map);
        setMapStatus('ready');
        setMapErrorMessage(null);
      }

      map.on('load', markMapReady);
      map.on('style.load', markMapReady);

      map.on('error', (event) => {
        if (cancelled) return;
        if (isSilentMapboxResourceError(event)) return;
        setMapStatus('error');
        setMapErrorMessage(event.error?.message ?? 'Mapbox failed to load.');
      });
    } catch (error) {
      setMapStatus('error');
      setMapErrorMessage(
        error instanceof Error ? error.message : 'Mapbox failed to initialise.',
      );
    }

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [loadingFields, step]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || mapStatus !== 'ready') return;

    setGeoJsonSourceData(map, ACTION_FIELDS_SOURCE_ID, buildFieldSelectionGeoJson(pivotFields));
    setGeoJsonSourceData(
      map,
      ACTION_SELECTED_FIELD_SOURCE_ID,
      buildFieldSelectionGeoJson(selectedField ? [selectedField] : []),
    );
    setGeoJsonSourceData(
      map,
      ACTION_SWEEP_SOURCE_ID,
      buildPivotSweepGeoJson(
        selectedCircle?.center ?? null,
        selectedCircle?.radiusMeters ?? null,
        startAngle,
        movementDegrees,
        sweepDirection,
      ),
    );
    setGeoJsonSourceData(map, ACTION_START_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(selectedPivotEntry));
    setGeoJsonSourceData(map, ACTION_END_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(endPivotEntry));
  }, [
    mapStatus,
    pivotFields,
    selectedField,
    selectedCircle,
    selectedPivotEntry,
    endPivotEntry,
    startAngle,
    movementDegrees,
    sweepDirection,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || mapStatus !== 'ready') return;

    const fitKey = selectedField
      ? `selected:${selectedField.id}`
      : `all:${pivotFields.map((field) => field.id).sort().join(',')}`;
    if (lastCameraFitKeyRef.current === fitKey) return;

    const polygons = selectedField ? [selectedField.boundary] : pivotFields.map((field) => field.boundary);
    if (polygons.length === 0) {
      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        duration: firstCameraSyncRef.current ? 0 : 900,
      });
      firstCameraSyncRef.current = false;
      lastCameraFitKeyRef.current = fitKey;
      return;
    }

    const bounds = getPolygonsBounds(polygons);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: 72,
        maxZoom: 15,
        duration: firstCameraSyncRef.current ? 0 : 900,
      });
      firstCameraSyncRef.current = false;
      lastCameraFitKeyRef.current = fitKey;
    }
  }, [mapStatus, pivotFields, selectedField]);

  useEffect(() => {
    const activeMap = mapInstanceRef.current;
    if (!activeMap || mapStatus !== 'ready') return;
    const map = activeMap;
    const canvas = map.getCanvas();
    const canvasElement = map.getCanvasContainer();

    function getLngLatFromPointerEvent(event: PointerEvent) {
      const bounds = canvasElement.getBoundingClientRect();
      const point = [event.clientX - bounds.left, event.clientY - bounds.top] as [number, number];
      return map.unproject(point);
    }

    function updatePivotHandleFromLngLat(lngLat: mapboxgl.LngLat, trackMovement = true) {
      const circle = selectedCircleRef.current;
      if (!circle) return;
      const nextAngle = getPivotAngleDegrees(circle.center, [lngLat.lng, lngLat.lat]);
      const previousAngle = lastDragAngleRef.current;
      setNewAngle(nextAngle);

      if (!trackMovement) {
        lastDragAngleRef.current = nextAngle;
        return;
      }

      if (previousAngle === null) {
        lastDragAngleRef.current = nextAngle;
        return;
      }

      const delta = computeSignedAngleDelta(previousAngle, nextAngle);
      lastDragAngleRef.current = nextAngle;

      if (Math.abs(delta) < PIVOT_DRAG_JITTER_DEGREES) {
        return;
      }

      const wasNearStart =
        computeAngleDistance(startAngleRef.current, previousAngle) <= PIVOT_DIRECTION_SWITCH_DEGREES;
      const isNearStart =
        computeAngleDistance(startAngleRef.current, nextAngle) <= PIVOT_DIRECTION_SWITCH_DEGREES;

      if (wasNearStart || isNearStart) {
        const nextDirection: PivotSweepDirection = delta < 0 ? -1 : 1;
        dragSweepDirectionRef.current = nextDirection;
        setDragSweepDirection(nextDirection);
      }
    }

    function updateCursorFromPointerEvent(event: PointerEvent) {
      const endPivotHandle = endPivotHandleRef.current;
      if (!endPivotHandle) {
        canvas.style.cursor = '';
        return;
      }

      const bounds = canvasElement.getBoundingClientRect();
      const handlePoint = map.project(endPivotHandle);
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const distance = Math.hypot(handlePoint.x - pointerX, handlePoint.y - pointerY);
      canvas.style.cursor = distance <= TOUCH_HIT_RADIUS_PX ? 'grab' : '';
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
    }

    function handleMapClick(event: mapboxgl.MapMouseEvent) {
      if (pivotDragActiveRef.current) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: ['action-fields-fill', 'action-fields-line'],
      });
      const clickedFieldId = features[0]?.properties?.id;
      if (typeof clickedFieldId === 'string') {
        setSelectedFieldId(clickedFieldId);
        setSaveError(null);
      }
    }

    function handleMouseMove(event: mapboxgl.MapMouseEvent) {
      if (pivotDragActiveRef.current) {
        canvas.style.cursor = 'grabbing';
        updatePivotHandleFromLngLat(event.lngLat);
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: ['action-fields-fill', 'action-fields-line'],
      });
      canvas.style.cursor = features.length > 0 ? 'pointer' : canvas.style.cursor;
    }

    function handlePointerDown(event: PointerEvent) {
      const endPivotHandle = endPivotHandleRef.current;
      if (!selectedCircleRef.current || !endPivotHandle) {
        return;
      }

      const bounds = canvasElement.getBoundingClientRect();
      const handlePoint = map.project(endPivotHandle);
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const distance = Math.hypot(handlePoint.x - pointerX, handlePoint.y - pointerY);

      if (distance > TOUCH_HIT_RADIUS_PX) {
        return;
      }

      event.preventDefault();
      const circle = selectedCircleRef.current;
      const pointerLngLat = getLngLatFromPointerEvent(event);
      const pointerAngle = getPivotAngleDegrees(circle.center, [pointerLngLat.lng, pointerLngLat.lat]);
      lastDragAngleRef.current = pointerAngle;
      pivotDragActiveRef.current = true;
      pivotPointerIdRef.current = event.pointerId;
      canvas.style.cursor = 'grabbing';
      map.dragPan.disable();
      canvasElement.setPointerCapture(event.pointerId);
      updatePivotHandleFromLngLat(pointerLngLat, false);
    }

    function handlePointerMove(event: PointerEvent) {
      if (pivotDragActiveRef.current) {
        event.preventDefault();
        canvas.style.cursor = 'grabbing';
        updatePivotHandleFromLngLat(getLngLatFromPointerEvent(event));
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
  }, [mapStatus]);

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

    const { error } = await supabase.rpc('log_action', {
      input_farmer_id: currentFarmerId,
      input_field_id: selectedField.id,
      input_end_date: endDate,
      input_movement_degrees: movementDegrees,
      input_mm_applied_at_pivot: mmAppliedNumber,
      input_new_pivot_angle_degrees: normalizeAngleDegrees(newAngle),
      input_start_pivot_angle_degrees: normalizeAngleDegrees(startAngle),
      input_sweep_direction: sweepDirection,
    });

    setSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    setMmAppliedRaw('');
    onLogged();
  }

  if (!loadingFields && pivotFields.length === 0) {
    return (
      <section className="actions-panel" aria-labelledby="actions-title">
        <header className="actions-header actions-subview-header">
          <h2 id="actions-title">Log a pivot action</h2>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Back
          </button>
        </header>
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
      <header className="actions-header actions-subview-header">
        <div>
          <h2 id="actions-title">Log a pivot action</h2>
          <p>
            {step === 'select'
              ? selectedField
                ? 'Drag the pivot to where it stopped.'
                : 'Tap a pivot on the map to get started.'
              : 'Enter how much water the pivot put down, and set the date.'}
          </p>
          <span className="actions-steps" aria-hidden>
            <span className={`actions-step-dot${step === 'select' ? ' is-active' : ''}`} />
            <span className={`actions-step-dot${step === 'details' ? ' is-active' : ''}`} />
          </span>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
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

      {!loadingFields && step === 'select' && !MAPBOX_ACCESS_TOKEN ? (
        <div className="map-state-card" data-testid="maps-setup-needed">
          <h3>Mapbox setup needed</h3>
          <p>
            Add <code>VITE_MAPBOX_ACCESS_TOKEN</code> to your local Vite env
            before logging pivot actions on the map.
          </p>
        </div>
      ) : null}

      {!loadingFields && step === 'select' ? (
        <>
          {MAPBOX_ACCESS_TOKEN ? (
            <div className="map-stage actions-map-stage">
              <div
                id={mapId}
                ref={mapRef}
                className="map-canvas actions-map-canvas"
                data-testid="actions-map-canvas"
              />
            </div>
          ) : null}

          <div className="field-action-bar">
            <button
              type="button"
              className="btn btn-primary field-add-btn"
              onClick={() => setStep('details')}
              disabled={!selectedField}
            >
              Next
            </button>
          </div>
        </>
      ) : null}

      {!loadingFields && step === 'details' && selectedField ? (
        <>
          <div className="actions-form">
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
              autoFocus
            />

            <div className="actions-effective-readout">
              <span>Spread across {selectedField.fieldName}:</span>
              <strong>{mmAppliedValid ? `${effectiveMm.toFixed(2)} mm` : '—'}</strong>
            </div>

            <div className="actions-date-row">
              <label className="auth-label" htmlFor="actions-end-date">
                Date
              </label>
              <input
                id="actions-end-date"
                className="auth-input"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <div className="field-action-bar actions-details-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep('select')}
              disabled={saving}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary field-add-btn"
              onClick={() => void handleSave()}
              disabled={saving || !mmAppliedValid}
            >
              {saving ? 'Saving action...' : 'Log action'}
            </button>
          </div>
        </>
      ) : null}

      {saveError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}

function ActionsListView({
  currentFarmerId,
  onNew,
  onSelect,
}: {
  currentFarmerId: string;
  onNew: () => void;
  onSelect: (action: ActionRecord) => void;
}) {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      const result = await fetchActionsForFarmer(currentFarmerId);
      if (cancelled) return;
      setActions(result.data);
      if (result.error) {
        setLoadError(result.error);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentFarmerId]);

  return (
    <section className="actions-panel" aria-labelledby="actions-title">
      <header className="actions-header">
        <h2 id="actions-title">Actions</h2>
        <p>Every irrigation action logged for this farmer, newest first.</p>
      </header>

      <button type="button" className="btn btn-primary actions-new-btn" onClick={onNew}>
        <span className="field-add-btn-glyph" aria-hidden>
          +
        </span>
        Log new action
      </button>

      {loadError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {loadError}
        </p>
      ) : null}

      {loading ? (
        <div className="map-state-card">
          <h3>Loading actions</h3>
          <p>Fetching the action history for this farmer.</p>
        </div>
      ) : actions.length === 0 ? (
        <div className="map-state-card">
          <h3>No actions yet</h3>
          <p>Log your first pivot action with the green button above.</p>
        </div>
      ) : (
        <ul className="actions-list">
          {actions.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className="actions-list-item"
                onClick={() => onSelect(action)}
              >
                <span className="actions-list-main">
                  <span className="actions-list-field">{action.fieldName}</span>
                  <span className="actions-list-date">{formatActionDate(action.endDate)}</span>
                </span>
                <span className="actions-list-mm">
                  {computeEffectiveMm(action.mmAppliedAtPivot, action.movementDegrees).toFixed(1)} mm
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionDetailView({
  currentFarmerId,
  action,
  onBack,
}: {
  currentFarmerId: string;
  action: ActionRecord;
  onBack: () => void;
}) {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const [field, setField] = useState<FieldRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    MAPBOX_ACCESS_TOKEN ? 'loading' : 'idle',
  );

  const effectiveMm = computeEffectiveMm(action.mmAppliedAtPivot, action.movementDegrees);
  const circle = field?.fieldType === 'pivot' ? deriveCircleFromPolygon(field.boundary) : null;
  const startAngle = action.startPivotAngleDegrees;
  const endAngle = normalizeAngleDegrees(
    startAngle + action.sweepDirection * action.movementDegrees,
  );
  const startPivotEntry =
    circle && field
      ? [
          {
            id: field.id,
            center: circle.center,
            radiusMeters: circle.radiusMeters,
            pivotAngleDegrees: startAngle,
          },
        ]
      : [];
  const endPivotEntry =
    circle && field
      ? [
          {
            id: field.id,
            center: circle.center,
            radiusMeters: circle.radiusMeters,
            pivotAngleDegrees: endAngle,
          },
        ]
      : [];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      const result = await fetchFieldsForFarmer(currentFarmerId);
      if (cancelled) return;
      setField(result.data.find((item) => item.id === action.fieldId) ?? null);
      if (result.error) {
        setLoadError(result.error);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentFarmerId, action.fieldId]);

  useEffect(() => {
    if (loading || !MAPBOX_ACCESS_TOKEN || !mapRef.current || !field) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    let cancelled = false;
    setMapStatus('loading');
    const initialBounds = getPolygonsBounds([field.boundary]);

    try {
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: MAPBOX_STYLE_URL,
        ...(initialBounds
          ? {
              bounds: initialBounds,
              fitBoundsOptions: { padding: 72, maxZoom: 15, duration: 0 },
            }
          : {
              center: DEFAULT_CENTER,
              zoom: DEFAULT_ZOOM,
            }),
        attributionControl: true,
      });

      mapInstanceRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      function markReady() {
        if (cancelled) return;
        ensureActionMapSourcesAndLayers(map);
        setMapStatus('ready');
      }

      map.on('load', markReady);
      map.on('style.load', markReady);
      map.on('error', (event) => {
        if (cancelled) return;
        if (isSilentMapboxResourceError(event)) return;
        setMapStatus('error');
      });
    } catch {
      setMapStatus('error');
    }

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [loading, field]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || mapStatus !== 'ready' || !field) return;

    setGeoJsonSourceData(map, ACTION_FIELDS_SOURCE_ID, emptyFeatureCollection());
    setGeoJsonSourceData(map, ACTION_SELECTED_FIELD_SOURCE_ID, buildFieldSelectionGeoJson([field]));
    setGeoJsonSourceData(
      map,
      ACTION_SWEEP_SOURCE_ID,
      buildPivotSweepGeoJson(
        circle?.center ?? null,
        circle?.radiusMeters ?? null,
        startAngle,
        action.movementDegrees,
        action.sweepDirection,
      ),
    );
    setGeoJsonSourceData(map, ACTION_START_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(startPivotEntry));
    setGeoJsonSourceData(map, ACTION_END_PIVOT_SOURCE_ID, buildPivotOverlayGeoJson(endPivotEntry));

    const bounds = getPolygonsBounds([field.boundary]);
    if (bounds) {
      map.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 0 });
    }
  }, [
    mapStatus,
    field,
    circle,
    startAngle,
    endAngle,
    action.movementDegrees,
    action.sweepDirection,
  ]);

  return (
    <section className="actions-panel" aria-labelledby="actions-detail-title">
      <header className="actions-header actions-subview-header">
        <h2 id="actions-detail-title">{action.fieldName}</h2>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
      </header>

      {loadError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {loadError}
        </p>
      ) : null}

      {loading ? (
        <div className="map-state-card">
          <h3>Loading action</h3>
          <p>Fetching the field for this action.</p>
        </div>
      ) : !field ? (
        <div className="map-state-card">
          <h3>Field unavailable</h3>
          <p>The field for this action could not be found.</p>
        </div>
      ) : !MAPBOX_ACCESS_TOKEN ? (
        <div className="map-state-card" data-testid="maps-setup-needed">
          <h3>Mapbox setup needed</h3>
          <p>
            Add <code>VITE_MAPBOX_ACCESS_TOKEN</code> to your local Vite env to see the
            field map.
          </p>
        </div>
      ) : (
        <div className="map-stage actions-map-stage">
          <div
            id={mapId}
            ref={mapRef}
            className="map-canvas actions-map-canvas"
            data-testid="action-detail-map-canvas"
          />
        </div>
      )}

      <dl className="action-detail-grid">
        <div>
          <dt>Water placed</dt>
          <dd>{effectiveMm.toFixed(1)} mm</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatActionDate(action.endDate)}</dd>
        </div>
      </dl>
    </section>
  );
}

function ActionsPanel({ currentFarmerId }: { currentFarmerId: string }) {
  const [view, setView] = useState<'list' | 'log' | 'detail'>('list');
  const [detailAction, setDetailAction] = useState<ActionRecord | null>(null);

  if (view === 'log') {
    return (
      <ActionLogView
        currentFarmerId={currentFarmerId}
        onBack={() => setView('list')}
        onLogged={() => setView('list')}
      />
    );
  }

  if (view === 'detail' && detailAction) {
    return (
      <ActionDetailView
        currentFarmerId={currentFarmerId}
        action={detailAction}
        onBack={() => setView('list')}
      />
    );
  }

  return (
    <ActionsListView
      currentFarmerId={currentFarmerId}
      onNew={() => setView('log')}
      onSelect={(action) => {
        setDetailAction(action);
        setView('detail');
      }}
    />
  );
}

const INSIGHTS_RANGE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];
const INSIGHTS_MAX_WINDOW_DAYS = INSIGHTS_RANGE_OPTIONS.reduce(
  (max, option) => Math.max(max, option.days),
  0,
);
const INSIGHTS_FIELD_COLORS = [
  '#5e9544',
  '#c39a40',
  '#9a7a3c',
  '#c46a4a',
  '#3a6a3f',
];

function formatInsightsDay(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  if (!year || !month || !day) return isoDate;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildInsightsChartData(rows: WaterPerDayRow[], days: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalsByDay = new Map<string, number>();
  for (const row of rows) {
    totalsByDay.set(row.day, (totalsByDay.get(row.day) ?? 0) + row.totalMm);
  }

  const series: Array<{ day: string; fullDate: string; totalMm: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    series.push({
      day: formatInsightsDay(iso),
      fullDate: iso,
      totalMm: totalsByDay.get(iso) ?? 0,
    });
  }

  return { series };
}

function InsightsPanel({ currentFarmerId }: { currentFarmerId: string }) {
  const [rows, setRows] = useState<WaterPerDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      const result = await fetchWaterPerDayForFarmer(
        currentFarmerId,
        INSIGHTS_MAX_WINDOW_DAYS,
      );
      if (cancelled) return;
      setRows(result.data);
      if (result.error) {
        setLoadError(result.error);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentFarmerId]);

  const [rangeDays, setRangeDays] = useState<number>(INSIGHTS_RANGE_OPTIONS[0].days);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string> | null>(null);
  const [openFilter, setOpenFilter] = useState<'range' | 'fields' | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openFilter) return;
    function handlePointer(event: MouseEvent) {
      if (!filtersRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [openFilter]);

  const availableFields = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (!byId.has(row.fieldId)) byId.set(row.fieldId, row.fieldName);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const activeFieldIds = selectedFieldIds ?? new Set(availableFields.map((f) => f.id));

  const filteredRows = useMemo(
    () => rows.filter((row) => activeFieldIds.has(row.fieldId)),
    [rows, activeFieldIds],
  );

  const { series } = useMemo(
    () => buildInsightsChartData(filteredRows, rangeDays),
    [filteredRows, rangeDays],
  );

  const hasData = filteredRows.some((row) => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (rangeDays - 1));
    return new Date(row.day) >= cutoff;
  });

  const rangeLabel =
    INSIGHTS_RANGE_OPTIONS.find((option) => option.days === rangeDays)?.label ?? `${rangeDays} days`;
  const allFieldsSelected =
    selectedFieldIds === null || activeFieldIds.size === availableFields.length;
  const fieldsLabel = allFieldsSelected
    ? `All ${availableFields.length} field${availableFields.length === 1 ? '' : 's'}`
    : activeFieldIds.size === 1
    ? availableFields.find((f) => activeFieldIds.has(f.id))?.name ?? '1 field'
    : `${activeFieldIds.size} fields`;

  function toggleField(id: string) {
    const next = new Set(activeFieldIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedFieldIds(next);
  }

  return (
    <section className="insights-panel" aria-labelledby="insights-title">
      <header className="insights-header">
        <h2 id="insights-title">Water logged</h2>
        <p>Daily total mm at pivot.</p>
      </header>

      {loadError ? (
        <p className="auth-feedback auth-feedback-error" aria-live="polite">
          {loadError}
        </p>
      ) : null}

      <div className="insights-filters" ref={filtersRef}>
        <div className="insights-filter">
          <button
            type="button"
            className="insights-filter-pill"
            aria-haspopup="menu"
            aria-expanded={openFilter === 'range'}
            onClick={() => setOpenFilter(openFilter === 'range' ? null : 'range')}
          >
            <span className="insights-filter-label">RANGE</span>
            <span className="insights-filter-value">{rangeLabel}</span>
            <span className="insights-filter-chevron" aria-hidden>▾</span>
          </button>
          {openFilter === 'range' ? (
            <div className="insights-filter-menu" role="menu">
              {INSIGHTS_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className="insights-filter-item"
                  role="menuitemradio"
                  aria-checked={rangeDays === option.days}
                  onClick={() => {
                    setRangeDays(option.days);
                    setOpenFilter(null);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="insights-filter">
          <button
            type="button"
            className="insights-filter-pill"
            aria-haspopup="menu"
            aria-expanded={openFilter === 'fields'}
            onClick={() => setOpenFilter(openFilter === 'fields' ? null : 'fields')}
            disabled={availableFields.length === 0}
          >
            <span className="insights-filter-label">SHOW</span>
            <span className="insights-filter-value">{fieldsLabel}</span>
            <span className="insights-filter-chevron" aria-hidden>▾</span>
          </button>
          {openFilter === 'fields' ? (
            <div className="insights-filter-menu" role="menu">
              <button
                type="button"
                className="insights-filter-item"
                onClick={() => setSelectedFieldIds(null)}
              >
                {allFieldsSelected ? '✓ ' : ''}All fields
              </button>
              {availableFields.map((field) => {
                const checked = activeFieldIds.has(field.id);
                return (
                  <button
                    key={field.id}
                    type="button"
                    className="insights-filter-item"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggleField(field.id)}
                  >
                    {checked ? '✓ ' : ''}{field.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="insights-card">
      {loading ? (
        <p className="insights-state">Loading insights…</p>
      ) : !hasData ? (
        <p className="insights-state">
          No water logged in the selected range.
        </p>
      ) : (
        <div className="insights-chart">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={series} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(74, 90, 74, 0.12)" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: '#4a5a4a' }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#4a5a4a' }}
                width={40}
                label={{
                  value: 'mm',
                  position: 'top',
                  offset: 12,
                  fontSize: 11,
                  fill: '#4a5a4a',
                }}
              />
              <Tooltip
                formatter={(value) => `${Number(value ?? 0).toFixed(1)} mm`}
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid rgba(74, 90, 74, 0.18)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="totalMm" fill={INSIGHTS_FIELD_COLORS[0]} />

            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      </div>
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
  const [currentFarmerId, setCurrentFarmerId] = useState('');
  const [farmerMessage, setFarmerMessage] = useState<string | null>(null);
  const [farmerError, setFarmerError] = useState<string | null>(null);
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
    setCurrentFarmerId('');
    setFarmerNameInput('');
    setAppState('signed-out');
  }

  function handleOpenAddFieldScreen() {
    setAccountMenuOpen(false);
    navigateTo({ tabId: 'fields', screen: 'add-field' });
  }

  function handleOpenEditFieldScreen(fieldId: string) {
    setAccountMenuOpen(false);
    navigateTo({ tabId: 'fields', screen: 'edit-field', fieldId });
  }

  function handleCloseFieldScreen() {
    setAccountMenuOpen(false);
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldCreated() {
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldUpdated() {
    navigateTo({ tabId: 'fields', screen: 'workspace' });
  }

  function handleFieldDeleted() {
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
                activeTab === 'fields' || activeTab === 'actions' || activeTab === 'insights'
                  ? 'workspace-card'
                  : 'content-card workspace-card'
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
                </>
              ) : activeTab === 'actions' ? (
                <ActionsPanel currentFarmerId={currentFarmerId} />
              ) : activeTab === 'insights' ? (
                <InsightsPanel currentFarmerId={currentFarmerId} />
              ) : (
                <PlaceholderPanel tab={tabs.find(({ id }) => id === activeTab) ?? tabs[0]} />
              )}
            </section>
          ) : (
            <section className="route-card" aria-labelledby="field-route-title">
              <header className="content-header route-header">
                <div>
                  <h2 id="field-route-title">
                    {activeScreen === 'edit-field' ? 'Edit field' : 'Add field'}
                  </h2>
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
