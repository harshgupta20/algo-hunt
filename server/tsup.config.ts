import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace shared package (TS source) into the output.
  noExternal: ['@ash/shared'],
  // kiteconnect is optional and imported dynamically; keep it external.
  external: ['kiteconnect'],
});
