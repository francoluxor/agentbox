/**
 * `ProviderSync` — the co-located, auditable surface of every shared sync
 * activity a provider performs. One implementation per provider
 * (`makeDockerSync` / `makeCloudSync`), each method a thin delegation to the
 * provider-neutral concern in `@agentbox/sandbox-core`. The two goals this
 * serves — see `docs/sync-architecture.md` §"Co-location: the ProviderSync
 * facade":
 *
 *  - **Per-provider audit** — one file (`docker-sync.ts` / `cloud-sync.ts`) is
 *    the complete list of a provider's sync ops.
 *  - **Per-concern cross-provider audit** — `dockerSync.resyncWorkspace` vs
 *    `cloudSync.resyncWorkspace` are peer methods under one interface.
 *
 * The handle (docker container / cloud backend+handle) is closed at construction
 * time; every method takes the `SyncContext` plus its own operation args.
 *
 * Granularity is GROUPED: per-tool agent config (static config, skills, dynamic,
 * box-facts) bundles into `seedAgentConfig`; resync / credentials / extract /
 * git-identity / env / carry stay separate peer methods. Workspace *seed* (git
 * worktree create + docker `mount --bind`) is deliberately NOT here — it has no
 * cloud analog (cloud clones), so it stays a provider-specific step called
 * directly by each `create()`. Each facade file's header names that carve-out so
 * the file remains the full picture.
 */

import type { GitWorktreeRecord } from '../box-record.js';
import type { ResolvedCarryEntry, ResyncResult } from '../provider.js';
import type { SyncContext } from './context.js';

/**
 * Outcome of applying the approved `carry:` entries into a box. Mirrors the
 * docker `CopyCarryResult` shape (kept identical so `applyCarry` returns it
 * verbatim): the count copied, per-entry errors, and an audit summary for
 * `BoxRecord.carry` (`hash` is the host source content hash at copy time).
 */
export interface CarryApplyResult {
  copied: number;
  errors: string[];
  applied: Array<{ src: string; dest: string; bytes: number; hash?: string }>;
}

export interface ProviderSync {
  /**
   * Merge the host's checked-out branch into each box worktree's per-box branch
   * and overlay the host's uncommitted/untracked changes, box-wins on conflict.
   * `worktrees` are the box's recorded worktrees (root + nested).
   */
  resyncWorkspace(ctx: SyncContext, worktrees: GitWorktreeRecord[]): Promise<ResyncResult>;
  /**
   * Seed the per-tool agent config (claude/codex/opencode): static config +
   * skills + dynamic (workflows/memory) + box-facts. The method body lists the
   * sub-steps in order so the facade file stays the auditable full picture.
   */
  seedAgentConfig(ctx: SyncContext): Promise<void>;
  /** Seed the host's agent logins (claude/codex/opencode) into the box. */
  seedCredentials(ctx: SyncContext): Promise<void>;
  /** Capture the box's agent logins back to the host backups. Returns updated agents. */
  extractCredentials(ctx: SyncContext): Promise<string[]>;
  /** Seed the host git identity (`~/.gitconfig`) into the box. Docker no-op (bind-mounted). */
  seedGitIdentity(ctx: SyncContext): Promise<void>;
  /** Copy gitignore-bypassing host env files matching `patterns` into /workspace. */
  seedEnvFiles(ctx: SyncContext, patterns: string[]): Promise<{ copied: number }>;
  /** Apply the approved `carry:` entries (host→box file copies) into the box. */
  applyCarry(ctx: SyncContext, entries: ResolvedCarryEntry[]): Promise<CarryApplyResult>;
}
