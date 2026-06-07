#!/usr/bin/env node
// Keeps the Codex plugin bundle's skill copy in sync with the canonical source.
//
// The canonical agentbox-info skill lives at apps/cli/share/host-skills/agentbox-info/SKILL.md
// (the CLI installs it from there). The Codex marketplace bundle under plugins/agentbox/ must
// carry a *real copy* of it — Codex copies a plugin bundle on install and does not follow a
// symlink that points outside the bundle, so a symlink would ship an empty skill.
//
// Usage:
//   node scripts/check-plugin-skill-sync.mjs        # verify (exit 1 on drift) — run in CI
//   node scripts/check-plugin-skill-sync.mjs --fix  # copy canonical -> bundle

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// canonical source -> bundle copy
const PAIRS = [
  {
    canonical: 'apps/cli/share/host-skills/agentbox-info/SKILL.md',
    bundle: 'plugins/agentbox/skills/agentbox-info/SKILL.md',
  },
];

const fix = process.argv.includes('--fix');
let drifted = 0;

for (const { canonical, bundle } of PAIRS) {
  const src = readFileSync(join(repoRoot, canonical));
  let dst;
  try {
    dst = readFileSync(join(repoRoot, bundle));
  } catch {
    dst = null;
  }

  if (dst !== null && dst.equals(src)) continue;

  if (fix) {
    mkdirSync(dirname(join(repoRoot, bundle)), { recursive: true });
    writeFileSync(join(repoRoot, bundle), src);
    console.log(`synced ${bundle} <- ${canonical}`);
  } else {
    drifted++;
    console.error(
      `✗ ${bundle} is out of sync with ${canonical}\n` +
        `  Run: node scripts/check-plugin-skill-sync.mjs --fix`,
    );
  }
}

if (!fix && drifted > 0) process.exit(1);
if (!fix) console.log('plugin skill bundle is in sync ✓');
