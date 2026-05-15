import { join } from 'node:path';
import { loadConfig } from '@agentbox/ctl';
import type { BoxRecord } from './state.js';
import type { DockerEngine } from './host-export.js';
import { buildVncUrls, VNC_CONTAINER_PORT } from './vnc.js';

export interface BoxEndpoint {
  kind: 'vnc' | 'service';
  /** Service name (kind === 'service') or 'vnc' (kind === 'vnc'). */
  name: string;
  /** In-container port (6080 for VNC, the `ready_when.port` value for services). */
  containerPort: number;
  /**
   * Host-side URL the user can open. Undefined when the port isn't reachable
   * from the host (service ports on Docker Desktop, since we don't auto-publish
   * them today).
   */
  url?: string;
  /** Whether the URL is reachable from the host on the current engine. */
  reachable: boolean;
}

export interface BoxEndpoints {
  /** Bare hostname/IP for the box — `<container>.orb.local` on OrbStack, `127.0.0.1` otherwise. */
  domain: string;
  /** True when domain is the OrbStack auto-DNS (any in-container port works). */
  domainIsOrb: boolean;
  /** Ordered list of endpoints: VNC first (if enabled), then services in agentbox.yaml order. */
  endpoints: BoxEndpoint[];
}

/**
 * Build the box's user-facing network surface. Pure host-side: parses the
 * workspace's `agentbox.yaml` for service `ready_when.port` probes and combines
 * them with the known VNC URLs. No docker exec, no network — safe to call from
 * `agentbox list` in a tight loop.
 *
 * Missing or invalid `agentbox.yaml` is non-fatal: the VNC entry (if any) is
 * still returned. Engine drives reachability — OrbStack auto-routes
 * `<container>.orb.local:<port>` for any in-box port; other engines see only
 * what we explicitly publish via `docker run -p`, which today is just VNC.
 */
export async function getBoxEndpoints(
  record: BoxRecord,
  engine: DockerEngine,
): Promise<BoxEndpoints> {
  const domainIsOrb = engine === 'orbstack';
  const domain = domainIsOrb ? `${record.container}.orb.local` : '127.0.0.1';

  const endpoints: BoxEndpoint[] = [];

  if (record.vncEnabled && record.vncPassword) {
    const vncUrls = buildVncUrls(record, engine);
    const url = vncUrls.orbUrl ?? vncUrls.loopbackUrl;
    endpoints.push({
      kind: 'vnc',
      name: 'vnc',
      containerPort: VNC_CONTAINER_PORT,
      url,
      reachable: Boolean(url),
    });
  }

  try {
    const cfg = await loadConfig(join(record.workspacePath, 'agentbox.yaml'));
    for (const svc of cfg.services) {
      if (svc.readyWhen?.kind !== 'port') continue;
      const port = svc.readyWhen.port;
      if (domainIsOrb) {
        endpoints.push({
          kind: 'service',
          name: svc.name,
          containerPort: port,
          url: `http://${domain}:${String(port)}`,
          reachable: true,
        });
      } else {
        endpoints.push({
          kind: 'service',
          name: svc.name,
          containerPort: port,
          reachable: false,
        });
      }
    }
  } catch {
    // No agentbox.yaml (or invalid) — skip service endpoints. VNC entry, if
    // any, is unaffected.
  }

  return { domain, domainIsOrb, endpoints };
}
