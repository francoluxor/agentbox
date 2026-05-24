import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloudBackend, CloudHandle } from '@agentbox/core';
import { detectGitRepos } from '@agentbox/sandbox-core';
import { bashScript, quoteShellArgv } from './shell.js';

/**
 * Seed `/workspace` inside a cloud sandbox from the host workspace. Mirrors
 * what `seedWorkspace` does for the Docker provider, adapted for the cloud
 * channel (`backend.uploadFile` + `backend.exec`):
 *
 *   - Git workspace: `git bundle create --all` on the host, upload the bundle,
 *     `git clone` it inside the sandbox, repoint `origin`, check out the
 *     per-box branch `agentbox/<box-name>`. Repeats for every nested repo
 *     (1st-level subdir with its own `.git/`) so monorepos seed correctly.
 *   - Non-git workspace: tar the host workspace, upload, extract.
 *
 * Host-uncommitted-carry-over (stash + untracked) is the remaining gap
 * tracked in Phase 6.
 */
export interface SeedCloudWorkspaceArgs {
  backend: CloudBackend;
  handle: CloudHandle;
  /** Absolute host path the user passed via `-w`. */
  workspacePath: string;
  /** Branch name to check out inside the sandbox (`agentbox/<box-name>`). */
  branch: string;
  /** In-sandbox destination; defaults to `/workspace`. */
  workspaceDir?: string;
  onLog?: (line: string) => void;
}

export interface SeedCloudWorkspaceResult {
  /** True when a git repo was found at the workspace root and a bundle was used. */
  fromGit: boolean;
  /** Resolved branch (matches `branch` arg). */
  branch: string;
}

const WORKSPACE_DIR_DEFAULT = '/workspace';

export async function seedCloudWorkspace(
  args: SeedCloudWorkspaceArgs,
): Promise<SeedCloudWorkspaceResult> {
  const workspaceDir = args.workspaceDir ?? WORKSPACE_DIR_DEFAULT;
  const log = args.onLog ?? (() => {});
  const repos = await detectGitRepos(args.workspacePath);
  const root = repos.find((r) => r.kind === 'root');
  const nested = repos.filter((r) => r.kind === 'nested');

  if (root) {
    log(
      nested.length > 0
        ? `seeding /workspace from git bundle (+${String(nested.length)} nested repo${nested.length === 1 ? '' : 's'})`
        : 'seeding /workspace from git bundle',
    );
    await seedFromGitBundle({
      backend: args.backend,
      handle: args.handle,
      hostRepo: root.hostMainRepo,
      branch: args.branch,
      workspaceDir,
    });
    // Each nested repo gets its own bundle + clone at /workspace/<rel>. We
    // do these after the root clone because the root clone wipes
    // /workspace; a nested dir created during the root checkout (if
    // tracked) would be replaced when we clone over it.
    for (const r of nested) {
      const sub = `${workspaceDir}/${r.relPathFromWorkspace}`;
      log(`seeding nested repo ${r.relPathFromWorkspace} from git bundle`);
      await seedFromGitBundle({
        backend: args.backend,
        handle: args.handle,
        hostRepo: r.hostMainRepo,
        branch: args.branch,
        workspaceDir: sub,
      });
    }
    return { fromGit: true, branch: args.branch };
  }

  log('seeding /workspace from workspace tarball (no git detected)');
  await seedFromTar({
    backend: args.backend,
    handle: args.handle,
    hostDir: args.workspacePath,
    workspaceDir,
  });
  return { fromGit: false, branch: args.branch };
}

interface SeedFromGitBundleArgs {
  backend: CloudBackend;
  handle: CloudHandle;
  hostRepo: string;
  branch: string;
  workspaceDir: string;
}

/**
 * Temporary host ref used to carry the `git stash create` commit into the
 * bundle so the in-sandbox repo can apply it. Lives only for the duration
 * of one `git bundle create` invocation — set, bundle, delete. Lands inside
 * the cloned repo as `refs/remotes/origin/<this name>`, which we delete
 * after applying the stash so it doesn't pollute branch lists.
 */
