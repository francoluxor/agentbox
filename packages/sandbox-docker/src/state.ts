import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const STATE_DIR = join(homedir(), '.agentbox');
export const STATE_FILE = join(STATE_DIR, 'state.json');

export interface BoxRecord {
  id: string;
  name: string;
  container: string;
  image: string;
  workspacePath: string;
  lowerPath: string;
  upperVolume: string;
  nodeModulesVolume: string;
  snapshotDir: string | null;
  createdAt: string; // ISO-8601
}

export interface StateFile {
  version: 1;
  boxes: BoxRecord[];
}

const EMPTY: StateFile = { version: 1, boxes: [] };

export async function readState(path: string = STATE_FILE): Promise<StateFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as StateFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.boxes)) {
      throw new Error(`unrecognized state file shape at ${path}`);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY };
    }
    throw err;
  }
}

export async function writeState(state: StateFile, path: string = STATE_FILE): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export async function recordBox(box: BoxRecord, path: string = STATE_FILE): Promise<void> {
  const state = await readState(path);
  const next: StateFile = {
    version: 1,
    boxes: [...state.boxes.filter((b) => b.id !== box.id), box],
  };
  await writeState(next, path);
}
