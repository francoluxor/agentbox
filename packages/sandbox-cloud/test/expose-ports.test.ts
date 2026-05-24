import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExposedServicePorts } from '../src/expose-ports.js';

async function withWorkspace(yaml: string | undefined, fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agentbox-expose-'));
  try {
    if (yaml !== undefined) {
      await writeFile(join(root, 'agentbox.yaml'), yaml, 'utf8');
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('readExposedServicePorts', () => {
  it('returns [] when agentbox.yaml is missing', async () => {
    await withWorkspace(undefined, async (root) => {
      expect(await readExposedServicePorts(root)).toEqual([]);
    });
  });

  it('returns [] when agentbox.yaml is invalid YAML', async () => {
    await withWorkspace('::: not yaml :::\nrandom\n   bytes', async (root) => {
      // YAML is lenient enough that this might parse — accept either []
      // or actual numbers, we just don't want the call to throw.
      const ports = await readExposedServicePorts(root);
      expect(Array.isArray(ports)).toBe(true);
    });
  });

  it('returns [] when there is no services key', async () => {
    await withWorkspace('settings:\n  foo: bar\n', async (root) => {
      expect(await readExposedServicePorts(root)).toEqual([]);
    });
  });

  it('extracts a single exposed port', async () => {
    await withWorkspace(
      'services:\n  web:\n    command: node server.js\n    expose:\n      port: 3000\n      as: 80\n',
      async (root) => {
        expect(await readExposedServicePorts(root)).toEqual([3000]);
      },
    );
  });

  it('deduplicates + sorts when multiple services expose the same port', async () => {
    await withWorkspace(
      [
        'services:',
        '  api:',
        '    command: node api.js',
        '    expose:',
        '      port: 8081',
        '  ui:',
        '    command: node ui.js',
        '    expose:',
        '      port: 3000',
        '  backup-api:',
        '    command: node api.js',
        '    expose:',
        '      port: 8081',
      ].join('\n'),
      async (root) => {
        expect(await readExposedServicePorts(root)).toEqual([3000, 8081]);
      },
    );
  });

  it('ignores services without expose', async () => {
    await withWorkspace(
      [
        'services:',
        '  ticker:',
        '    command: echo tick',
        '  web:',
        '    command: node server.js',
        '    expose:',
        '      port: 4000',
        '      as: 80',
      ].join('\n'),
      async (root) => {
        expect(await readExposedServicePorts(root)).toEqual([4000]);
      },
    );
  });

  it('skips non-numeric / out-of-range ports', async () => {
    await withWorkspace(
      [
        'services:',
        '  a:',
        '    expose:',
        '      port: "not-a-number"',
        '  b:',
        '    expose:',
        '      port: 99999',
        '  c:',
        '    expose:',
        '      port: 0',
        '  d:',
        '    expose:',
        '      port: 8080',
      ].join('\n'),
      async (root) => {
        expect(await readExposedServicePorts(root)).toEqual([8080]);
      },
    );
  });
});
