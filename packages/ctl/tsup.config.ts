import { defineConfig } from 'tsup';

// Two outputs:
//   dist/index.js — library entry consumed via workspace by apps/cli (deps
//                   resolved by pnpm). Standard externals.
//   dist/bin.js   — self-contained CLI baked into the box image; bundle every
//                   runtime dep so the Dockerfile install is a single COPY.
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
    // CJS output for the bundled binary: esbuild's ESM bundle generates a
    // poisoned `__require` that throws on any CJS dep (commander, yaml).
    // CJS avoids that entirely, and the file still runs under Node 20+ fine.
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
