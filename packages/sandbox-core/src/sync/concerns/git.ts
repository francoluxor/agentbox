/**
 * Concern: git / workspace — seed the box's per-box worktree(s) from the host at
 * create, and resync them with the host's current state on session restart
 * (box-wins on every conflict). This is the concrete `box-wins-content-hash`
 * conflict policy the reconciler contract (`@agentbox/core` `sync/reconciler.ts`)
 * anticipates as its first consumer.
 *
 * This file holds the provider-neutral *resync* half: the pure untracked-overlay
 * classifier + the `resyncWorkspace` orchestration, driven entirely through the
 * `WorkspaceResyncPorts` seam so it's a pure function of its I/O (golden-tested
 * against a scripted fake). The docker/cloud providers supply the ports. Docker
 * is the only implementation today; a cloud one closes the "Phase 2" gap (a
 * cloud box gets no workspace resync yet). Workspace *seed* (worktree add +
 * bind-mount replay) stays docker-specific — it has no cloud analog (cloud
 * clones) — and is not moved.
 */

import type {
  RepoResyncResult,
  ResyncWorktree,
  WorkspaceResyncPorts,
} from '@agentbox/core';

/**
 * Sentinel token the box-side probe emits for a path that exists but is NOT a
 * plain file (a dir or symlink) — always a conflict so we never clobber it.
 */
export const NON_REGULAR_TOKEN = '-';

/**
 * Classify a host untracked file against what the box already has at that path.
 * `boxToken` is the box-side probe result: `undefined` when the path is absent
 * in the box (safe to copy), {@link NON_REGULAR_TOKEN} when it exists but isn't
 * a plain file, otherwise the sha256 of the box file's contents. `hostHash` is
 * the sha256 of the host file. A byte-identical file is a no-op (neither copied
 * nor reported); anything else that already exists is a conflict the box keeps
 * (box wins — the host change is shadowed, no marker left).
 */
export function classifyUntrackedOverlay(
  boxToken: string | undefined,
  hostHash: string,
): 'copy' | 'identical' | 'conflict' {
  if (boxToken === undefined) return 'copy';
  if (boxToken === NON_REGULAR_TOKEN) return 'conflict';
  return boxToken === hostHash ? 'identical' : 'conflict';
}

/** Split a `-z` (NUL-delimited) git output into non-empty entries. */
function splitNul(s: string): string[] {
  return s.split('\0').filter((p) => p.length > 0);
}

/** Conflicted (unmerged) paths in the box worktree, if any. */
async function unmergedPaths(ports: WorkspaceResyncPorts, ct: string): Promise<string[]> {
  const r = await ports.boxGit(ct, ['diff', '--name-only', '--diff-filter=U', '-z']);
  return r.exitCode === 0 ? splitNul(r.stdout) : [];
}

/**
 * Resync each box worktree with the host's current state: merge the host's
 * checked-out branch into the box's per-box branch, then overlay the host's
 * uncommitted (stash) + untracked changes. The box wins every conflict — the
 * host change is skipped (no markers left) and the affected paths are returned
 * so the caller can warn the agent.
 *
 * Provider-neutral: all I/O goes through {@link WorkspaceResyncPorts}. On docker
 * the host `.git/` is bind-mounted so the host branch ref is already present in
 * the box and the merge needs no fetch (the same property create-time carry-over
 * relies on). Best-effort throughout — a step that fails is logged and skipped
 * rather than aborting the box start.
 */
