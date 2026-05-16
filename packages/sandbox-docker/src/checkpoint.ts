import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { hashProjectPath, setConfigValue } from '@agentbox/config';
import type { BoxRecord } from './state.js';

export const CHECKPOINTS_ROOT = join(homedir(), '.agentbox', 'checkpoints');

export type CheckpointType = 'layered' | 'merged';

export interface CheckpointManifest {
  schema: 1;
  name: string;
  type: CheckpointType;
  /**
   * For a layered checkpoint, the older checkpoint refs this delta stacks on
   * (upper-most first, base-most last) — i.e. the chain the *source* box was
   * built from. `[]` for a merged checkpoint (self-contained) or a layered
   * checkpoint taken from a box that itself started from bare host code.
   */
  parents: string[];
  base: 'worktree' | 'workspace';
  sourceBoxId: string;
  sourceBoxName: string;
  createdAt: string;
}

export interface CheckpointInfo {
  name: string;
  /** Host dir `~/.agentbox/checkpoints/<project-hash>/<name>`. */
  dir: string;
  /** Host dir `<dir>/fs` — the captured layer (layered) or full tree (merged). */
  fsDir: string;
  manifest: CheckpointManifest;
}

/** Resolved lower spec a new box should mount when starting from a checkpoint. */
export interface CheckpointLowerSpec {
  type: CheckpointType;
  /** Host fs dirs, upper-most first. For `layered` the base lower is appended by the caller. */
  hostLowerDirs: string[];
  /** Checkpoint refs composing the chain, base-most last (for BoxRecord.checkpointSource). */
  chain: string[];
}

export function projectCheckpointsDir(projectRoot: string): string {
  return join(CHECKPOINTS_ROOT, hashProjectPath(projectRoot));
}

function checkpointDir(projectRoot: string, name: string): string {
  return join(projectCheckpointsDir(projectRoot), name);
}

async function readManifest(dir: string): Promise<CheckpointManifest | null> {
  try {
    const raw = await readFile(join(dir, 'manifest.json'), 'utf8');
    const m = JSON.parse(raw) as CheckpointManifest;
    if (m.schema !== 1) return null;
    return m;
  } catch {
    return null;
  }
}

export async function listCheckpoints(projectRoot: string): Promise<CheckpointInfo[]> {
  const root = projectCheckpointsDir(projectRoot);
  let entries: string[];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: CheckpointInfo[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    const manifest = await readManifest(dir);
    if (manifest) out.push({ name, dir, fsDir: join(dir, 'fs'), manifest });
  }
  out.sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt));
  return out;
}

export async function resolveCheckpoint(
  projectRoot: string,
  ref: string,
): Promise<CheckpointInfo | null> {
  const dir = checkpointDir(projectRoot, ref);
  const manifest = await readManifest(dir);
  if (!manifest) return null;
  return { name: ref, dir, fsDir: join(dir, 'fs'), manifest };
}

