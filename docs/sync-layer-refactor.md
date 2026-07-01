# Sync-layer refactor — progress & continuation

Branch: `feat/sync-layer` (off `feat/control-plane-create`; PR targets that, not `main`).
Full design: the approved plan (`we-need-to-abstract-rippling-clover`). This file tracks
execution state so the branch is self-documenting for resumption.

## Goal (recap)
One well-defined, **bidirectional** sync layer, organized by concern (git / env / files /
credentials / skills / dynamic) with per-tool logic isolated, behind a single
`SyncTransport` seam — collapsing the docker/cloud + per-tool duplication, and preserving /
unblocking the 3-way control-plane relay work.

Two-tier layout (dependency-graph-driven): **pure contracts** in `packages/core/src/sync/`;
**fs/execa impl** in `packages/sandbox-core/src/sync/`; transports in the provider packages.

## Done (committed, verified: build + typecheck + lint + tests green)

- **Phase 1 — Tier-1 contracts + name adapter.** `packages/core/src/sync/`:
  `transport.ts` (`SyncTransport` + `TransportCaps`/`PushOptions`/`VolumeHostSource`),
  `types.ts` (topology/direction/concern + reserved `SyncState`), `agent-kind.ts`
  (`toSyncKind`/`toQueueKind`/`normalizeLastAgent`), `reconciler.ts`. `Provider.syncTransport?`
  added. Two ad-hoc name shims migrated to the adapter. (core 27 tests; relay 252 intact.)
- **Phase 0 — parity net.** `packages/sandbox-core/src/sync/recording-transport.ts` —
  `RecordingSyncTransport` records a concern's exact ordered transport calls (each concern is
  a pure fn of `(ctx, transport)`), the golden-test net for every later phase. (Reframed from
  a fragile full-`create()` snapshot.)
- **Phase 2 — registry.** `packages/sandbox-core/src/sync/registry.ts` + `agents/types.ts`:
  `AGENT_SYNC_SPECS` (data-only: paths, credentials, forwarded env keys, caps; opencode's
  3-XDG-dir layout as data) + `resolveAgentSpec(id|alias)`.
- **Phase 3 — SyncTransport (docker+cloud) + env concern.** `core` gained `applyTarball`
  (unified host→box primitive). `DockerSyncTransport` (docker CLI wrappers, container-only,
  works at create) + `CloudSyncTransport` (CloudBackend wrappers). `sync/concerns/env.ts`
  unifies docker `copyHostEnvFilesToBox` + cloud `uploadEnvFiles` (both now thin wrappers
  injecting their transport); env helpers re-exported from sandbox-docker for existing
  importers. `SyncContext` added. **Validated on a real docker box**: a gitignored
  secrets.toml/.env.gitignored (git-ignored in-box → not from the git seed) landed in
  /workspace owned vscode:vscode via the refactored path.
- **Phase 4a — carry concern (`planCarryEntry`).** `sandbox-core/src/sync/concerns/files.ts`:
  pure `planCarryEntry(entry)` computes the shared host→box carry decisions
  (`~/`→`/home/vscode`, file-vs-dir, exclude, uid/mode defaults, rename-needed,
  parent-chain-needed). Docker `copyOneEntry` + cloud `uploadOneEntry` now consume it and
  keep their *apply* mechanisms byte-identical (docker streamTarPipe + `docker exec
  --user 0:0`; cloud staged-tar + one combined bash command — never split, per the Vercel
  hang note). Unified the two providers' drifted parent-chain predicate on docker's
  (skip-the-no-op) form — identical in effect, strictly safer for Vercel. Net −29 lines.
  New `carry-plan.test.ts` (10); cloud `carry.test.ts` (8) unchanged + green.
- **Phase 4b — dynamic concern (close cloud→docker leak).** Moved the claude path trio
  (`encodeClaudeProjectsKey`/`BOX_CLAUDE_PROJECT_DIR`/`resolveClaudeMemoryDir`) into
  `sync/agents/claude/paths.ts` and the workflows+memory manifest logic
  (`buildHostSyncManifest`/`computeSyncDelta`/`stageDynamicSyncTarball` + types + `BOX_*`
  consts) into `sync/concerns/dynamic.ts`. `sandbox-docker`'s `host-stage.ts` +
  `dynamic-sync.ts` are now thin re-export shims (existing importers untouched); cloud
  `dynamic-sync.ts` imports from `@agentbox/sandbox-core` — **leak gone**. Docker create
  never consumed the manifest fns (it seeds workflows/memory via the `~/.claude` volume
  rsync), so this is cloud-runtime + test only. Docker `dynamic-sync.test.ts` (12) still
  green through the shims (cross-package guard). `seedDynamicConfig`'s cloud exec/upload
  orchestration unchanged (its transport unification belongs with Phase 7).
- **Phase 4c — skills concern (`~/.agents` seed behind the transport seam).** Moved the
  pure host-side symlink pre-scan (`findUnsyncableSymlinks` + `isUnder`) into
  `sync/host-links.ts` (re-exported from docker `claude.ts` for its test/importers) and
  added `sync/concerns/skills.ts:seedAgentsVolume(transport, …)` — computes the
  unsyncable-symlink `--exclude`s host-side and drives the docker rsync-helper container
  through `transport.seedVolumeFromHost`. Added `VolumeHostSource.copyUnsafeLinks` to the
  core contract + honored it in `DockerSyncTransport`. Docker `ensureAgentsVolume` is now a
  thin wrapper (ensureVolume + `created` detection, then delegate the seed); its
  best-effort no-host-dir writable-chown is preserved (sync failures still propagate). Net
  −100 lines. New `skills-concern.test.ts` (5) golden-tests the emitted `seedVolumeFromHost`
  op; docker `find-unsyncable-symlinks.test.ts` (6) still green through the re-export.
  **Box→host pull deliberately NOT unified:** `pullClaudeExtras`/`pullCodexConfig`/
  `pullOpencodeConfig` are intrinsically docker-volume-specific (helper container over
  `${volume}:/src:ro` + bespoke per-tool inventory/merge) with NO polymorphic caller — each
  `download-<tool>` CLI command is a tool-specific entry point. Forcing a `spec.pull`
  abstraction now would be speculative + risky (same "don't force a unification" call as
  carry's apply mechanism). Left for a real consumer (the Phase 7 driver, or a future
  download-all/resync path).

