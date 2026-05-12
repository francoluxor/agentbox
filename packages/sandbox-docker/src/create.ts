import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { containerExists, dockerInfo, ensureVolume, runBox } from './docker.js';
import { DEFAULT_BOX_IMAGE, ensureImage } from './image.js';
import { mountOverlay, verifyOverlay, type OverlayCheck } from './overlay.js';
import { recordBox, type BoxRecord } from './state.js';
import { createSnapshot, snapshotPathFor } from './snapshot.js';

export interface CreateBoxOptions {
  workspacePath: string;
  name?: string;
  useSnapshot: boolean;
  image?: string;
  onLog?: (line: string) => void;
}

export interface CreatedBox {
  record: BoxRecord;
  overlayChecks: OverlayCheck[];
  imageBuilt: boolean;
}

function generateBoxId(): string {
  return randomBytes(4).toString('hex');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function buildAgentMounts(): Promise<string[]> {
  const home = homedir();
  const candidates: Array<{ src: string; dst: string; readOnly: boolean }> = [
    { src: join(home, '.claude'), dst: '/home/vscode/.claude', readOnly: false },
    { src: join(home, '.codex'), dst: '/home/vscode/.codex', readOnly: false },
    { src: join(home, '.gitconfig'), dst: '/home/vscode/.gitconfig', readOnly: true },
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (await pathExists(c.src)) {
      out.push(`${c.src}:${c.dst}${c.readOnly ? ':ro' : ''}`);
    }
  }
  return out;
}

export async function createBox(opts: CreateBoxOptions): Promise<CreatedBox> {
  const log = opts.onLog ?? (() => {});
  const workspace = resolve(opts.workspacePath);
  if (!(await pathExists(workspace))) {
    throw new Error(`workspace does not exist: ${workspace}`);
  }

  await dockerInfo();
  log('docker daemon reachable');

  const imageRef = opts.image ?? DEFAULT_BOX_IMAGE;
  const { built } = await ensureImage(imageRef, {
    onProgress: (line) => log(`[image] ${line}`),
  });
  log(built ? `built image ${imageRef}` : `using cached image ${imageRef}`);

  const id = generateBoxId();
  const containerName = `agentbox-${opts.name ?? id}`;
  if (await containerExists(containerName)) {
    throw new Error(`container ${containerName} already exists; remove it first`);
  }

  let lowerPath = workspace;
  let snapshotDir: string | null = null;
  if (opts.useSnapshot) {
    snapshotDir = snapshotPathFor(id);
    log(`cloning workspace to ${snapshotDir} (APFS clone where available)`);
    const snap = await createSnapshot({ source: workspace, destination: snapshotDir });
    log(`pruned ${snap.prunedPaths.length} platform-dependent dirs from snapshot`);
    lowerPath = snapshotDir;
  }

  const upperVolume = `agentbox-upper-${id}`;
  const nodeModulesVolume = `agentbox-nm-${id}`;
  await ensureVolume(upperVolume);
  await ensureVolume(nodeModulesVolume);
  log(`prepared volumes ${upperVolume}, ${nodeModulesVolume}`);

  const extraVolumes = await buildAgentMounts();
  for (const v of extraVolumes) log(`mounting agent dir: ${v}`);

  await runBox({
    name: containerName,
    image: imageRef,
    lowerPath,
    upperVolume,
    nodeModulesVolume,
    extraVolumes,
    env: { AGENTBOX_BOX_ID: id },
  });
  log(`container ${containerName} started`);

  try {
    await mountOverlay(containerName);
    log('fuse-overlayfs mounted at /workspace');
  } catch (err) {
    log(
      `overlay mount failed; leaving container ${containerName} running so you can inspect it`,
    );
    throw err;
  }

  const overlayChecks = await verifyOverlay(containerName);
  const failed = overlayChecks.filter((c) => !c.ok);
  if (failed.length > 0) {
    const detail = failed.map((c) => `  - ${c.name}: ${c.detail}`).join('\n');
    throw new Error(`overlay verification failed:\n${detail}`);
  }
  log('overlay verified');

  const record: BoxRecord = {
    id,
    name: opts.name ?? id,
    container: containerName,
    image: imageRef,
    workspacePath: workspace,
    lowerPath,
    upperVolume,
    nodeModulesVolume,
    snapshotDir,
    createdAt: new Date().toISOString(),
  };
  await recordBox(record);

  return { record, overlayChecks, imageBuilt: built };
}

