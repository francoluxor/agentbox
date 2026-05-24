/**
 * Persisted record of what `agentbox prepare --provider hetzner` has built.
 * Lives at `~/.agentbox/hetzner-prepared.json` so the auto-prepare gate
 * (`ensureHetznerBaseSnapshot()`) and runtime image resolution can see it.
 *
 * Two tiers are recorded (matching the daytona shape — see
 * `docs/cloud-create-flow.md` §"base vs project snapshot"):
 *   - `base` — built once per Hetzner project / API token. Ubuntu + deps +
 *     agentbox-ctl + agents + agent-browser, baked from `install-box.sh`.
 *   - `projects[<projectHash>]` — optional per-project snapshot built after
 *     the first successful `agentbox create` for that project; subsequent
 *     creates for the same project boot from it instead of re-seeding
 *     workspace / agent credentials over SSH.
 *
 * Schema versioned so future shape changes can migrate; we'll only ever
 * accept `schema: 1` for now.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const SCHEMA = 1 as const;

export interface PreparedBaseSnapshot {
  /** Hetzner image id (numeric — opaque, but stable across `getImage` calls). */
  imageId: number;
  /** User-facing description (matches the firewall-dashboard rows). */
  description: string;
  /** ISO timestamp of bake-completion. */
  createdAt: string;
  /** Hash of the install script we baked from (so re-bake on script change). */
  installScriptSha256?: string;
}

export interface PreparedProjectSnapshot {
  imageId: number;
  description: string;
  createdAt: string;
  /** Bake source — what was in /workspace when we snapshotted. */
  fromSandboxId?: string;
}

export interface PreparedHetznerState {
  schema: typeof SCHEMA;
  /** The shared base snapshot. Absent until first `agentbox prepare`. */
  base?: PreparedBaseSnapshot;
  /** Per-project snapshots, keyed by the agentbox project hash. */
  projects: Record<string, PreparedProjectSnapshot>;
}

export function preparedStatePath(): string {
  return resolve(homedir(), '.agentbox', 'hetzner-prepared.json');
}

export function readPreparedState(): PreparedHetznerState {
  const path = preparedStatePath();
  if (!existsSync(path)) return { schema: SCHEMA, projects: {} };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PreparedHetznerState>;
    if (parsed.schema !== SCHEMA) {
      // Unknown schema: don't crash, just refuse to read — the file will be
      // overwritten on the next successful prepare.
      return { schema: SCHEMA, projects: {} };
    }
    return {
      schema: SCHEMA,
      base: parsed.base,
      projects: parsed.projects ?? {},
    };
  } catch {
    return { schema: SCHEMA, projects: {} };
  }
}

export function writePreparedState(state: PreparedHetznerState): void {
  const path = preparedStatePath();
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(state, null, 2) + '\n';
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Convenience helper: update one field of the state without forcing callers
 * to read/merge/write themselves.
 */
export function updatePreparedState(mutate: (s: PreparedHetznerState) => void): void {
  const s = readPreparedState();
  mutate(s);
  writePreparedState(s);
}
