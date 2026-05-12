import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseConfig } from '../src/config.js';

// The schema lives outside src/, so resolve via the test file location.
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '..', 'schema', 'agentbox.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

interface Fixture {
  name: string;
  yaml: string;
  // `runtimeOnly` are the cross-field rules JSON Schema can't express (e.g.
  // max_ms >= initial_ms). The runtime validator rejects them, the schema
  // accepts them. Those rows are documented here but skipped from the agreement
  // assertion.
  runtimeOnly?: true;
}

const VALID: Fixture[] = [
  { name: 'empty doc', yaml: '' },
  { name: 'empty services map', yaml: 'services: {}' },
  {
    name: 'minimal shell-string service',
    yaml: `services:\n  web:\n    command: pnpm dev\n`,
  },
  {
    name: 'argv command + cwd + env + restart + backoff',
    yaml: `
services:
  worker:
    command: ["node", "worker.js"]
    cwd: apps/worker
    env:
      LOG_LEVEL: debug
      PORT: 4000
      VERBOSE: true
    restart: always
    autostart: false
    backoff:
      initial_ms: 1000
      max_ms: 60000
      factor: 3
`,
  },
];

const INVALID: Fixture[] = [
  { name: 'empty command string', yaml: `services:\n  web:\n    command: ""\n` },
  { name: 'empty argv', yaml: `services:\n  web:\n    command: []\n` },
  { name: 'argv element not a string', yaml: `services:\n  web:\n    command: ["node", 42]\n` },
  { name: 'missing command', yaml: `services:\n  web:\n    cwd: apps/web\n` },
  {
    name: 'unknown restart enum',
    yaml: `services:\n  web:\n    command: foo\n    restart: maybe\n`,
  },
  {
    name: 'env value is an object',
    yaml: `services:\n  web:\n    command: foo\n    env:\n      K:\n        nested: 1\n`,
  },
  {
    name: 'service name has spaces',
    yaml: `services:\n  "bad name":\n    command: foo\n`,
  },
  {
    name: 'unknown top-level key',
    yaml: `extra: 1\nservices:\n  web:\n    command: foo\n`,
  },
  {
    name: 'unknown service key',
    yaml: `services:\n  web:\n    command: foo\n    restartt: always\n`,
  },
  {
    name: 'unknown backoff key',
    yaml: `services:\n  web:\n    command: foo\n    backoff:\n      jitter_ms: 100\n`,
  },
  {
    name: 'autostart wrong type',
    yaml: `services:\n  web:\n    command: foo\n    autostart: yes-please\n`,
  },
  {
    name: 'factor < 1',
    yaml: `services:\n  web:\n    command: foo\n    backoff:\n      factor: 0.5\n`,
  },
  // Cross-field rule the schema cannot express.
  {
    name: 'max_ms < initial_ms (validator-only)',
    yaml: `services:\n  web:\n    command: foo\n    backoff:\n      initial_ms: 5000\n      max_ms: 100\n`,
    runtimeOnly: true,
  },
];

function runtimeAccepts(yaml: string): boolean {
  try {
    parseConfig(yaml);
    return true;
  } catch {
    return false;
  }
}

function schemaAccepts(yaml: string): boolean {
  const doc = parseYaml(yaml);
  return validate(doc ?? {});
}

describe('JSON Schema ↔ runtime validator agreement', () => {
  for (const f of VALID) {
    it(`accepts: ${f.name}`, () => {
      expect(runtimeAccepts(f.yaml), 'runtime rejected a valid fixture').toBe(true);
      expect(schemaAccepts(f.yaml), 'schema rejected a valid fixture').toBe(true);
    });
  }

  for (const f of INVALID) {
    if (f.runtimeOnly) {
      it(`runtime-only reject: ${f.name}`, () => {
        expect(runtimeAccepts(f.yaml)).toBe(false);
        // Schema accepts — documented gap (cross-field rule).
        expect(schemaAccepts(f.yaml)).toBe(true);
      });
      continue;
    }
    it(`rejects: ${f.name}`, () => {
      expect(runtimeAccepts(f.yaml), 'runtime accepted an invalid fixture').toBe(false);
      expect(schemaAccepts(f.yaml), 'schema accepted an invalid fixture').toBe(false);
    });
  }
});
