export type ServiceState = 'starting' | 'running' | 'crashed' | 'backoff' | 'stopped';

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  pid: number | null;
  restarts: number;
  lastExitCode: number | null;
  startedAt: string | null;
  nextRetryAt: string | null;
  command: string;
}

export interface LogEvent {
  service: string;
  ts: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface ReloadResult {
  added: string[];
  removed: string[];
  changed: string[];
}

export type CtlRequest =
  | { op: 'status' }
  | { op: 'logs'; service: string; tail?: number; follow?: boolean }
  | { op: 'restart'; service: string }
  | { op: 'stop'; service: string }
  | { op: 'start'; service: string }
  | { op: 'reload' }
  | { op: 'ping' };

export type CtlResponse = { ok: true; data: unknown } | { ok: false; error: string };

export const DEFAULT_SOCKET_PATH = '/run/agentbox/ctl.sock';
export const DEFAULT_CONFIG_PATH = '/workspace/agentbox.yaml';
export const DEFAULT_LOG_DIR = '/var/log/agentbox';
