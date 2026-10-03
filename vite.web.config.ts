import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browser-only build of the renderer. It runs against the mock API, so you can
// preview the UI (or serve it from Docker) without Electron.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  server: { port: 5917, strictPort: true, host: true },
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true }
});
