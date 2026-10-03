import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  test: { include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'], testTimeout: 20000 }
});
