import { ensureVolume, execInBox, type DockerExecResult } from './docker.js';

export type IdeFlavor = 'vscode' | 'cursor';

interface IdeProfile {
  /** Container path the IDE's server installs into. */
  serverDir: string;
  /** Container path of the extensions subdir under serverDir. */
  extensionsDir: string;
  /** Per-box volume name = perBoxVolumePrefix + boxId. */
  perBoxVolumePrefix: string;
  /** Shared extensions volume name (never auto-removed). */
  sharedExtensionsVolume: string;
  /** Host CLI binary that opens this IDE (`code` / `cursor`). */
  cli: string;
  /** Human-readable label used in CLI output. */
  displayName: string;
  /** macOS protocol scheme for the `open` fallback (no trailing colon). */
  protocolScheme: string;
}

const PROFILES: Record<IdeFlavor, IdeProfile> = {
  vscode: {
    serverDir: '/home/vscode/.vscode-server',
    extensionsDir: '/home/vscode/.vscode-server/extensions',
    perBoxVolumePrefix: 'agentbox-vscode-server-',
    sharedExtensionsVolume: 'agentbox-vscode-extensions',
    cli: 'code',
    displayName: 'VS Code',
    protocolScheme: 'vscode',
  },
  cursor: {
    serverDir: '/home/vscode/.cursor-server',
    extensionsDir: '/home/vscode/.cursor-server/extensions',
    perBoxVolumePrefix: 'agentbox-cursor-server-',
    sharedExtensionsVolume: 'agentbox-cursor-extensions',
    cli: 'cursor',
    displayName: 'Cursor',
    protocolScheme: 'cursor',
  },
};

export const IDE_FLAVORS: readonly IdeFlavor[] = ['vscode', 'cursor'];

export function ideProfile(flavor: IdeFlavor): IdeProfile {
  return PROFILES[flavor];
}

/**
 * Shared across all boxes. Holds downloaded VS Code extensions so the second
 * box onward doesn't re-download them. Never auto-removed by destroy/prune
 * (parallel to SHARED_CLAUDE_VOLUME).
 */
export const SHARED_VSCODE_EXTENSIONS_VOLUME = PROFILES.vscode.sharedExtensionsVolume;

/** Same idea for Cursor's downloaded extensions. */
export const SHARED_CURSOR_EXTENSIONS_VOLUME = PROFILES.cursor.sharedExtensionsVolume;

/** Per-box VS Code server volume name. Holds server binary + TS cache + workspace state. */
export function vscodeServerVolumeName(boxId: string): string {
  return ideServerVolumeName('vscode', boxId);
}

/** Per-box Cursor server volume name. */
export function cursorServerVolumeName(boxId: string): string {
  return ideServerVolumeName('cursor', boxId);
}

export function ideServerVolumeName(flavor: IdeFlavor, boxId: string): string {
  return `${PROFILES[flavor].perBoxVolumePrefix}${boxId}`;
}

export interface IdeMounts {
  /** Volume names to ensure() before runBox. */
  volumes: string[];
  /** `-v` arg values to pass to runBox. */
  extraVolumes: string[];
}

/**
 * Build the volume mounts for one IDE flavor: per-box `.vscode-server` (or
 * `.cursor-server`) mounts first, then the shared extensions volume layered
 * over its `extensions` subdir.
 */
export function buildFlavorMounts(flavor: IdeFlavor, boxId: string): IdeMounts {
  const profile = PROFILES[flavor];
  const perBox = ideServerVolumeName(flavor, boxId);
  return {
    volumes: [perBox, profile.sharedExtensionsVolume],
    extraVolumes: [
      `${perBox}:${profile.serverDir}`,
      `${profile.sharedExtensionsVolume}:${profile.extensionsDir}`,
    ],
  };
}

/** VS Code subset — kept for callers that only want the VS Code mounts. */
export function buildVscodeMounts(boxId: string): IdeMounts {
  return buildFlavorMounts('vscode', boxId);
}

/**
 * All IDE flavors' mounts unioned together. This is what createBox uses so
 * any existing box can be opened with either IDE without recreating.
 */
export function buildIdeMounts(boxId: string): IdeMounts {
  const merged: IdeMounts = { volumes: [], extraVolumes: [] };
  for (const f of IDE_FLAVORS) {
    const m = buildFlavorMounts(f, boxId);
    merged.volumes.push(...m.volumes);
    merged.extraVolumes.push(...m.extraVolumes);
  }
  return merged;
}

/** Ensure VS Code's volumes exist. */
export async function ensureVscodeVolumes(boxId: string): Promise<void> {
  for (const v of buildFlavorMounts('vscode', boxId).volumes) await ensureVolume(v);
}

/** Ensure every IDE flavor's volumes exist. */
export async function ensureIdeVolumes(boxId: string): Promise<void> {
  for (const v of buildIdeMounts(boxId).volumes) await ensureVolume(v);
}

/**
 * Belt-and-suspenders chown of the server trees after the named volumes are
 * mounted. The Dockerfile pre-creates these dirs so first-mount inherits
 * vscode:vscode ownership, but a shared extensions volume might already exist
 * from a box created against an older image where the dirs weren't seeded —
 * in that case the volume is root-owned and the Dev Containers extension
 * fails with "mkdir: cannot create directory '<server>/bin': Permission
 * denied". One docker exec fixes it idempotently for both flavors.
 */
