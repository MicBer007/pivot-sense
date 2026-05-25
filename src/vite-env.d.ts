/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GOOGLE_MAP_ID?: string;
  readonly VITE_GOOGLE_MAPS_DEFAULT_LAT?: string;
  readonly VITE_GOOGLE_MAPS_DEFAULT_LNG?: string;
  readonly VITE_GOOGLE_MAPS_DEFAULT_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