const STASH_CARRYOVER_REF = 'refs/agentbox-carryover/stash';
const REMOTE_UNTRACKED_TAR = '/tmp/agentbox-carryover-untracked.tar.gz';

async function seedFromGitBundle(args: SeedFromGitBundleArgs): Promise<void> {
  const stage = await mkdtemp(join(tmpdir(), 'agentbox-bundle-'));
  const bundlePath = join(stage, 'workspace.bundle');
  const untrackedTarPath = join(stage, 'untracked.tar.gz');
  // Per-repo carry-over (mirrors `collectRepoCarryOver` from sandbox-docker):
  //   - `git stash create` captures every staged + tracked-modified change
  //     (including deletes/renames) as a one-off commit.
  //   - untracked files get tarred separately because `stash create` (no -u
  //     option) doesn't capture them.
  // The stash commit travels in the bundle via a temp ref the host owns
  // for the duration of `git bundle create`. The untracked tar uploads on
  // the side and the in-sandbox script untars it after the clone.
  const stashSha = await safeStashCreate(args.hostRepo);
  const untrackedSize = await maybeBuildUntrackedTar(args.hostRepo, untrackedTarPath);
  let stashRefCreated = false;
  try {
    if (stashSha) {
      const ref = await execa(
        'git',
        ['-C', args.hostRepo, 'update-ref', STASH_CARRYOVER_REF, stashSha],
        { reject: false },
      );
      stashRefCreated = ref.exitCode === 0;
    }
    // Default: `--all` captures every ref + full history so the sandbox gets
    // a real clone with the user's local commits and tags. Monorepos with
    // deep history make that a slow + big upload — opt out via
    // `AGENTBOX_BUNDLE_DEPTH=N` to ship only the last N commits of HEAD
    // (shallow clone semantics; `git push` from inside the box still works
    // because the remote knows the merge base). 0 / empty / non-numeric →
    // full history. The stash ref (if any) is included explicitly so it
    // rides along with either bundle mode.
    const depthRaw = process.env['AGENTBOX_BUNDLE_DEPTH'];
    const depth = depthRaw ? Number.parseInt(depthRaw, 10) : NaN;
    const bundleArgs: string[] = ['-C', args.hostRepo, 'bundle', 'create', bundlePath];
    if (Number.isFinite(depth) && depth > 0) {
      bundleArgs.push(`--depth=${String(depth)}`, 'HEAD');
    } else {
      bundleArgs.push('--all');
    }
    if (stashRefCreated) bundleArgs.push(STASH_CARRYOVER_REF);
    await execa('git', bundleArgs);
    if (stashRefCreated) {
      await execa('git', ['-C', args.hostRepo, 'update-ref', '-d', STASH_CARRYOVER_REF], {
        reject: false,
      });
      stashRefCreated = false;
    }
    const remoteUrl = await readOriginUrl(args.hostRepo);
    const remoteBundle = '/tmp/agentbox-workspace.bundle';
    await args.backend.uploadFile(args.handle, bundlePath, remoteBundle);
    if (untrackedSize > 0) {
      await args.backend.uploadFile(args.handle, untrackedTarPath, REMOTE_UNTRACKED_TAR);
    }
    const setOrigin = remoteUrl
      ? `git -C ${quoteShellArgv([args.workspaceDir])} remote set-url origin ${quoteShellArgv([remoteUrl])}`
      : ': # no host origin to copy';
    // Clone from the bundle (the bundle stands in for a remote), then repoint
    // `origin` to the real upstream so future fetch/push target the actual
    // remote — `git push` itself will travel back through the host relay in a
    // later phase. Finally check out the per-box branch from current HEAD.
    // /workspace lives at the root in the snapshot — root-owned by default
    // (Dockerfile.box never chowns it). The sandbox runs non-root, so the
    // dir ops need sudo. The devcontainers/base image grants passwordless
    // sudo to `vscode`; SUDO is a no-op when sudo isn't needed/available.
    const SUDO = `if command -v sudo >/dev/null 2>&1; then SUDO='sudo -n'; else SUDO=''; fi`;
    // The stash apply step is best-effort — applying onto a possibly
    // shallow clone can hit "needs merge" conflicts in pathological cases
    // (e.g. host had local changes against a commit that's now outside
    // the depth window). Soft-failure is better than blocking provision;
    // any unapplied changes can be re-derived from the host as a fallback.
    const carryOverSteps: string[] = stashSha
      ? [
          `if git -C ${quoteShellArgv([args.workspaceDir])} rev-parse --verify ${quoteShellArgv([`refs/remotes/origin/agentbox-carryover/stash`])} >/dev/null 2>&1; then ` +
            `git -C ${quoteShellArgv([args.workspaceDir])} stash apply ${quoteShellArgv([`refs/remotes/origin/agentbox-carryover/stash`])} || ` +
            `echo "agentbox: stash apply soft-failed; carry-over may be incomplete" >&2 ; ` +
            `git -C ${quoteShellArgv([args.workspaceDir])} update-ref -d ${quoteShellArgv([`refs/remotes/origin/agentbox-carryover/stash`])} || true ; ` +
            `fi`,
        ]
      : [];
    if (untrackedSize > 0) {
      carryOverSteps.push(
        `if [ -f ${quoteShellArgv([REMOTE_UNTRACKED_TAR])} ]; then ` +
          `tar -C ${quoteShellArgv([args.workspaceDir])} -xzf ${quoteShellArgv([REMOTE_UNTRACKED_TAR])} && ` +
          `rm -f ${quoteShellArgv([REMOTE_UNTRACKED_TAR])} ; ` +
          `fi`,
      );
    }
    const script = [
      `set -euo pipefail`,
      // Move out of any cwd we might inherit from Daytona's executeCommand
      // before we delete /workspace. The agentbox image bakes WORKDIR
      // /workspace; if the shell's cwd is /workspace when we `rm -rf` it,
      // the next process inherits a stale cwd FD and git-clone's child
      // (index-pack) fails with "Unable to read current working directory".
      `cd /tmp`,
      SUDO,
      // rm -rf only the directory we're about to clone into — for nested
      // repos this is just `/workspace/<rel>`, so the root clone (already
      // at `/workspace`) is preserved.
      `$SUDO rm -rf ${quoteShellArgv([args.workspaceDir])}`,
      `$SUDO mkdir -p ${quoteShellArgv([args.workspaceDir])}`,
      `$SUDO chown "$(id -un):$(id -gn)" ${quoteShellArgv([args.workspaceDir])}`,
      `git clone ${quoteShellArgv([remoteBundle, args.workspaceDir])}`,
      setOrigin,
      `git -C ${quoteShellArgv([args.workspaceDir])} fetch ${quoteShellArgv([remoteBundle])} --tags '+refs/heads/*:refs/remotes/bundle/*' || true`,
      `git -C ${quoteShellArgv([args.workspaceDir])} checkout -B ${quoteShellArgv([args.branch])}`,
      ...carryOverSteps,
      `rm -f ${quoteShellArgv([remoteBundle])}`,
    ].join('\n');
    // Daytona's executeCommand shells out via dash (`/bin/sh`), which rejects
    // bash idioms like `set -o pipefail`. Wrap in `bash -c` so the script
    // runs in bash regardless of what `/bin/sh` points at.
    const r = await args.backend.exec(args.handle, bashScript(script));
    if (r.exitCode !== 0) {
      throw new Error(`workspace seed (bundle) failed: ${r.stderr || r.stdout}`);
    }
  } finally {
    // Defensive cleanup — in the happy path the stashRefCreated flag was
    // flipped off after we deleted the ref. If we threw between updates,
    // the ref may still be on the host; delete it so re-runs don't accrue
    // refs/agentbox-carryover/* entries.
    if (stashRefCreated) {
      await execa('git', ['-C', args.hostRepo, 'update-ref', '-d', STASH_CARRYOVER_REF], {
        reject: false,
      });
    }
    await rm(stage, { recursive: true, force: true });
  }
}

