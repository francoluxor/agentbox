/**
 * Daytona sandbox-class + region resolution.
 *
 * Daytona has two sandbox classes and they are not interchangeable:
 *
 *   - `linux-vm` — a real VM. Gives true pause/resume (CPU + memory frozen, so
 *     running processes and tmux sessions survive), a filesystem+memory
 *     snapshot capability, and a base bake that takes ~1 min instead of ~7
 *     (it boots a prebuilt registry image rather than building a Dockerfile).
 *     It cannot be archived, and it runs in exactly ONE region.
 *   - `container` — the original shape. Archivable, buildable from a
 *     Dockerfile via Daytona's declarative builder, available in the shared
 *     regions (`us`, `eu`).
 *
 * The region coupling is the sharp edge: only `us-east-1` has linux-vm runners.
 * Asking for a VM anywhere else fails at create with "No runners are configured
 * in region '<r>' for sandbox class 'linux-vm'". So an unset `box.daytonaRegion`
 * derives from the class rather than defaulting to a constant — otherwise the
 * default class and the default region would contradict each other.
 *
 * A user who needs a specific region (EU data residency, latency) sets
 * `box.daytonaClass=container` and gets the old behavior.
 */
import type { EffectiveConfig } from './types.js';

export type DaytonaSandboxClass = 'linux-vm' | 'container';

/** The only Daytona region with linux-vm runners (verified 2026-07-12). */
export const DAYTONA_VM_REGION = 'us-east-1';

export function resolveDaytonaClass(cfg: EffectiveConfig): DaytonaSandboxClass {
  return cfg.box.daytonaClass === 'container' ? 'container' : 'linux-vm';
}

/**
 * The region to create in. An explicit `box.daytonaRegion` always wins (so a
 * user can follow Daytona to a second VM region the day one appears, without
 * waiting on a release). Empty derives from the class; for `container` we
 * return '' and let the SDK use the account default, preserving today's
 * behavior for existing users byte-for-byte.
 */
export function resolveDaytonaRegion(cfg: EffectiveConfig): string {
  const explicit = cfg.box.daytonaRegion.trim();
  if (explicit.length > 0) return explicit;
  return resolveDaytonaClass(cfg) === 'linux-vm' ? DAYTONA_VM_REGION : '';
}
