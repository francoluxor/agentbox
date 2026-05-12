import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readState, recordBox, writeState, type BoxRecord } from '../src/state.js';

describe('state.ts', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentbox-state-test-'));
    file = join(dir, 'state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty state when file does not exist', async () => {
    const state = await readState(file);
    expect(state).toEqual({ version: 1, boxes: [] });
  });

  it('round-trips a single record', async () => {
    const box: BoxRecord = {
      id: 'a1b2c3d4',
      name: 'demo',
      container: 'agentbox-a1b2c3d4',
      image: 'agentbox/box:dev',
      workspacePath: '/tmp/ws',
      lowerPath: '/tmp/ws',
      upperVolume: 'agentbox-upper-a1b2c3d4',
      nodeModulesVolume: 'agentbox-nm-a1b2c3d4',
      snapshotDir: null,
      createdAt: '2026-05-12T12:00:00.000Z',
    };
    await recordBox(box, file);

    const reloaded = await readState(file);
    expect(reloaded.boxes).toEqual([box]);
  });

  it('replaces an existing record with the same id', async () => {
    const base: BoxRecord = {
      id: 'a1b2c3d4',
      name: 'old',
      container: 'agentbox-a1b2c3d4',
      image: 'agentbox/box:dev',
      workspacePath: '/tmp/ws',
      lowerPath: '/tmp/ws',
      upperVolume: 'agentbox-upper-a1b2c3d4',
      nodeModulesVolume: 'agentbox-nm-a1b2c3d4',
      snapshotDir: null,
      createdAt: '2026-05-12T12:00:00.000Z',
    };
    await recordBox(base, file);
    await recordBox({ ...base, name: 'new' }, file);

    const reloaded = await readState(file);
    expect(reloaded.boxes).toHaveLength(1);
    expect(reloaded.boxes[0]?.name).toBe('new');
  });

  it('rejects malformed state', async () => {
    await writeState({ version: 999, boxes: [] } as unknown as Parameters<typeof writeState>[0], file);
    await expect(readState(file)).rejects.toThrow(/unrecognized state file shape/);
  });
});