export async function repairVscodeServerOwnership(container: string): Promise<void> {
  await execInBox(container, ['chown', '-R', 'vscode:vscode', PROFILES.vscode.serverDir], {
    user: 'root',
  });
}

export async function repairIdeOwnership(container: string): Promise<void> {
  for (const flavor of IDE_FLAVORS) {
    await execInBox(container, ['chown', '-R', 'vscode:vscode', PROFILES[flavor].serverDir], {
      user: 'root',
    });
  }
}

export interface AttachedContainerUriOptions {
  /** Active Docker context (e.g. "desktop-linux" / "orbstack"). Embedded in
   *  the URI's `settings.context` so the Dev Containers extension queries the
   *  same daemon agentbox created the container in. Omitted → the extension
   *  falls back to its own default context. */
  dockerContext?: string;
  /** Folder opened inside the container (default `/workspace`). */
  workspacePath?: string;
}

/**
 * Resource URI for an attached container, consumed by `code --folder-uri` /
 * `cursor --folder-uri` (Cursor is a VS Code fork — same URI scheme).
 *
 * The modern Dev Containers extension expects the `attached-container+<hex>`
 * authority to decode to a JSON payload, not a bare name:
 *
 *   attached-container+hex({"containerName":"/<name>","settings":{"context":"<ctx>"}})
 *
 * `containerName` keeps the leading slash docker's own `.Name` field carries.
 * `settings.context` pins the Docker context — without it, after switching
 * engines (OrbStack ⇄ Docker Desktop) the extension probes the wrong daemon
 * and reports the container as non-existent ("…because it no longer exists").
 *
 * Note: the `vscode://vscode-remote/...` protocol-handler form looks similar
 * but goes through macOS `open`, which percent-encodes the `+` authority
 * separator into `%2B` and the extension then fails to resolve it. Use
 * `<cli> --folder-uri <this>` to bypass that.
 */
export function attachedContainerUri(
  containerName: string,
  opts: AttachedContainerUriOptions = {},
): string {
  const workspacePath = opts.workspacePath ?? '/workspace';
  const payload: { containerName: string; settings?: { context: string } } = {
    containerName: containerName.startsWith('/') ? containerName : `/${containerName}`,
  };
  if (opts.dockerContext) payload.settings = { context: opts.dockerContext };
  const hex = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  return `vscode-remote://attached-container+${hex}${workspacePath}`;
}

/**
 * agentbox-managed `.vscode/tasks.json` lives in the overlay's upper layer so
 * it doesn't pollute the host's working tree. The sentinel comment lets us
 * detect our own file and regenerate it on every `agentbox code` invocation
 * without overwriting a user-authored one. The file lives at `.vscode/` —
 * Cursor reads the same path (VS Code fork), so no per-IDE variant needed.
 */
const SENTINEL =
  '// agentbox-managed: regenerated on `agentbox code`; remove this header to take ownership';

export type ServiceTailHint = { name: string };

export interface EnsureTasksFileResult {
  status: 'wrote' | 'skipped-user-owned' | 'skipped-no-services';
}

/**
 * Write (or skip) `/workspace/.vscode/tasks.json` inside the container. Each
 * service in `services` gets a background task that tails its log so the IDE
 * shows a dedicated terminal panel on attach.
 *
 *  - File absent → write.
 *  - File present with our sentinel → overwrite.
 *  - File present without sentinel → skip (user owns it). Caller can force
 *    by setting `regen: true`.
 */
export async function ensureAgentboxTasksFile(
  container: string,
  services: ServiceTailHint[],
  opts: { regen?: boolean } = {},
): Promise<EnsureTasksFileResult> {
  if (services.length === 0) return { status: 'skipped-no-services' };

  const existing = await execInBox(container, ['cat', '/workspace/.vscode/tasks.json'], {
    user: 'vscode',
  });
  if (existing.exitCode === 0 && !opts.regen && !existing.stdout.includes(SENTINEL)) {
    return { status: 'skipped-user-owned' };
  }

  const tasks = services.map((s) => ({
    label: `agentbox: ${s.name}`,
    type: 'shell',
    command: `tail -F /var/log/agentbox/${s.name}.log`,
    isBackground: true,
    presentation: { panel: 'dedicated', reveal: 'always', echo: false },
    runOptions: { runOn: 'folderOpen' },
    problemMatcher: [] as unknown[],
  }));
  const body =
    `${SENTINEL}\n` +
    JSON.stringify(
      {
        version: '2.0.0',
        tasks,
      },
      null,
      2,
    ) +
    '\n';

  await execInBox(container, ['mkdir', '-p', '/workspace/.vscode'], { user: 'vscode' });
  const write = await writeFileInBox(container, '/workspace/.vscode/tasks.json', body);
  if (write.exitCode !== 0) {
    throw new Error(`failed to write tasks.json in ${container}: ${write.stderr || write.stdout}`);
  }
  return { status: 'wrote' };
}

async function writeFileInBox(
  container: string,
  path: string,
  content: string,
): Promise<DockerExecResult> {
  const { execa } = await import('execa');
  const result = await execa(
    'docker',
    ['exec', '-i', '--user', 'vscode', container, 'sh', '-c', `cat > ${shellQuote(path)}`],
    { input: content, reject: false },
  );
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Backward-compat alias for the previous mount type name.
export type VscodeMounts = IdeMounts;
