import { log } from '@clack/prompts';
import { inspectBox, type BoxRecord, type InspectedBox } from '@agentbox/sandbox-docker';
import { projectCheckpointVolumeBytes } from '@agentbox/sandbox-docker';
import { renderEndpointLines } from '../endpoints-render.js';
import { fmtBytes } from '../fmt.js';
import { watchRender } from '../watch.js';
import { handleLifecycleError } from './_errors.js';

export interface InspectRunOptions {
  json?: boolean;
  watch?: boolean;
  interval?: string;
}

function fmtLimit(n: number | null | undefined, unit: string): string {
  return n && n > 0 ? `${String(n)}${unit}` : 'unlimited';
}

async function renderText(i: InspectedBox): Promise<string> {
  const lim = i.record.resourceLimits;
  const projectRoot = i.record.projectRoot ?? i.record.workspacePath;
  const ckptBytes = await projectCheckpointVolumeBytes(projectRoot);
  const upperHost = i.hostPaths.upperLiveOnHost
    ? `${i.hostPaths.upperLiveOnHost}  (live)`
    : `${i.hostPaths.upperExport}  (run \`agentbox open --upper\` to refresh)`;
  const lines: string[] = [
    `id            ${i.record.id}`,
    `name          ${i.record.name}`,
    `container     ${i.record.container}`,
    `image         ${i.record.image}`,
    `state         ${i.state}`,
    `overlay       ${i.overlayMounted ? 'mounted at /workspace' : 'not mounted'}`,
    `workspace     ${i.record.workspacePath}`,
    `project       ${i.record.projectRoot ?? '(unset — pre-feature box)'}`,
    `n             ${typeof i.record.projectIndex === 'number' ? String(i.record.projectIndex) : '(none)'}`,
    `lower         ${i.record.lowerPath}`,
    `upper volume  ${i.upperVolume.name}${i.upperVolume.mountpoint ? `  (${i.upperVolume.mountpoint})` : ''}`,
    `claude config ${i.record.claudeConfigVolume ?? '(none)'}`,
    `claude session ${renderClaudeSession(i)}`,
    `claude activity ${renderClaudeActivity(i)}`,
    `persisted     ${renderPersisted(i)}`,
    `playwright    ${i.record.withPlaywright ? 'yes' : 'no'}`,
    `env files     ${i.record.withEnv ? 'yes' : 'no'}`,
    'endpoints',
    ...renderEndpoints(i),
    `mem limit     ${lim?.memoryBytes ? fmtBytes(lim.memoryBytes) : 'unlimited'}`,
    `cpu limit     ${fmtLimit(lim?.cpus, '')}`,
    `pids limit    ${fmtLimit(lim?.pidsLimit, '')}`,
    `disk limit    ${lim?.disk ? `${lim.disk} (best-effort; no-op on overlay2/macOS)` : 'unlimited'}`,
    `snapshot dir  ${i.record.snapshotDir ?? '(none — live workspace mount)'}`,
    `snapshot size ${fmtBytes(i.snapshotSizeBytes)}`,
    `checkpoint vol ${ckptBytes === null ? '(none)' : fmtBytes(ckptBytes)}`,
    `host export   ${i.hostPaths.mergedExport}  (run \`agentbox open\` to refresh)`,
    `upper host    ${upperHost}`,
    `created       ${i.record.createdAt}`,
  ];
  return lines.join('\n');
}

function renderClaudeSession(i: InspectedBox): string {
  if (i.claudeSession === null) return '(n/a — box not running)';
  if (!i.claudeSession.running) return `not running ("${i.claudeSession.sessionName}")`;
  const since = i.claudeSession.startedAt ? ` since ${i.claudeSession.startedAt}` : '';
  return `running ("${i.claudeSession.sessionName}")${since}`;
}

function renderClaudeActivity(i: InspectedBox): string {
  const c = i.persistedStatus?.claude;
  if (!c) return '(none)';
  return `${c.state}${c.updatedAt ? ` (updated ${c.updatedAt})` : ''}`;
}

function renderPersisted(i: InspectedBox): string {
  const s = i.persistedStatus;
  if (!s) return '(none)';
  return (
    `${s.timestamp} ` +
    `(${String(s.services.length)} svc, ${String(s.tasks.length)} tasks, ${String(s.ports.length)} ports)`
  );
}

function renderEndpoints(i: InspectedBox): string[] {
  const lines = renderEndpointLines(i.endpoints, process.stdout);
  return lines.length > 0 ? lines : ['  (none)'];
}

// `agentbox inspect` was folded into `agentbox status --inspect`; this is the
// extracted body, called by status.ts with an already-resolved box.
export async function runInspect(box: BoxRecord, opts: InspectRunOptions): Promise<void> {
  try {
    if (opts.json && opts.watch) {
      log.error('cannot combine --json with --watch');
      process.exit(2);
    }
    if (opts.watch) {
      await watchRender(async () => renderText(await inspectBox(box.id)), opts.interval);
      return;
    }
    const result = await inspectBox(box.id);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write((await renderText(result)) + '\n');
    }
  } catch (err) {
    handleLifecycleError(err);
  }
}
