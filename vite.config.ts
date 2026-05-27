import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves 404.html for any path that doesn't map to a file in the
// deployed artifact. Our app does client-side routing on real paths (e.g.
// /fields/:id), so refreshing or deep-linking those URLs would otherwise hit
// GitHub's default 404. Shipping a 404.html that is a copy of index.html lets
// the SPA boot and route from window.location.pathname.
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      const index = resolve(outDir, 'index.html');
      const fallback = resolve(outDir, '404.html');
      if (existsSync(index)) copyFileSync(index, fallback);
    },
  };
}

export default defineConfig({
  // Custom domain (pivotsense.co.za) serves from the root, so assets must be
  // referenced as /assets/... not /pivot-sense/assets/... Setting base to '/'
  // also matches the dev server URL (http://localhost:5173/).
  base: '/',
  plugins: [react(), spaFallback()],
});
