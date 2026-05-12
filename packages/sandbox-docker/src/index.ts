import type { SandboxProvider } from '@agentbox/core';

export {
  createBox,
  type CreateBoxOptions,
  type CreatedBox,
} from './create.js';
export { DEFAULT_BOX_IMAGE } from './image.js';
export { EXCLUDE_DIRS, SNAPSHOTS_ROOT, snapshotPathFor } from './snapshot.js';
export {
  STATE_DIR,
  STATE_FILE,
  readState,
  type BoxRecord,
  type StateFile,
} from './state.js';
export { OverlayError, type OverlayCheck } from './overlay.js';

const notYet = (op: string): never => {
  throw new Error(`@agentbox/sandbox-docker: ${op} is not yet implemented`);
};

// SandboxProvider conformance is wired up incrementally as we implement the
// rest of the lifecycle. For now only the create-equivalent (`start`) is real.
export const dockerProvider: SandboxProvider = {
  name: 'docker',
  async start(opts) {
    const { createBox } = await import('./create.js');
    const { record } = await createBox({
      workspacePath: opts.workspacePath,
      useSnapshot: false,
    });
    return {
      id: record.id,
      state: 'running',
      agent: opts.agent,
      workspacePath: record.workspacePath,
      createdAt: new Date(record.createdAt),
    };
  },
  async pause() {
    return notYet('pause');
  },
  async resume() {
    return notYet('resume');
  },
  async stop() {
    return notYet('stop');
  },
  async destroy() {
    return notYet('destroy');
  },
  async list() {
    const { readState } = await import('./state.js');
    const { boxes } = await readState();
    return boxes.map((b) => ({
      id: b.id,
      state: 'running' as const,
      agent: 'claude-code' as const,
      workspacePath: b.workspacePath,
      createdAt: new Date(b.createdAt),
    }));
  },
};
