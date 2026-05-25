import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Custom domain (pivotsense.co.za) serves from the root, so assets must be
  // referenced as /assets/... not /pivot-sense/assets/... Setting base to '/'
  // also matches the dev server URL (http://localhost:5173/).
  base: '/',
  plugins: [react()],
});