/**
 * Best-effort `git stash create` on the host repo. Returns the stash SHA
 * (or `null` when the worktree is clean / git is missing / the call fails).
 * Mirrors the docker provider's `collectRepoCarryOver` shape — pure host
 * git, no side effects on the working tree.
 */
async function safeStashCreate(hostRepo: string): Promise<string | null> {
  const r = await execa('git', ['-C', hostRepo, 'stash', 'create'], { reject: false });
  if (r.exitCode !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/**
 * Tar the repo's untracked-not-ignored files into `outPath`. Returns the
 * tar size in bytes (0 when there's nothing to tar, so callers can skip
 * the upload). `git stash create` doesn't capture untracked, so the carry-
 * over needs this side channel — matches docker's behavior.
 */
async function maybeBuildUntrackedTar(hostRepo: string, outPath: string): Promise<number> {
  const list = await execa(
    'git',
    ['-C', hostRepo, 'ls-files', '--others', '--exclude-standard', '-z'],
    { reject: false },
  );
  if (list.exitCode !== 0 || list.stdout.length === 0) return 0;
  // Feed NUL-delimited paths to `tar --null -T -` so spaces / quotes /
  // newlines in filenames survive. Use COPYFILE_DISABLE=1 to suppress
  // macOS' AppleDouble `._<name>` sidecars (same hardening as the
  // agent-credential tarballs).
  const tar = await execa(
    'tar',
    ['-C', hostRepo, '--null', '-T', '-', '-czf', outPath],
    {
      input: list.stdout,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      reject: false,
    },
  );
  if (tar.exitCode !== 0) return 0;
  try {
    const { stat } = await import('node:fs/promises');
    const s = await stat(outPath);
    return s.size;
  } catch {
    return 0;
  }
}

async function readOriginUrl(hostRepo: string): Promise<string | null> {
  const r = await execa('git', ['-C', hostRepo, 'remote', 'get-url', 'origin'], { reject: false });
  if (r.exitCode !== 0) return null;
  const out = (r.stdout ?? '').trim();
  return out.length > 0 ? out : null;
}

interface SeedFromTarArgs {
  backend: CloudBackend;
  handle: CloudHandle;
  hostDir: string;
  workspaceDir: string;
}

async function seedFromTar(args: SeedFromTarArgs): Promise<void> {
  const stage = await mkdtemp(join(tmpdir(), 'agentbox-tar-'));
  const tarPath = join(stage, 'workspace.tar.gz');
  try {
    await execa('tar', ['-C', args.hostDir, '-czf', tarPath, '.']);
    const remoteTar = '/tmp/agentbox-workspace.tar.gz';
    await args.backend.uploadFile(args.handle, tarPath, remoteTar);
    const SUDO = `if command -v sudo >/dev/null 2>&1; then SUDO='sudo -n'; else SUDO=''; fi`;
    const script = [
      `set -euo pipefail`,
      // Move out of any cwd we might inherit from Daytona's executeCommand
      // before we delete /workspace. The agentbox image bakes WORKDIR
      // /workspace; if the shell's cwd is /workspace when we `rm -rf` it,
      // the next process inherits a stale cwd FD and git-clone's child
      // (index-pack) fails with "Unable to read current working directory".
      `cd /tmp`,
      SUDO,
      `$SUDO rm -rf ${quoteShellArgv([args.workspaceDir])}`,
      `$SUDO mkdir -p ${quoteShellArgv([args.workspaceDir])}`,
      `$SUDO chown "$(id -un):$(id -gn)" ${quoteShellArgv([args.workspaceDir])}`,
      `tar -C ${quoteShellArgv([args.workspaceDir])} -xzf ${quoteShellArgv([remoteTar])}`,
      `rm -f ${quoteShellArgv([remoteTar])}`,
    ].join('\n');
    const r = await args.backend.exec(args.handle, bashScript(script));
    if (r.exitCode !== 0) {
      throw new Error(`workspace seed (tar) failed: ${r.stderr || r.stdout}`);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