## Refinements to the plan's phasing (decided during execution)
1. **Transports co-develop with their first concern (Phase 3), not in a vacuum.** Docker
   `copyOneEntry` and cloud `uploadOneEntry` *are* the push primitives; the transport
   `pushTree`/`pushFile`/`applyTarball` surface is best finalized against the env/carry
   concerns that consume it, with `RecordingSyncTransport` + existing `scan-host-env-files`/
   `carry` tests as parity nets.
2. **The docker `create.ts:623-763` + cloud `cloud-provider.ts:705-819` orchestration
   collapse folds into the driver phase (Phase 7)**, after concerns exist and are proven —
   safer than a one-off partial collapse in Phase 2.

## Remaining (behavior-moving; each must keep existing provider tests green and be
## smoke-tested {local,vercel,hetzner}×{claude,codex} before pushing)

- **Phase 4 is complete** (carry + dynamic + skills, all above in Done). One piece was
  **deliberately deferred, not skipped:** the box→host per-tool pull (`pullClaudeExtras`/
  `pullCodexConfig`/`pullOpencodeConfig`) stays docker-volume-specific — no polymorphic
  caller exists to unify, and the fns are intrinsically docker (helper container over the
  config volume). It folds naturally into the Phase 7 driver or a future download-all/resync
  consumer; a `spec.pull` abstraction without a consumer would be speculative.
  - **transport fix already landed (Phase 3):** `DockerSyncTransport.applyTarball` always
    pins `--user <uid>:<uid>` (incl. `0:0` for root) — the carry `uid:0` path needs it; env
    (`uid:1000`) is unchanged.
  - **SMOKE MATRIX STILL OWED before any push:** Phase 4b (dynamic) and 4c (skills) move
    real create-path behavior (cloud dynamic seed import surface; docker `~/.agents` volume
    seed via the transport helper container, incl. the non-recursive→recursive chown on the
    no-host-`~/.agents` fallback). Run `{local,vercel,hetzner}×{claude,codex}` per the gate
    below before pushing this branch.
- **Phase 5 — credentials concern.** `concerns/credentials.ts`
  (`seedCredentials`/`extractCredentials`/`refreshHostBackups`). Encode expiry gate
  (`hostClaudeBackupExpired`) + seed-once marker (`.agentbox-seeded-at`) + force rule +
  `isRealAgentCredential` guard as spec/caps fields. Highest-risk; extra assertions + real-box
  login→destroy→recreate→inherited smoke both directions on docker + volume + ephemeral cloud.
- **Phase 6 — git seed + resync + box-facts.** Move workspace seed + resync (verbatim
  box-wins `classifyUntrackedOverlay`) behind `WorkspaceResyncPorts`; **wire `CloudSyncTransport`
  into resync to close the cloud "Phase 2" gap**. Leave the `inBoxClone` control-plane branch
  untouched.
- **Phase 7 — data-driven driver.** `sync/driver.ts` `SEED_PIPELINE` + `seed()`; replace the
  imperative sequences in `create.ts`/`cloud-provider.ts` (order preserved). Move the
  per-tool static-config stage producers to `sync/agents/<tool>/stage.ts` + fill in the
  claude/codex `staticPaths[].exclude` (`CLAUDE_RUNTIME_EXCLUDES`, `CODEX_RSYNC_EXCLUDES`).
  Add the `AGENTBOX_SYNC_DRYRUN` passthrough (prints the transport sequence) here.
- **Phase 8 — naming reconciliation.** Route all reads/writes through `agent-kind.ts`; delete
  the (now-delegating) inline shims. Only phase that may change a snapshot; relay tests stay
  green; no data migration (read-time normalization only).
- **Phase 9 — relay delegation + git-refs unification.** Extract the triplicated
  branch/refspec/upstream logic (`server.ts:1420`, `host-actions.ts:1122`, `ctl/git.ts:129`)
  into pure `core/src/sync/git-refs.ts` (shared by relay-host + ctl-box — this is why they're
  in `core`). Point `runGitRpc`/`runDownloadRpc`/`handleGitRpc` at shared `sync/git`+`sync/files`.
  Relay gating/token/poll unchanged.
- **Phase 10 — close the two wiring gaps.** Thread `relay.controlPlaneUrl` →
  `CreateBoxRequest` → box forwarder-upstream (`cloud-provider.ts:583-594`,
  `bootstrap-launch.ts:52-78`) + persist topology on `BoxRecord`; set `AGENTBOX_GIT_LEASE=1`
  in-box when the relay is the plane (in-box daemon `ctl/commands/daemon.ts`).

## Per-phase gate
`pnpm build && pnpm typecheck && pnpm lint`, then package tests (core, sandbox-core,
sandbox-docker, sandbox-cloud, relay, cli). Before pushing: the real-box smoke matrix
(`docs/sync-layer-refactor.md` §Remaining notes) across {local,vercel,hetzner}×{claude,codex}.
