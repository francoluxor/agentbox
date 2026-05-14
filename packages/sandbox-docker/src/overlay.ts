import { execInBox } from './docker.js';

export interface MountOverlayResult {
  upperWritePath: string;
}

export interface NestedWorktreeBind {
  /** Path inside the container the nested worktree should appear at (e.g. /workspace/app). */
  containerPath: string;
  /** Source path inside the container where the worktree was bind-mounted at run time (e.g. /agentbox-worktrees/app). */
  mountFromPath: string;
}

export interface MountOverlayOptions {
  /**
   * Sub-paths under /workspace that should reflect a separate host worktree
   * directly (writes go through to the host, bypassing the FUSE upper layer).
   * Applied as `mount --bind` after fuse-overlayfs is up so the overlay
   * doesn't hide them.
   */
  nestedWorktrees?: NestedWorktreeBind[];
}

// The `vscode` user provided by mcr.microsoft.com/devcontainers/base:ubuntu.
// The overlay is mounted as root (FUSE requires it), so without squashing the
// kernel sees overlay files with their original host UIDs (e.g. 501 on macOS)
// and refuses writes from vscode under `default_permissions`. Squashing reports
// everything as owned by vscode so interactive shells can write naturally.
const BOX_USER_UID = 1000;
const BOX_USER_GID = 1000;

/**
 * Mount the FUSE overlay inside a running box:
 *
 *     /workspace = overlay(lower=/host-src, upper=/upper/upper, work=/upper/work)
 *
 * Runs as root inside the container so it can attach to /dev/fuse. If
 * `nestedWorktrees` is provided, each entry is layered on top of /workspace
 * via `mount --bind` after the FUSE overlay is up — bind-after-overlay is the
 * only ordering that survives, since fuse-overlayfs hides any pre-existing
 * mounts under /workspace.
 */
export async function mountOverlay(
  container: string,
  opts: MountOverlayOptions = {},
): Promise<MountOverlayResult> {
  const mountOpts = [
    'lowerdir=/host-src',
    'upperdir=/upper/upper',
    'workdir=/upper/work',
    `squash_to_uid=${String(BOX_USER_UID)}`,
    `squash_to_gid=${String(BOX_USER_GID)}`,
  ].join(',');

  const lines = [
    'set -euo pipefail',
    'mkdir -p /upper/upper /upper/work /workspace',
    // Idempotent — if a previous attempt left a stale overlay, unmount first.
    'mountpoint -q /workspace && fusermount3 -u /workspace || true',
    `fuse-overlayfs -o ${mountOpts} /workspace`,
    'mountpoint -q /workspace',
  ];

  for (const w of opts.nestedWorktrees ?? []) {
    // The bind target lives inside the just-mounted FUSE overlay; make sure
    // the directory exists (mkdir-on-overlay materializes it in /upper). Then
    // unmount any previous bind (idempotent re-runs from startBox) and rebind.
    lines.push(
      `mkdir -p ${shellQuote(w.containerPath)}`,
      `mountpoint -q ${shellQuote(w.containerPath)} && umount ${shellQuote(w.containerPath)} || true`,
      `mount --bind ${shellQuote(w.mountFromPath)} ${shellQuote(w.containerPath)}`,
      `mountpoint -q ${shellQuote(w.containerPath)}`,
    );
  }

  const result = await execInBox(container, ['bash', '-lc', lines.join('\n')], { user: 'root' });
  if (result.exitCode !== 0) {
    throw new OverlayError(
      `failed to mount FUSE overlay in ${container}`,
      result.stdout,
      result.stderr,
    );
  }
  return { upperWritePath: '/upper/upper' };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface OverlayCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Four-assertion smoke test that proves the overlay actually behaves like an
 * overlay: writes go to upper, lower stays untouched.
 */
export async function verifyOverlay(container: string): Promise<OverlayCheck[]> {
  const sentinel = '.agentbox-overlay-check';
  const checks: OverlayCheck[] = [];

  // 1. lower is visible through the overlay.
  const ls = await execInBox(container, ['bash', '-lc', `ls -A /workspace | head -1`], {
    user: 'root',
  });
  checks.push({
    name: 'workspace lists lower contents',
    ok: ls.exitCode === 0,
    detail: ls.exitCode === 0 ? `first entry: ${ls.stdout.trim() || '(empty)'}` : ls.stderr.trim(),
  });

  // 2. write into the overlay.
  const write = await execInBox(container, ['bash', '-lc', `touch /workspace/${sentinel}`], {
    user: 'root',
  });
  checks.push({
    name: 'write through overlay succeeds',
    ok: write.exitCode === 0,
    detail: write.exitCode === 0 ? `created /workspace/${sentinel}` : write.stderr.trim(),
  });

  // 3. write landed in the upper volume.
  const upper = await execInBox(container, ['bash', '-lc', `test -f /upper/upper/${sentinel}`], {
    user: 'root',
  });
  checks.push({
    name: 'write lands in /upper (cow target)',
    ok: upper.exitCode === 0,
    detail:
      upper.exitCode === 0
        ? `/upper/upper/${sentinel} exists`
        : `expected /upper/upper/${sentinel} to exist`,
  });

  // 4. lower remained untouched.
  const lower = await execInBox(container, ['bash', '-lc', `test ! -e /host-src/${sentinel}`], {
    user: 'root',
  });
  checks.push({
    name: 'lower (/host-src) untouched',
    ok: lower.exitCode === 0,
    detail:
      lower.exitCode === 0
        ? `/host-src/${sentinel} does not exist`
        : `/host-src/${sentinel} leaked into the lower layer`,
  });

  // Tidy up the sentinel so subsequent commands don't see it.
  await execInBox(container, ['bash', '-lc', `rm -f /workspace/${sentinel}`], { user: 'root' });

  return checks;
}

export class OverlayError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'OverlayError';
  }
}
