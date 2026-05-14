import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBoxWorktree,
  detectGitRepos,
  pickFreshBranch,
  removeBoxWorktree,
} from '../src/git-worktree.js';

// These tests shell out to real git many times each. Under turbo's parallel
// load on a busy CPU the default 5s per-test budget is too tight; bump it.
const T = 30_000;

async function initRepo(dir: string): Promise<void> {
  await execa('git', ['-C', dir, 'init', '--initial-branch=main'], { reject: true });
  await execa('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await execa('git', ['-C', dir, 'config', 'user.name', 'Tester']);
  // Disable commit signing locally — the test host might have
  // `commit.gpgsign=true` set globally (we do, with SSH signing), which would
  // make `git commit` block on the SSH agent and hang the test.
  await execa('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), '# initial\n', 'utf8');
  await execa('git', ['-C', dir, 'add', 'README.md']);
  await execa('git', ['-C', dir, 'commit', '-m', 'initial']);
}

describe('git-worktree', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentbox-gwt-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    'detectGitRepos finds the root repo when .git exists',
    async () => {
      const ws = join(root, 'ws');
      await mkdir(ws, { recursive: true });
      await initRepo(ws);

      const repos = await detectGitRepos(ws);
      expect(repos).toEqual([{ kind: 'root', hostMainRepo: ws, relPathFromWorkspace: '' }]);
    },
    T,
  );

  it(
    'detectGitRepos finds 1st-level nested repos for monorepo setups',
    async () => {
      const ws = join(root, 'ws');
      const app = join(ws, 'app');
      const libs = join(ws, 'libs');
      await mkdir(app, { recursive: true });
      await mkdir(libs, { recursive: true });
      await initRepo(ws);
      await initRepo(app);

      const repos = await detectGitRepos(ws);
      const sorted = [...repos].sort((a, b) =>
        a.relPathFromWorkspace.localeCompare(b.relPathFromWorkspace),
      );
      expect(sorted).toEqual([
        { kind: 'root', hostMainRepo: ws, relPathFromWorkspace: '' },
        { kind: 'nested', hostMainRepo: app, relPathFromWorkspace: 'app' },
      ]);
      expect(repos.some((r) => r.relPathFromWorkspace === 'libs')).toBe(false);
    },
    T,
  );

  it(
    'detectGitRepos skips dotfile subdirs (e.g. .vscode)',
    async () => {
      const ws = join(root, 'ws');
      const vscodeDir = join(ws, '.vscode');
      await mkdir(vscodeDir, { recursive: true });
      await writeFile(join(vscodeDir, 'settings.json'), '{}', 'utf8');
      await initRepo(ws);
      const repos = await detectGitRepos(ws);
      expect(repos.map((r) => r.relPathFromWorkspace)).toEqual(['']);
    },
    T,
  );

  it(
    'createBoxWorktree carries over staged + unstaged + untracked changes',
    async () => {
      const ws = join(root, 'ws');
      await mkdir(ws, { recursive: true });
      await initRepo(ws);

      // Tracked modification: edit README.md, leave unstaged.
      await writeFile(join(ws, 'README.md'), '# initial\nmodified-unstaged\n', 'utf8');
      // Tracked staged: add a brand-new file via `git add`.
      await writeFile(join(ws, 'staged.txt'), 'staged content\n', 'utf8');
      await execa('git', ['-C', ws, 'add', 'staged.txt']);
      // Untracked: a file outside the index that isn't .gitignored.
      await writeFile(join(ws, 'untracked.txt'), 'just floating\n', 'utf8');

      const wtDir = join(root, 'worktree');
      const result = await createBoxWorktree({
        hostMainRepo: ws,
        branchName: 'agentbox/test',
        worktreeDir: wtDir,
      });
      expect(result.branchName).toBe('agentbox/test');

      // The host's working dir should be untouched.
      const hostReadme = await readFile(join(ws, 'README.md'), 'utf8');
      expect(hostReadme).toBe('# initial\nmodified-unstaged\n');

      // The worktree carries the unstaged edit, the staged add, and the untracked.
      const wtReadme = await readFile(join(wtDir, 'README.md'), 'utf8');
      expect(wtReadme).toBe('# initial\nmodified-unstaged\n');
      const wtStaged = await readFile(join(wtDir, 'staged.txt'), 'utf8');
      expect(wtStaged).toBe('staged content\n');
      const wtUntracked = await readFile(join(wtDir, 'untracked.txt'), 'utf8');
      expect(wtUntracked).toBe('just floating\n');

      // staged.txt should still appear in the worktree's index (--cached diff
      // is non-empty), proving the --index flag of stash apply restored it.
      const cached = await execa('git', ['-C', wtDir, 'diff', '--cached', '--name-only'], {
        reject: false,
      });
      expect(cached.stdout.split('\n')).toContain('staged.txt');

      // And the worktree is on the new branch.
      const branch = await execa('git', ['-C', wtDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
      expect(branch.stdout.trim()).toBe('agentbox/test');
    },
    T,
  );

  it(
    'pickFreshBranch increments the suffix on collision',
    async () => {
      const ws = join(root, 'ws');
      await mkdir(ws, { recursive: true });
      await initRepo(ws);
      const next = await pickFreshBranch(ws, 'main');
      expect(next).toBe('main-2');
    },
    T,
  );

  it(
    'removeBoxWorktree deregisters the worktree from the main repo',
    async () => {
      const ws = join(root, 'ws');
      await mkdir(ws, { recursive: true });
      await initRepo(ws);
      const wtDir = join(root, 'wt');
      await createBoxWorktree({
        hostMainRepo: ws,
        branchName: 'agentbox/dispose',
        worktreeDir: wtDir,
      });
      const before = await execa('git', ['-C', ws, 'worktree', 'list']);
      expect(before.stdout).toContain(wtDir);

      await removeBoxWorktree({ hostMainRepo: ws, worktreeDir: wtDir });

      const after = await execa('git', ['-C', ws, 'worktree', 'list']);
      expect(after.stdout).not.toContain(wtDir);
    },
    T,
  );
});
