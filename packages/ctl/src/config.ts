import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export type RestartPolicy = 'always' | 'on-failure' | 'never';

export interface BackoffSpec {
  initialMs: number;
  maxMs: number;
  factor: number;
}

export interface ServiceSpec {
  name: string;
  command: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  autostart: boolean;
  restart: RestartPolicy;
  backoff: BackoffSpec;
}

export interface CtlConfig {
  services: ServiceSpec[];
}

export const DEFAULT_BACKOFF: BackoffSpec = {
  initialMs: 500,
  maxMs: 30_000,
  factor: 2,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEnv(raw: unknown, where: string): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${where}.env must be a mapping of string → string`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      throw new ConfigError(`${where}.env.${k} must be a scalar`);
    }
    out[k] = String(v);
  }
  return out;
}

function parseCommand(raw: unknown, where: string): string | string[] {
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) {
      throw new ConfigError(`${where}.command must not be empty`);
    }
    return raw;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new ConfigError(`${where}.command array must not be empty`);
    }
    const argv: string[] = [];
    for (const [i, item] of raw.entries()) {
      if (typeof item !== 'string') {
        throw new ConfigError(`${where}.command[${String(i)}] must be a string`);
      }
      argv.push(item);
    }
    return argv;
  }
  throw new ConfigError(`${where}.command must be a string or array of strings`);
}

function parseRestart(raw: unknown, where: string): RestartPolicy {
  if (raw === undefined) return 'on-failure';
  if (raw === 'always' || raw === 'on-failure' || raw === 'never') return raw;
  throw new ConfigError(`${where}.restart must be one of: always, on-failure, never`);
}

const BACKOFF_KEYS = new Set(['initial_ms', 'max_ms', 'factor']);

function parseBackoff(raw: unknown, where: string): BackoffSpec {
  if (raw === undefined) return { ...DEFAULT_BACKOFF };
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${where}.backoff must be a mapping`);
  }
  rejectUnknownKeys(raw, BACKOFF_KEYS, `${where}.backoff`);
  const initialMs = parseNonNegativeInt(
    raw.initial_ms,
    `${where}.backoff.initial_ms`,
    DEFAULT_BACKOFF.initialMs,
  );
  const maxMs = parseNonNegativeInt(raw.max_ms, `${where}.backoff.max_ms`, DEFAULT_BACKOFF.maxMs);
  const factor = parseFactor(raw.factor, `${where}.backoff.factor`, DEFAULT_BACKOFF.factor);
  if (maxMs < initialMs) {
    throw new ConfigError(`${where}.backoff.max_ms must be >= initial_ms`);
  }
  return { initialMs, maxMs, factor };
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ConfigError(`${where} has unknown key "${key}"`);
    }
  }
}

function parseNonNegativeInt(raw: unknown, where: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new ConfigError(`${where} must be a non-negative number`);
  }
  return Math.floor(raw);
}

function parseFactor(raw: unknown, where: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    throw new ConfigError(`${where} must be a number >= 1`);
  }
  return raw;
}

const SERVICE_KEYS = new Set(['command', 'cwd', 'env', 'autostart', 'restart', 'backoff']);

function parseService(name: string, raw: unknown): ServiceSpec {
  const where = `services.${name}`;
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${where} must be a mapping`);
  }
  rejectUnknownKeys(raw, SERVICE_KEYS, where);
  const command = parseCommand(raw.command, where);
  const cwd = raw.cwd === undefined ? undefined : assertString(raw.cwd, `${where}.cwd`);
  const env = parseEnv(raw.env, where);
  const autostart =
    raw.autostart === undefined ? true : assertBool(raw.autostart, `${where}.autostart`);
  const restart = parseRestart(raw.restart, where);
  const backoff = parseBackoff(raw.backoff, where);
  return { name, command, cwd, env, autostart, restart, backoff };
}

function assertString(raw: unknown, where: string): string {
  if (typeof raw !== 'string') throw new ConfigError(`${where} must be a string`);
  return raw;
}

function assertBool(raw: unknown, where: string): boolean {
  if (typeof raw !== 'boolean') throw new ConfigError(`${where} must be a boolean`);
  return raw;
}

const TOP_LEVEL_KEYS = new Set(['services']);

export function parseConfig(text: string): CtlConfig {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new ConfigError(`yaml parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (doc === null || doc === undefined) return { services: [] };
  if (!isPlainObject(doc)) {
    throw new ConfigError('top-level config must be a mapping');
  }
  rejectUnknownKeys(doc, TOP_LEVEL_KEYS, '(root)');
  const servicesRaw = doc.services;
  if (servicesRaw === undefined || servicesRaw === null) return { services: [] };
  if (!isPlainObject(servicesRaw)) {
    throw new ConfigError('services must be a mapping of name → service');
  }
  const services: ServiceSpec[] = [];
  for (const [name, raw] of Object.entries(servicesRaw)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new ConfigError(`service name "${name}" must match [A-Za-z0-9_-]+`);
    }
    services.push(parseService(name, raw));
  }
  return { services };
}

export async function loadConfig(path: string): Promise<CtlConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { services: [] };
    }
    throw err;
  }
  return parseConfig(text);
}

export function describeCommand(cmd: string | string[]): string {
  return Array.isArray(cmd) ? cmd.join(' ') : cmd;
}
