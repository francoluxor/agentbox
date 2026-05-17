import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: false,
  sourcemap: true,
  // Deps are externalized (resolved from node_modules at runtime). Explicit
  // external keeps esbuild from walking node-pty's prebuilt-binary require()
  // / bindings path probing during the build.
  external: ['@homebridge/node-pty-prebuilt-multiarch', '@xterm/headless'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