export async function resyncWorkspace(
  worktrees: ResyncWorktree[],
  ports: WorkspaceResyncPorts,
  onLog?: (line: string) => void,
): Promise<RepoResyncResult[]> {
  const log = onLog ?? (() => {});
  const results: RepoResyncResult[] = [];

  for (const w of worktrees) {
    const ct = w.containerPath;
    const hostMain = w.hostMainRepo;
    const boxBranch = w.branch;
    const res: RepoResyncResult = { containerPath: ct, mergeConflicts: [], overlaySkipped: [] };

    // --- host state (host-side git; no side effects on the worktree) ---
    const hostRef = await ports.resolveHostRef(hostMain);
    if (!hostRef) {
      log(`resync: ${ct}: could not resolve host ref; skipping`);
      results.push(res);
      continue;
    }
    const hostStashSha = await ports.createHostStash(hostMain);
    const hostUntracked = await ports.listHostUntracked(hostMain);

    // --- merge host commits into the box branch (skip when merging self) ---
    if (hostRef !== boxBranch) {
      // Stash the box's own uncommitted tracked changes so the merge can run;
      // restored on top afterward (box keeps them). Untracked box files stay.
      const status = await ports.boxGit(ct, ['status', '--porcelain']);
      const boxDirty = status.stdout
        .split('\n')
        .some((line) => line.length > 0 && !line.startsWith('??'));
      let boxStashed = false;
      if (boxDirty) {
        const push = await ports.boxGit(ct, ['stash', 'push', '-m', 'agentbox-resync']);
        boxStashed = push.exitCode === 0;
      }

      const newCommits = await ports.boxGit(ct, ['rev-list', '--count', `${boxBranch}..${hostRef}`]);
      const n = newCommits.exitCode === 0 ? newCommits.stdout.trim() : '?';
      const merge = await ports.boxGit(ct, ['merge', '--no-commit', hostRef]);
      const mergeInProgress =
        (await ports.boxGit(ct, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).exitCode === 0;
      const conflicts = await unmergedPaths(ports, ct);
      if (conflicts.length > 0) {
        await ports.boxGit(ct, ['checkout', '--ours', '--', ...conflicts]);
        await ports.boxGit(ct, ['add', '--', ...conflicts]);
        res.mergeConflicts.push(...conflicts);
      }
      if (mergeInProgress) {
        await ports.boxGit(ct, [
          '-c',
          'user.name=agentbox',
          '-c',
          'user.email=agentbox@users.noreply.github.com',
          'commit',
          '--no-edit',
        ]);
        log(
          `resync: ${ct}: merged ${n} new host commit(s) from ${hostRef}` +
            (conflicts.length > 0 ? ` (${String(conflicts.length)} conflict(s) kept box version)` : ''),
        );
      } else if (merge.exitCode === 0) {
        log(`resync: ${ct}: ${n === '0' ? 'already up to date' : `fast-forwarded to ${hostRef}`}`);
      } else {
        // Hard failure (e.g. an untracked box file would be overwritten). Leave
        // the box untouched.
        await ports.boxGit(ct, ['merge', '--abort']);
        log(`resync: ${ct}: merge skipped (${(merge.stderr || merge.stdout).trim().split('\n')[0]})`);
      }

      if (boxStashed) {
        const pop = await ports.boxGit(ct, ['stash', 'pop']);
        if (pop.exitCode !== 0) {
          // Box's uncommitted edits clash with the merged host change. Keep the
          // box's version (stash side = --theirs), drop the dangling stash.
          const popConflicts = await unmergedPaths(ports, ct);
          for (const p of popConflicts) {
            await ports.boxGit(ct, ['checkout', '--theirs', '--', p]);
            await ports.boxGit(ct, ['reset', '-q', '--', p]);
          }
          await ports.boxGit(ct, ['stash', 'drop']);
        }
      }
    }

    // --- overlay host uncommitted (stash) on top, box wins on conflict ---
    if (hostStashSha) {
      const apply = await ports.boxGit(ct, ['stash', 'apply', hostStashSha]);
      if (apply.exitCode !== 0) {
        const conflicts = await unmergedPaths(ports, ct);
        for (const p of conflicts) {
          // ours = box working tree, theirs = host stash → keep box, unstage.
          await ports.boxGit(ct, ['checkout', '--ours', '--', p]);
          await ports.boxGit(ct, ['reset', '-q', '--', p]);
        }
        if (conflicts.length > 0) res.overlaySkipped.push(...conflicts);
      }
    }

    // --- overlay host untracked files; box wins only when it actually differs ---
    if (hostUntracked.length > 0) {
      // Probe the box for each host path. A path absent in the box is copied; a
      // path present and byte-identical is a no-op (NOT a conflict — this is the
      // common case right after create-time seeding copied these same untracked
      // files in); a path present but differing (or a non-regular file we won't
      // clobber) is the box's version we keep and report.
      const boxTokens = await ports.probeUntrackedTokens(ct, hostUntracked);
      const toCopy: string[] = [];
      let identical = 0;
      for (const p of hostUntracked) {
        const boxToken = boxTokens.get(p);
        let hostHash = '';
        if (boxToken !== undefined && boxToken !== NON_REGULAR_TOKEN) {
          try {
            hostHash = await ports.hashHostFile(hostMain, p);
          } catch {
            // Host file vanished/unreadable since `ls-files` — can't copy it and
            // the box already has its own version; keep the box's, don't report.
            identical++;
            continue;
          }
        }
        const verdict = classifyUntrackedOverlay(boxToken, hostHash);
        if (verdict === 'copy') toCopy.push(p);
        else if (verdict === 'conflict') res.overlaySkipped.push(p);
        else identical++;
      }
      if (identical > 0) {
        log(`resync: ${ct}: ${String(identical)} untracked host file(s) already identical in box (no-op)`);
      }
      if (toCopy.length > 0) {
        const tar = await ports.packHostFiles(hostMain, toCopy);
        if (tar) {
          await ports.applyTarToBox(ct, tar);
          log(`resync: ${ct}: copied ${String(toCopy.length)} untracked host file(s)`);
        }
      }
    }

    results.push(res);
  }

  return results;
}
