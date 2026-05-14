import { execa } from 'execa';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface DetectedGitRepo {
  kind: 'root' | 'nested';
  /** Absolute host path of the repo working tree (== `<workspace>` for root). */
  hostMainRepo: string;
  /** Path relative to the workspace where the repo lives. Empty string for root. */
  relPathFromWorkspace: string;
}

/**
 * Look for `.git` directories at the workspace root and at every 1st-level
 * subdirectory. Worktree-form `.git` files (regular file containing
 * `gitdir: …`) are intentionally skipped — turning an existing worktree into
 * another worktree gets weird, and the user case for it is rare.
 */
export async function detectGitRepos(workspace: string): Promise<DetectedGitRepo[]> {
  const out: DetectedGitRepo[] = [];
  if (await isGitDir(join(workspace, '.git'))) {
    out.push({ kind: 'root', hostMainRepo: workspace, relPathFromWorkspace: '' });
  }
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(workspace, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const sub = join(workspace, e.name);
    if (await isGitDir(join(sub, '.git'))) {
      out.push({ kind: 'nested', hostMainRepo: sub, relPathFromWorkspace: e.name });
    }
  }
  return out;
}

async function isGitDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export interface CreateBoxWorktreeArgs {
  hostMainRepo: string;
  branchName: string;
  worktreeDir: string;
  onLog?: (line: string) => void;
}

export interface CreateBoxWorktreeResult {
  branchName: string;
  /** Tracked-changes stash SHA, if any uncommitted state was present. */
  stashSha: string | null;
  untrackedCount: number;
}

/**
 * Create a per-box worktree on a fresh branch, carrying over the host's
 * uncommitted tracked + untracked state so the agent picks up where the user
 * left off. The host's working directory is left untouched.
 */
export async function createBoxWorktree(
  args: CreateBoxWorktreeArgs,
): Promise<CreateBoxWorktreeResult> {
  const log = args.onLog ?? (() => {});

  // `stash create` produces a stash commit without touching the working tree
  // or stash list. Empty output means "no tracked changes" (a clean main).
  const stash = await execa('git', ['-C', args.hostMainRepo, 'stash', 'create'], {
    reject: false,
  });
  const stashSha = stash.exitCode === 0 ? stash.stdout.trim() || null : null;

  const untracked = await execa(
    'git',
    ['-C', args.hostMainRepo, 'ls-files', '--others', '--exclude-standard', '-z'],
    { reject: false },
  );
  const untrackedList =
    untracked.exitCode === 0 && untracked.stdout.length > 0
      ? untracked.stdout.split('\0').filter((s) => s.length > 0)
      : [];

  // `git worktree add` creates the target dir itself; we only need to ensure
  // the parent exists (the caller does that).
  const branchName = await pickFreshBranch(args.hostMainRepo, args.branchName);
  const wadd = await execa(
    'git',
    ['-C', args.hostMainRepo, 'worktree', 'add', '-b', branchName, args.worktreeDir, 'HEAD'],
    { reject: false },
  );
  if (wadd.exitCode !== 0) {
    throw new GitWorktreeError(
      `git worktree add failed for ${args.hostMainRepo}: ${wadd.stderr || wadd.stdout}`,
    );
  }
  log(`created worktree ${args.worktreeDir} on branch ${branchName}`);

  // Boxes don't carry the user's signing keys, so commit.gpgsign=true (a
  // common host setting) would make every in-box `git commit` fail. Enable
  // per-worktree config and disable signing on this worktree only — the
  // user's main checkout keeps signing on.
  await execa(
    'git',
    ['-C', args.hostMainRepo, 'config', 'extensions.worktreeConfig', 'true'],
    { reject: false },
  );
  await execa(
    'git',
    ['-C', args.worktreeDir, 'config', '--worktree', 'commit.gpgsign', 'false'],
    { reject: false },
  );

  if (stashSha) {
    // `--index` restores the staged-vs-unstaged distinction. On rare conflict
    // (same HEAD — shouldn't happen), fall back to apply-without-index so we
    // at least recover the file contents.
    const withIndex = await execa(
      'git',
      ['-C', args.worktreeDir, 'stash', 'apply', '--index', stashSha],
      { reject: false },
    );
    if (withIndex.exitCode !== 0) {
      const noIndex = await execa(
        'git',
        ['-C', args.worktreeDir, 'stash', 'apply', stashSha],
        { reject: false },
      );
      if (noIndex.exitCode !== 0) {
        log(
          `warning: stash apply failed in worktree (${withIndex.stderr || withIndex.stdout || 'no message'})`,
        );
      } else {
        log(`applied tracked changes (without index — staged state lost)`);
      }
    } else {
      log(`applied tracked changes from host main`);
    }
  }

  if (untrackedList.length > 0) {
    // One fork: pack the list, stream tar from main → tar into worktree.
    const tarOut = await execa(
      'tar',
      ['-C', args.hostMainRepo, '--null', '-T', '-', '-cf', '-'],
      {
        input: untrackedList.join('\0'),
        encoding: 'buffer',
        reject: false,
      },
    );
    if (tarOut.exitCode === 0) {
      const tarIn = await execa('tar', ['-C', args.worktreeDir, '-xf', '-'], {
        input: tarOut.stdout,
        reject: false,
      });
      if (tarIn.exitCode !== 0) {
        log(`warning: untracked-file copy into worktree failed: ${tarIn.stderr}`);
      } else {
        log(`copied ${String(untrackedList.length)} untracked file(s) into worktree`);
      }
    } else {
      log(`warning: tar of untracked files failed: ${tarOut.stderr}`);
    }
  }

  return { branchName, stashSha, untrackedCount: untrackedList.length };
}

/**
 * Pick `<base>`, `<base>-2`, `<base>-3`, … until git reports no such branch
 * exists. Avoids collision when the user reruns `agentbox create -n same-name`
 * after destroying — the destroyed box's branch still lives in the host repo.
 */
export async function pickFreshBranch(hostMainRepo: string, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (await branchExists(hostMainRepo, candidate)) {
    candidate = `${base}-${String(suffix++)}`;
    if (suffix > 100) throw new GitWorktreeError(`could not find a free branch name near ${base}`);
  }
  return candidate;
}

async function branchExists(hostMainRepo: string, name: string): Promise<boolean> {
  const result = await execa(
    'git',
    ['-C', hostMainRepo, 'show-ref', '--verify', '--quiet', `refs/heads/${name}`],
    { reject: false },
  );
  return result.exitCode === 0;
}

export interface RemoveBoxWorktreeArgs {
  hostMainRepo: string;
  worktreeDir: string;
}

/**
 * Remove a per-box worktree. Worktree-remove leaves any in-flight changes in
 * place by default; `--force` strips it. Falls back to manual rm + prune if
 * git refuses (e.g. the dir was already deleted out from under it).
 */
export async function removeBoxWorktree(args: RemoveBoxWorktreeArgs): Promise<void> {
  const remove = await execa(
    'git',
    ['-C', args.hostMainRepo, 'worktree', 'remove', '--force', args.worktreeDir],
    { reject: false },
  );
  if (remove.exitCode === 0) return;
  await execa('rm', ['-rf', args.worktreeDir], { reject: false });
  await execa('git', ['-C', args.hostMainRepo, 'worktree', 'prune'], { reject: false });
}

export class GitWorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitWorktreeError';
  }
}
