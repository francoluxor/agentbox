import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXCLUDE_DIRS, findExcludedDirs } from '../src/snapshot.js';

describe('findExcludedDirs', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentbox-snapshot-test-'));

    // a tree like:
    //   root/
    //     src/
    //       lib.ts
    //     node_modules/        <- excluded
    //       react/
    //         index.js
    //     packages/
    //       a/
    //         dist/            <- excluded
    //           bundle.js
    //         src/
    //           index.ts
    //         node_modules/    <- excluded (nested)
    //           dep/index.js
    //     keep/
    //       data.txt
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/lib.ts'), 'export {};\n');
    await mkdir(join(root, 'node_modules/react'), { recursive: true });
    await writeFile(join(root, 'node_modules/react/index.js'), '');
    await mkdir(join(root, 'packages/a/dist'), { recursive: true });
    await writeFile(join(root, 'packages/a/dist/bundle.js'), '');
    await mkdir(join(root, 'packages/a/src'), { recursive: true });
    await writeFile(join(root, 'packages/a/src/index.ts'), '');
    await mkdir(join(root, 'packages/a/node_modules/dep'), { recursive: true });
    await writeFile(join(root, 'packages/a/node_modules/dep/index.js'), '');
    await mkdir(join(root, 'keep'), { recursive: true });
    await writeFile(join(root, 'keep/data.txt'), 'hello');
  });

  afterAll(async () => {
    // Best-effort cleanup; tmp dirs get reaped by the OS anyway.
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });

  it('finds excluded dirs at any depth without descending into them', async () => {
    const matches = await findExcludedDirs(root);
    const rel = matches.map((p) => p.slice(root.length + 1)).sort();
    expect(rel).toEqual([
      'node_modules',
      'packages/a/dist',
      'packages/a/node_modules',
    ]);
  });

  it('does not return non-excluded dirs', async () => {
    const matches = await findExcludedDirs(root);
    expect(matches.every((p) => !p.includes('/src') && !p.includes('/keep'))).toBe(true);
  });

  it('respects a custom excluded set', async () => {
    const matches = await findExcludedDirs(root, new Set(['keep']));
    const rel = matches.map((p) => p.slice(root.length + 1));
    expect(rel).toEqual(['keep']);
  });

  it('default set contains the expected platform-dependent dirs', () => {
    for (const name of ['node_modules', 'dist', '.next', '.turbo', '__pycache__']) {
      expect(EXCLUDE_DIRS.has(name)).toBe(true);
    }
  });
});
