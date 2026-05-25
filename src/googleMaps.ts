type MapsNamespace = typeof google.maps;

let cachedPromise: Promise<MapsNamespace> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (cachedPromise) {
    return cachedPromise;
  }

  cachedPromise = new Promise<MapsNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-loader="true"]',
    );

    const onReady = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps script loaded but window.google.maps is missing.'));
      }
    };

    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Existing Google Maps script failed to load.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=drawing`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = 'true';
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener(
      'error',
      () => {
        cachedPromise = null;
        reject(new Error('Failed to load the Google Maps script.'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return cachedPromise;
}
