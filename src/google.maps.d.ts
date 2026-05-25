declare namespace google.maps {
  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapId?: string;
    mapTypeControl?: boolean;
    fullscreenControl?: boolean;
    streetViewControl?: boolean;
  }

  class Map {
    constructor(container: HTMLElement, options?: MapOptions);
  }
}

interface Window {
  google?: {
    maps: typeof google.maps;
  };
}