export async function removeCheckpoint(projectRoot: string, ref: string): Promise<boolean> {
  const dir = checkpointDir(projectRoot, ref);
  if (!(await readManifest(dir))) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Next `<boxName>-<n>` given the names already present. Monotonic per
 * box-name; gaps from deleted checkpoints are skipped (max+1, never
 * recycled). Pure — unit-tested directly.
 */
export function computeNextCheckpointName(existingNames: string[], boxName: string): string {
  const re = new RegExp(`^${boxName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const n of existingNames) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${boxName}-${String(max + 1)}`;
}

async function nextCheckpointName(projectRoot: string, boxName: string): Promise<string> {
  const existing = await listCheckpoints(projectRoot);
  return computeNextCheckpointName(
    existing.map((c) => c.name),
    boxName,
  );
}

function chainDepth(box: BoxRecord): number {
  return box.checkpointSource?.chain.length ?? 0;
}

export interface CreateCheckpointOptions {
  box: BoxRecord;
  projectRoot: string;
  name?: string;
  merged?: boolean;
  setDefault?: boolean;
  /** checkpoint.maxLayers — auto-merge when the source chain is at/over this. */
  maxLayers: number;
  onLog?: (line: string) => void;
}

/**
 * Capture a box's accumulated state as a project checkpoint.
 *
 *  - `layered`: copy the box's overlay write delta (`/upper/upper`, which now
 *    holds node_modules/build caches/env files) via a throwaway root container
 *    so overlay whiteouts/device nodes survive the copy onto the host fs.
 *  - `merged`: tar the box's merged `/workspace` (everything) into one flat
 *    tree, used later as a single sole lower.
 *
 * Merged is chosen when `--merged` is passed or the source box's checkpoint
 * chain is already `>= maxLayers` deep (caps the lowerdir stack).
 */
export async function createCheckpoint(opts: CreateCheckpointOptions): Promise<CheckpointInfo> {
  const log = opts.onLog ?? (() => {});
  const { box } = opts;

  const type: CheckpointType =
    opts.merged === true || chainDepth(box) >= opts.maxLayers ? 'merged' : 'layered';
  const name = opts.name ?? (await nextCheckpointName(opts.projectRoot, box.name));
  const dir = checkpointDir(opts.projectRoot, name);
  const fsDir = join(dir, 'fs');
  await mkdir(fsDir, { recursive: true });

  if (type === 'layered') {
    log(`capturing upper delta of ${box.container} -> ${name} (layered)`);
    // Run the copy as root inside a throwaway container mounting the box's
    // upper volume. fuse-overlayfs records file deletions as char-device 0:0
    // whiteouts; a host fs (APFS via the Docker bind) can't hold those, so we
    // translate them to AUFS-style `.wh.<name>` marker files, which
    // fuse-overlayfs equally honors when the dir is used as a lowerdir.
    // Opaque-dir markers are already `.wh..wh..opq` regular files (copied
    // as-is). cp's char-device failures are expected and ignored.
    const script = [
      'set -u',
      'cp -a /src/upper/. /dst/ 2>/dev/null || true',
      'cd /src/upper',
      'find . -type c 2>/dev/null | while IFS= read -r p; do',
      '  if [ "$(stat -c %t "$p")" = "0" ] && [ "$(stat -c %T "$p")" = "0" ]; then',
      '    d=$(dirname "$p"); b=$(basename "$p");',
      '    mkdir -p "/dst/$d"; rm -f "/dst/$p" 2>/dev/null || true;',
      '    : > "/dst/$d/.wh.$b";',
      '  fi',
      'done',
      'ls -A /dst >/dev/null',
    ].join('\n');
    const r = await execa(
      'docker',
      [
        'run',
        '--rm',
        '--user',
        '0:0',
        '-v',
        `${box.upperVolume}:/src:ro`,
        '-v',
        `${fsDir}:/dst`,
        box.image,
        'bash',
        '-lc',
        script,
      ],
      { reject: false },
    );
    if (r.exitCode !== 0) {
      throw new CheckpointError(`failed to copy upper layer for ${box.name}`, r.stdout, r.stderr);
    }
  } else {
    log(`capturing merged /workspace of ${box.container} -> ${name} (merged)`);
    const packed = await execa(
      'docker',
      ['exec', '--user', 'root', box.container, 'tar', '-C', '/workspace', '-cf', '-', '.'],
      { reject: false, encoding: 'buffer' },
    );
    if (packed.exitCode !== 0) {
      throw new CheckpointError(
        `failed to tar merged /workspace for ${box.name} (is the box running?)`,
        '',
        typeof packed.stderr === 'string'
          ? packed.stderr
          : (packed.stderr as Buffer).toString('utf8'),
      );
    }
    const extract = await execa('tar', ['-xf', '-', '-C', fsDir], {
      input: packed.stdout as Buffer,
      reject: false,
    });
    if (extract.exitCode !== 0) {
      throw new CheckpointError('tar extract on host failed', extract.stdout, extract.stderr);
    }
  }

  const base: 'worktree' | 'workspace' = (box.gitWorktrees ?? []).some((w) => w.kind === 'root')
    ? 'worktree'
    : 'workspace';
  const manifest: CheckpointManifest = {
    schema: 1,
    name,
    type,
    parents: type === 'layered' ? (box.checkpointSource?.chain ?? []) : [],
    base,
    sourceBoxId: box.id,
    sourceBoxName: box.name,
    createdAt: new Date().toISOString(),
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (opts.setDefault) {
    await setConfigValue('project', 'box.defaultCheckpoint', name, opts.projectRoot);
    log(`set project default checkpoint -> ${name}`);
  }

  return { name, dir, fsDir, manifest };
}

/**
 * Resolve the ordered host lower dirs a new box should stack when starting
 * from checkpoint `ref`. For `layered` the caller appends the base lower
 * (fresh worktree/workspace) after these; for `merged` these are the sole
 * lower.
 */
export async function resolveCheckpointLower(
  projectRoot: string,
  ref: string,
): Promise<CheckpointLowerSpec> {
  const head = await resolveCheckpoint(projectRoot, ref);
  if (!head) throw new CheckpointError(`checkpoint not found: ${ref}`, '', '');

  if (head.manifest.type === 'merged') {
    return { type: 'merged', hostLowerDirs: [head.fsDir], chain: [head.name] };
  }

  const hostLowerDirs = [head.fsDir];
  const chain = [head.name];
  for (const parentRef of head.manifest.parents) {
    const p = await resolveCheckpoint(projectRoot, parentRef);
    if (!p) {
      throw new CheckpointError(
        `checkpoint ${ref} references missing parent ${parentRef}`,
        '',
        '',
      );
    }
    hostLowerDirs.push(p.fsDir);
    chain.push(p.name);
  }
  return { type: 'layered', hostLowerDirs, chain };
}

export class CheckpointError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`${message}${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'CheckpointError';
  }
}
