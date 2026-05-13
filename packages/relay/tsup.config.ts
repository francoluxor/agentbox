import { defineConfig } from 'tsup';

// Same two-output pattern as @agentbox/ctl:
//   dist/index.js — library entry consumed by other workspace packages.
//   dist/bin.cjs  — self-contained CJS bin baked into the relay docker image.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    clean: true,
    dts: true,
    sourcemap: true,
  },
  {
    entry: { bin: 'src/bin.ts' },
    format: ['cjs'],
    target: 'node20',
    clean: false,
    dts: false,
    sourcemap: false,
    noExternal: [/.*/],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
