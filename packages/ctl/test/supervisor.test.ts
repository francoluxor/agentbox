import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Supervisor } from '../src/supervisor.js';
import type { ServiceSpec } from '../src/config.js';

const NODE = process.execPath;

function spec(
  over: Partial<ServiceSpec> & { name: string; command: string | string[] },
): ServiceSpec {
  return {
    autostart: true,
    restart: 'on-failure',
    backoff: { initialMs: 10, maxMs: 50, factor: 2 },
    ...over,
  };
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('Supervisor', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ctl-sup-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a service and reports running state with a pid', async () => {
    const sup = new Supervisor({ workspace: dir, logDir: dir });
    await sup.init([
      spec({
        name: 'hello',
        command: [NODE, '-e', 'setInterval(()=>console.log("tick"),50)'],
      }),
    ]);
    const status = await waitFor(() => {
      const s = sup.list()[0]!;
      return s.state === 'running' ? s : null;
    });
    expect(status.pid).toBeTypeOf('number');
    await sup.stopAll();
  });

  it('restarts on crash under on-failure policy', async () => {
    const sup = new Supervisor({ workspace: dir, logDir: dir });
    await sup.init([
      spec({
        name: 'crashy',
        command: [NODE, '-e', 'process.exit(1)'],
      }),
    ]);
    const after = await waitFor(() => {
      const s = sup.list()[0]!;
      return s.restarts >= 2 ? s : null;
    }, 3000);
    expect(after.restarts).toBeGreaterThanOrEqual(2);
    await sup.stopAll();
  });

  it('honours restart: never', async () => {
    const sup = new Supervisor({ workspace: dir, logDir: dir });
    await sup.init([
      spec({
        name: 'one-shot',
        command: [NODE, '-e', 'process.exit(1)'],
        restart: 'never',
      }),
    ]);
    const final = await waitFor(() => {
      const s = sup.list()[0]!;
      return s.state === 'crashed' ? s : null;
    });
    expect(final.restarts).toBe(0);
    await sup.stopAll();
  });

  it('captures stdout into the log ring', async () => {
    const sup = new Supervisor({ workspace: dir, logDir: dir });
    await sup.init([
      spec({
        name: 'noisy',
        command: [NODE, '-e', 'console.log("hello"); setTimeout(()=>{}, 200)'],
        restart: 'never',
      }),
    ]);
    const lines = await waitFor(() => {
      const r = sup.get('noisy')!;
      const tail = r.tail(50);
      return tail.find((e) => e.stream === 'stdout' && e.line === 'hello') ? tail : null;
    });
    expect(lines.some((e) => e.line === 'hello')).toBe(true);
    await sup.stopAll();
  });

  it('reload diffs services and stops removed ones', async () => {
    const sup = new Supervisor({ workspace: dir, logDir: dir });
    await sup.init([
      spec({ name: 'a', command: [NODE, '-e', 'setInterval(()=>{},1000)'] }),
      spec({ name: 'b', command: [NODE, '-e', 'setInterval(()=>{},1000)'] }),
    ]);
    await waitFor(() => sup.list().every((s) => s.state === 'running') || null);

    const diff = await sup.reload([
      spec({ name: 'a', command: [NODE, '-e', 'setInterval(()=>{},1000)'] }),
      spec({ name: 'c', command: [NODE, '-e', 'setInterval(()=>{},1000)'] }),
    ]);
    expect(diff.removed).toEqual(['b']);
    expect(diff.added).toEqual(['c']);
    expect(diff.changed).toEqual([]);
    expect(sup.get('b')).toBeUndefined();
    await sup.stopAll();
  });
});
