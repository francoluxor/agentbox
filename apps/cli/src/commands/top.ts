import { log } from '@clack/prompts';
import { Command } from 'commander';
import { findProjectRoot } from '@agentbox/config';
import {
  boxResourceStats,
  listBoxes,
  projectCheckpointVolumeBytes,
  type ListedBox,
} from '@agentbox/sandbox-docker';
import type { BoxResourceStats } from '@agentbox/core';
import { resolveBoxOrExit } from '../box-ref.js';
import { fmtBytes, fmtPercent } from '../fmt.js';
import { watchRender } from '../watch.js';
import { handleLifecycleError } from './_errors.js';

interface TopOptions {
  all?: boolean;
  once?: boolean;
  json?: boolean;
  interval?: string;
}

const COLS = ['BOX', 'STATE', 'CPU%', 'MEM USAGE / LIMIT', 'MEM%', 'PIDS', 'DISK', 'NET I/O'];

function row(name: string, state: string, s: BoxResourceStats): string[] {
  const mem = `${fmtBytes(s.memUsedBytes)} / ${fmtBytes(s.memLimitBytes)}`;
  const net =
    s.netRxBytes === null && s.netTxBytes === null
      ? '—'
      : `${fmtBytes(s.netRxBytes)} / ${fmtBytes(s.netTxBytes)}`;
  return [
    name,
    state,
    fmtPercent(s.cpuPercent),
    s.live ? mem : '—',
    fmtPercent(s.memPercent),
    s.pids === null ? '—' : String(s.pids),
    fmtBytes(s.diskUsedBytes),
    s.live ? net : '—',
  ];
}

function renderTable(rows: string[][]): string {
  const all = [COLS, ...rows];
  const widths = COLS.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  return all
    .map((r) => r.map((cell, c) => cell.padEnd(widths[c]!)).join('  ').trimEnd())
    .join('\n');
}

async function selectBoxes(
  idOrName: string | undefined,
  opts: TopOptions,
): Promise<ListedBox[]> {
  const boxes = await listBoxes();
  if (opts.all) {
    const project = await findProjectRoot(process.cwd());
    const scoped = boxes.filter((b) => b.projectRoot === project.root);
    if (scoped.length === 0) {
      log.error('no boxes for this project');
      process.exit(2);
    }
    return scoped;
  }
  const picked = await resolveBoxOrExit(idOrName);
  return boxes.filter((b) => b.id === picked.id);
}

async function snapshot(
  idOrName: string | undefined,
  opts: TopOptions,
): Promise<{ boxes: ListedBox[]; stats: BoxResourceStats[] }> {
  const boxes = await selectBoxes(idOrName, opts);
  const stats = await Promise.all(boxes.map((b) => boxResourceStats(b)));
  return { boxes, stats };
}

async function renderProjectFooters(
  boxes: ListedBox[],
  stats: BoxResourceStats[],
): Promise<string> {
  // Shared/durable: the per-project checkpoint volume is one volume across all
  // the project's boxes — count it once here, never summed into a box's DISK
  // column. Host snapshots ARE per-box, so summing is correct.
  const footers: string[] = [];
  const projectRoot = boxes[0]?.projectRoot ?? boxes[0]?.workspacePath ?? process.cwd();
  const ckpt = await projectCheckpointVolumeBytes(projectRoot);
  if (ckpt !== null) footers.push(`project checkpoint volume: ${fmtBytes(ckpt)}`);
  const snapTotal = stats.reduce((a, s) => a + (s.snapshotDiskBytes ?? 0), 0);
  if (snapTotal > 0) footers.push(`host snapshots: ${fmtBytes(snapTotal)}`);
  return footers.length > 0 ? `\n\n${footers.join('\n')}` : '';
}

export const topCommand = new Command('top')
  .description('Live resource monitor (cpu/mem/pids/disk) for a box or the whole project')
  .argument(
    '[box]',
    'box ref (default: the only box in this project; use --all for every project box)',
  )
  .option('-a, --all', "show every box in the cwd's project")
  .option('--once', 'print a single snapshot instead of watching')
  .option('-j, --json', 'machine-readable JSON (implies --once)')
  .option('--interval <seconds>', 'refresh interval', '2')
  .action(async (idOrName: string | undefined, opts: TopOptions) => {
    try {
      if (opts.json) {
        const { boxes, stats } = await snapshot(idOrName, opts);
        process.stdout.write(
          JSON.stringify(
            boxes.map((b, i) => ({ box: b.name, state: b.state, ...stats[i]! })),
            null,
            2,
          ) + '\n',
        );
        return;
      }

      const produce = async (): Promise<string> => {
        const { boxes, stats } = await snapshot(idOrName, opts);
        const rows = boxes.map((b, i) => row(b.name, b.state, stats[i]!));
        return renderTable(rows) + (await renderProjectFooters(boxes, stats));
      };

      if (opts.once) {
        process.stdout.write((await produce()) + '\n');
        return;
      }
      await watchRender(produce, opts.interval);
    } catch (err) {
      handleLifecycleError(err);
    }
  });
