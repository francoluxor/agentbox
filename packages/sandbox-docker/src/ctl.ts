import { stat } from 'node:fs/promises';
import { execInBox } from './docker.js';

export interface CtlLaunchResult {
  up: boolean;
  reason?: string;
}

/**
 * Spawn `agentbox-ctl daemon` detached inside the container and wait briefly
 * for the unix socket to appear on the host-mounted path. Best-effort —
 * failure is logged but doesn't fail box creation, since a missing or empty
 * agentbox.yaml is a perfectly valid state.
 */
export async function launchCtlDaemon(
  container: string,
  hostSocketPath: string,
  timeoutMs = 3000,
): Promise<CtlLaunchResult> {
  const result = await execInBox(container, ['agentbox-ctl', 'daemon'], {
    user: 'vscode',
    detach: true,
  });
  if (result.exitCode !== 0) {
    return { up: false, reason: `docker exec failed: ${result.stderr || result.stdout}` };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(hostSocketPath)) return { up: true };
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    up: false,
    reason: `socket ${hostSocketPath} did not appear within ${String(timeoutMs)}ms`,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
