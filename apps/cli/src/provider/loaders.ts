/**
 * Per-provider lazy module loaders — the ONE place the CLI enumerates the
 * `@agentbox/sandbox-<name>` packages.
 *
 * Each package exposes a uniform `providerModule` (see `ProviderModule` in
 * `@agentbox/sandbox-core`); the create / doctor / install / checkpoint code
 * all resolve a provider through `loadProviderModule` and drive it generically,
 * so those call sites carry no per-provider `switch`.
 *
 * The `import()` specifiers are LITERAL — one arm per provider — on purpose.
 * The CLI's tsup build inlines every `@agentbox/sandbox-*` package
 * (`noExternal: [/^@agentbox\//]`), which requires esbuild to statically
 * resolve each specifier; a runtime-variable `import('@agentbox/sandbox-' +
 * name)` would not inline and would `MODULE_NOT_FOUND` in the published CLI.
 * `Record<ProviderKind, …>` makes this map exhaustive: adding a provider to the
 * config `PROVIDERS` table forces a matching entry here (a TS error otherwise).
 */

import type { ProviderKind } from '@agentbox/config';
import type { ProviderModule } from '@agentbox/sandbox-core';

const IMPORTERS: Record<ProviderKind, () => Promise<{ providerModule: ProviderModule }>> = {
  docker: () => import('@agentbox/sandbox-docker'),
  daytona: () => import('@agentbox/sandbox-daytona'),
  hetzner: () => import('@agentbox/sandbox-hetzner'),
  vercel: () => import('@agentbox/sandbox-vercel'),
  e2b: () => import('@agentbox/sandbox-e2b'),
};

/** Lazily import a provider package and return its uniform `providerModule`. */
export async function loadProviderModule(name: ProviderKind): Promise<ProviderModule> {
  return (await IMPORTERS[name]()).providerModule;
}
