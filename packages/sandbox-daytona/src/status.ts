/**
 * Read-only status helpers for `agentbox prepare` (no-args mode). Surfaces
 * the user-facing inventory of agentbox-owned base images / snapshots /
 * volumes on the configured Daytona org so the user can see at a glance
 * what's already prepared and what isn't.
 *
 * Daytona-side state lives in two places:
 *   - **Snapshots** — built by `agentbox prepare --provider daytona`. Listed
 *     filtered to `agentbox*` so we don't surface unrelated org snapshots.
 *   - **Volumes** — the per-org `agentbox-credentials` volume created lazily
 *     by `ensureAgentVolumesForCloud` on first `agentbox create --provider
 *     daytona`.
 *
 * All calls swallow auth/network errors and return an empty section — the
 * status command must work for users who don't have Daytona configured.
 */

import { ensureDaytonaEnvLoaded } from './env-loader.js';
import { getClient } from './backend.js';

export interface DaytonaSnapshotSummary {
  name: string;
  state?: string;
  /** Snapshot size in GB, as reported by Daytona (may be undefined for non-`active` states). */
  sizeGb?: number;
  createdAt?: string;
  errorReason?: string;
}

export interface DaytonaVolumeSummary {
  name: string;
  id: string;
  state?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface DaytonaStatus {
  /** True when Daytona credentials are present + the SDK could connect. */
  configured: boolean;
  /** Snapshots whose name starts with `agentbox` (case-insensitive). */
  snapshots: DaytonaSnapshotSummary[];
  /** Volumes whose name starts with `agentbox` (case-insensitive). */
  volumes: DaytonaVolumeSummary[];
  /** Non-fatal explanation when `configured` is false. */
  reason?: string;
}

function isAgentboxName(name: unknown): boolean {
  return typeof name === 'string' && name.toLowerCase().startsWith('agentbox');
}

/**
 * Collect a read-only summary of agentbox-owned snapshots + volumes on the
 * Daytona org. Never throws — failure paths return `configured: false` with
 * a one-line reason.
 */
export async function getDaytonaStatus(): Promise<DaytonaStatus> {
  try {
    ensureDaytonaEnvLoaded();
  } catch (err) {
    return {
      configured: false,
      snapshots: [],
      volumes: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    return {
      configured: false,
      snapshots: [],
      volumes: [],
      reason: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }

  const snapshots: DaytonaSnapshotSummary[] = [];
  const volumes: DaytonaVolumeSummary[] = [];
  let reason: string | undefined;

  try {
    const list = await client.snapshot.list();
    const items = (list as { items?: unknown[] }).items ?? (Array.isArray(list) ? list : []);
    for (const s of items) {
      const dto = s as { name?: unknown; state?: unknown; size?: unknown; createdAt?: unknown; errorReason?: unknown };
      if (!isAgentboxName(dto.name)) continue;
      snapshots.push({
        name: dto.name as string,
        state: typeof dto.state === 'string' ? dto.state : undefined,
        sizeGb: typeof dto.size === 'number' ? dto.size : undefined,
        createdAt: typeof dto.createdAt === 'string' ? dto.createdAt : undefined,
        errorReason: typeof dto.errorReason === 'string' ? dto.errorReason : undefined,
      });
    }
  } catch (err) {
    reason = `snapshot list failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`;
  }

  try {
    const list = await client.volume.list();
    const items: unknown[] = Array.isArray(list)
      ? list
      : ((list as { items?: unknown[] }).items ?? []);
    for (const v of items) {
      const dto = v as { name?: unknown; id?: unknown; state?: unknown; createdAt?: unknown; lastUsedAt?: unknown };
      if (!isAgentboxName(dto.name)) continue;
      volumes.push({
        name: dto.name as string,
        id: typeof dto.id === 'string' ? dto.id : '',
        state: typeof dto.state === 'string' ? dto.state : undefined,
        createdAt: typeof dto.createdAt === 'string' ? dto.createdAt : undefined,
        lastUsedAt: typeof dto.lastUsedAt === 'string' ? dto.lastUsedAt : undefined,
      });
    }
  } catch (err) {
    const msg = `volume list failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`;
    reason = reason ? `${reason}; ${msg}` : msg;
  }

  return {
    configured: true,
    snapshots: snapshots.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    volumes: volumes.sort((a, b) => a.name.localeCompare(b.name)),
    reason,
  };
}
