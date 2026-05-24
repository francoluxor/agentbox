import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Hetzner env auto-loader — mirrors `ensureDaytonaEnvLoaded()`. The Hetzner
 * REST client reads `HCLOUD_TOKEN` from `process.env`. We pull it in from
 * `~/.agentbox/secrets.env` so the client Just Works after the user runs
 * `agentbox hetzner login` once.
 *
 * Lookup order (first wins; process.env is never overwritten):
 *   1. `process.env` (already set in the shell).
 *   2. `~/.agentbox/secrets.env` — written by `agentbox hetzner login`.
 *
 * Project-level `.env` / `.env.local` are intentionally NOT consulted: those
 * files belong to the app code being developed, and a `HCLOUD_TOKEN` there
 * is typically meant for in-box infrastructure work, not for the host CLI to
 * harvest and provision VPSes with.
 *
 * Only Hetzner-prefixed keys are imported. Idempotent + side-effect-free
 * after the first call.
 */
const HETZNER_KEYS = ['HCLOUD_TOKEN', 'HCLOUD_ENDPOINT'] as const;

let loaded = false;

export function ensureHetznerEnvLoaded(): void {
  if (loaded) return;
  loaded = true;
  importHetznerFromFile(resolve(homedir(), '.agentbox', 'secrets.env'));
}

function importHetznerFromFile(path: string): void {
  if (!existsSync(path)) return;
  let body: string;
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const parsed = parseEnvFile(body);
  for (const key of HETZNER_KEYS) {
    if (process.env[key] !== undefined) continue;
    const value = parsed[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
}

/**
 * Minimal `.env` parser: handles `KEY=value`, `KEY="value with spaces"`,
 * `KEY='value with $special chars'`, `export KEY=value`, blank lines, and
 * `#` comments. Same shape as the daytona env-loader's parser — kept local
 * here rather than imported across packages to avoid the cycle (daytona
 * doesn't import from hetzner and shouldn't start now).
 */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
