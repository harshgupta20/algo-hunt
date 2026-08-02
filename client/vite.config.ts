import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ash/shared': sharedSrc,
    },
  },
  server: {
    port: 5173,
    // Allow importing the shared package TS source from outside the client root.
    fs: { allow: [workspaceRoot] },
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    },
  },
});
