export const DEFAULT_RELAY_PORT = 8787;
export const RELAY_CONTAINER_NAME = 'agentbox-relay';
export const RELAY_NETWORK_NAME = 'agentbox-net';
export const RELAY_IMAGE_REF = 'agentbox/relay:dev';
export const RELAY_EVENT_RING_SIZE = 1000;

export interface BoxRegistration {
  boxId: string;
  token: string;
  name: string;
  registeredAt: string;
}

export interface RelayEvent {
  /** Monotonic per-relay-process id, useful for `since=` polling. */
  id: number;
  /** Box id that posted the event. */
  boxId: string;
  /** Free-form event type, e.g. 'service-state', 'task-state', 'notify'. */
  type: string;
  /** ISO-8601 timestamp the relay assigned on receipt. */
  receivedAt: string;
  /** ISO-8601 client-supplied timestamp, if any. */
  ts?: string;
  /** Arbitrary JSON payload. */
  payload?: unknown;
}

export interface PostEventBody {
  type: string;
  ts?: string;
  payload?: unknown;
}

export interface PostRpcBody {
  method: string;
  params?: unknown;
}

export interface RegisterBoxBody {
  boxId: string;
  token: string;
  name: string;
}
