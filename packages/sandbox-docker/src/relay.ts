import { randomBytes } from 'node:crypto';
import {
  DEFAULT_RELAY_PORT,
  RELAY_CONTAINER_NAME,
  RELAY_IMAGE_REF,
  RELAY_NETWORK_NAME,
} from '@agentbox/relay';
import {
  containerExists,
  containerIsRunning,
  ensureNetwork,
  execInBox,
  inspectContainerStatus,
  removeContainer,
  runRelay,
  startContainer,
} from './docker.js';
import { ensureImage, RELAY_DOCKERFILE_PATH } from './image.js';

export interface RelayEndpoint {
  /** In-network URL boxes use to reach the relay (resolved by docker DNS). */
  url: string;
  containerName: string;
  network: string;
}

export interface EnsureRelayOptions {
  onLog?: (line: string) => void;
}

const ENDPOINT: RelayEndpoint = {
  url: `http://${RELAY_CONTAINER_NAME}:${String(DEFAULT_RELAY_PORT)}`,
  containerName: RELAY_CONTAINER_NAME,
  network: RELAY_NETWORK_NAME,
};

/**
 * Idempotently bring up the host relay container on the agentbox-net network.
 * Builds the relay image if missing, creates the network if missing, starts
 * the container (or `docker start`s a stopped one). Best-effort: returns the
 * endpoint regardless of success — call sites treat failure as "relay not
 * reachable" rather than a fatal error.
 */
export async function ensureRelay(opts: EnsureRelayOptions = {}): Promise<RelayEndpoint> {
  const log = opts.onLog ?? (() => {});

  await ensureNetwork(RELAY_NETWORK_NAME);
  const { built } = await ensureImage(RELAY_IMAGE_REF, {
    dockerfile: RELAY_DOCKERFILE_PATH,
    onProgress: (line) => log(`[relay-image] ${line}`),
  });
  if (built) log(`built image ${RELAY_IMAGE_REF}`);

  const status = await inspectContainerStatus(RELAY_CONTAINER_NAME);
  if (status === 'running') {
    return ENDPOINT;
  }
  if (status === 'paused' || status === 'stopped') {
    // 'stopped' covers Docker's exited/dead/created/restarting too — try start
    // first, fall through to recreate if that fails.
    try {
      await startContainer(RELAY_CONTAINER_NAME);
      log(`started existing relay container ${RELAY_CONTAINER_NAME}`);
      return ENDPOINT;
    } catch {
      // If start fails (e.g. image changed underneath, or the container is in
      // 'dead'), remove and recreate.
      await removeContainer(RELAY_CONTAINER_NAME);
    }
  }
  if (await containerExists(RELAY_CONTAINER_NAME)) {
    // Defensive: status said missing but a stale container still lingers.
    await removeContainer(RELAY_CONTAINER_NAME);
  }

  await runRelay({
    name: RELAY_CONTAINER_NAME,
    image: RELAY_IMAGE_REF,
    network: RELAY_NETWORK_NAME,
    internalPort: DEFAULT_RELAY_PORT,
  });
  log(`launched relay container ${RELAY_CONTAINER_NAME} on ${RELAY_NETWORK_NAME}`);
  return ENDPOINT;
}

export function generateRelayToken(): string {
  return randomBytes(32).toString('hex');
}

export interface RegisterBoxArgs {
  boxId: string;
  token: string;
  name: string;
}

/**
 * Register a box's bearer token with the running relay. The relay's
 * /admin/register-box endpoint is network-internal, so we shell into the
 * relay container itself to POST to localhost — saves us publishing a host
 * port and adds zero network surface.
 */
export async function registerBoxWithRelay(args: RegisterBoxArgs): Promise<void> {
  if (!(await containerIsRunning(RELAY_CONTAINER_NAME))) return;
  const result = await execInBox(RELAY_CONTAINER_NAME, [
    'agentbox-relay',
    'register',
    '--id',
    args.boxId,
    '--token',
    args.token,
    '--name',
    args.name,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `relay register failed (exit ${String(result.exitCode)}): ${result.stderr || result.stdout}`,
    );
  }
}

export async function forgetBoxFromRelay(boxId: string): Promise<void> {
  if (!(await containerIsRunning(RELAY_CONTAINER_NAME))) return;
  await execInBox(RELAY_CONTAINER_NAME, ['agentbox-relay', 'forget', '--id', boxId]);
}

export interface BoxWithToken {
  id: string;
  name: string;
  relayToken?: string;
}

/**
 * Re-push every known (id, token) to the relay's in-memory registry. Called
 * after `ensureRelay()` so a fresh / restarted relay learns about boxes that
 * were created in a previous CLI invocation.
 */
export async function rehydrateRelayRegistry(boxes: BoxWithToken[]): Promise<void> {
  for (const b of boxes) {
    if (!b.relayToken) continue;
    try {
      await registerBoxWithRelay({ boxId: b.id, token: b.relayToken, name: b.name });
    } catch {
      // best-effort
    }
  }
}

export { RELAY_CONTAINER_NAME, RELAY_NETWORK_NAME, RELAY_IMAGE_REF, DEFAULT_RELAY_PORT };
