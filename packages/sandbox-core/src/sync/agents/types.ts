/**
 * `AgentSyncSpec` — the single source of truth for every per-tool datum the
 * sync layer needs (paths, credential locations, forwarded env keys,
 * capabilities). Generalizes the cloud `AGENT_SPECS` table
 * (`@agentbox/sandbox-cloud/agent-credentials.ts`) so the docker + cloud
 * providers, the driver, and the CLI all read one registry instead of
 * re-branching on tool name in ~10 places.
 *
 * This holds DATA only. Per-tool *behavior* that needs the host FS (static-tree
 * transforms, stage producers, box→host pull inventories) lives in
 * `@agentbox/sandbox-docker` today and migrates into `sync/agents/<tool>/` in
 * later phases; those fields are added to this spec as they move (a
 * sandbox-core registry can't reference sandbox-docker without a dependency
 * cycle).
 */

/** Canonical agent id. Mirrors `SyncAgentKind` from `@agentbox/core`. */
export type AgentId = 'claude' | 'codex' | 'opencode';

/**
 * One host static-config source dir and where it lands inside the box. Most
 * tools have exactly one; OpenCode has three (data / config / state), which is
 * why this is a list — its layout becomes data instead of tool-specific control
 * flow.
 */
export interface AgentPathMap {
  /** Host source dir, as path segments relative to `os.homedir()` (e.g. `['.claude']`). */
  hostHomeRel: string[];
  /** Absolute box dir the source's static config is mounted/extracted at. */
  boxDir: string;
  /**
   * Sub-path under `boxDir` to land this source at (OpenCode: config →
   * `config`, state → `.state/opencode`). Absent ⇒ land at `boxDir` root.
   */
  relocToSubpath?: string;
  /** rsync `--update` (newest-wins) — OpenCode `model.json` is two-way state. */
  update?: boolean;
  /**
   * rsync/tar `--exclude` patterns for this source. Populated per tool as the
   * static-config concern migrates (Phase 7); OpenCode's are already exact.
   */
  exclude?: string[];
}

/** Where this tool's login credential lives on the box, on the host backup, and in the cloud volume. */
export interface AgentCredential {
  /** File the agent reads/writes, relative to its primary box dir. */
  boxRelPath: string;
  /** Canonical absolute in-box path (for the box→host `cat` extract). */
  boxAbsPath: string;
  /** Host backup under `~/.agentbox` that survives box destroys. */
  hostBackup: string;
  /** Cloud shared-credentials-volume mount for this agent. */
  cloudMountPath: string;
  /** Sub-dir of the shared cloud credentials volume for this agent. */
  cloudSubpath: string;
}

/** Capabilities that genuinely differ per tool (drive resume/teleport/activity wiring). */
export interface AgentCapabilities {
  /** Session resume supported (`--resume`). OpenCode: false. */
  resume: boolean;
  /** Session-teleport support. OpenCode: a stub that throws. */
  teleport: 'full' | 'stub';
  /** How in-box activity is reported. OpenCode uses a plugin, not a tmux scraper. */
  activitySource: 'scraper' | 'plugin';
}

export interface AgentSyncSpec {
  id: AgentId;
  /** Alternate spellings that resolve to this spec (reconciles the wire `'claude-code'`). */
  aliases: string[];
  /** Default tmux session name. */
  sessionName: string;
  /** Shared docker config volume for this tool's static config. */
  dockerVolume: string;
  /** Host→box static-config source map (1 entry for claude/codex, 3 for opencode). */
  staticPaths: AgentPathMap[];
  credential: AgentCredential;
  /** Host env keys forwarded into the box so an env-authed agent finds its creds. */
  forwardedEnvKeys: readonly string[];
  /** Extra box run-env (OpenCode: `OPENCODE_CONFIG_DIR`, `XDG_STATE_HOME`). */
  boxRunEnv(): Record<string, string>;
  caps: AgentCapabilities;
}
