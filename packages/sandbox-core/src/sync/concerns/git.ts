/**
 * Concern: git / workspace — seed the box's per-box worktree(s) from the host at
 * create, and resync them with the host's current state on session restart
 * (box-wins on every conflict). This is the concrete `box-wins-content-hash`
 * conflict policy the reconciler contract (`@agentbox/core` `sync/reconciler.ts`)
 * anticipates as its first consumer.
 *
 * This file currently holds the provider-neutral core of the *resync* half — the
 * pure untracked-overlay classifier. The full resync orchestration + a
 * `WorkspaceResyncPorts` seam land here across Phase 6; the docker/cloud
 * providers supply the I/O. Workspace *seed* (worktree add + bind-mount replay)
 * stays docker-specific (it has no cloud analog — cloud clones) and is not moved.
 */

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
