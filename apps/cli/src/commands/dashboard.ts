import { log } from '@clack/prompts';
import { Command } from 'commander';
import { findProjectRoot } from '@agentbox/config';
import {
  buildClaudeAttachArgv,
  claudeSessionInfo,
  listBoxes,
  type ListedBox,
} from '@agentbox/sandbox-docker';
import { resolveBoxOrExit } from '../box-ref.js';
import { Compositor, type RightTarget } from '../dashboard/compositor.js';
import type { PtySpawn, TerminalCtor } from '../dashboard/pty-session.js';
import type { SidebarBox } from '../dashboard/sidebar.js';
import { handleLifecycleError } from './_errors.js';

interface DashboardOptions {
  all?: boolean;
}

/** Same ordering the sidebar renders and switching steps through. */
function sortBoxes(boxes: ListedBox[]): ListedBox[] {
  return [...boxes].sort((a, b) => {
    const ai = a.projectIndex ?? Number.POSITIVE_INFINITY;
    const bi = b.projectIndex ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

function scoped(all: boolean, projectRoot: string, boxes: ListedBox[]): ListedBox[] {
  return sortBoxes(all ? boxes : boxes.filter((b) => b.projectRoot === projectRoot));
}

function toSidebar(b: ListedBox): SidebarBox {
  return { id: b.id, name: b.name, state: b.state, claudeActivity: b.claudeActivity };
}

export const dashboardCommand = new Command('dashboard')
  .description(
    'Split-screen TUI: box list + the selected box live Claude session (pure Node, no tmux)',
  )
  .argument(
    '[box]',
    'initial box (default: first running box in this project; --all for every project box)',
  )
  .option('-a, --all', "include every box in the cwd's project")
  .action(async (idOrName: string | undefined, opts: DashboardOptions) => {
    try {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        log.error('agentbox dashboard needs an interactive terminal');
        process.exit(2);
      }

      // node-pty is an optionalDependency and @xterm/headless is CJS — both are
      // dynamic-imported here so a missing native prebuild (or the CJS named
      // export issue) degrades only the dashboard, never the rest of the CLI.
      let ptySpawn: PtySpawn;
      let termCtor: TerminalCtor;
      try {
        const ptyMod = (await import('@homebridge/node-pty-prebuilt-multiarch')) as Record<
          string,
          unknown
        >;
        const xtermMod = (await import('@xterm/headless')) as Record<string, unknown>;
        const spawn =
          (ptyMod['spawn'] as unknown) ??
          (ptyMod['default'] as Record<string, unknown> | undefined)?.['spawn'];
        const Terminal =
          (xtermMod['Terminal'] as unknown) ??
          (xtermMod['default'] as Record<string, unknown> | undefined)?.['Terminal'];
        if (typeof spawn !== 'function' || typeof Terminal !== 'function') {
          throw new Error('terminal backend missing expected exports');
        }
        ptySpawn = spawn as unknown as PtySpawn;
        termCtor = Terminal as unknown as TerminalCtor;
      } catch {
        log.error(
          'agentbox dashboard is unavailable here (native terminal backend failed to load)',
        );
        log.info('use `agentbox claude` / `agentbox claude attach` instead');
        process.exit(2);
      }

      const project = await findProjectRoot(process.cwd());
      let all = Boolean(opts.all);
      const full = await listBoxes();
      const scoped0 = scoped(all, project.root, full);

      let initialId: string;
      if (idOrName !== undefined) {
        const picked = await resolveBoxOrExit(idOrName);
        initialId = picked.id;
        if (!scoped0.some((b) => b.id === picked.id)) all = true; // widen so it shows
      } else {
        if (scoped0.length === 0) {
          log.error(`no boxes in this project (${project.root})`);
          log.info('run `agentbox create` to make one, or pass --all / a box ref');
          process.exit(2);
        }
        initialId = (scoped0.find((b) => b.state === 'running') ?? scoped0[0]!).id;
      }

      const listCandidates = async (): Promise<SidebarBox[]> =>
        scoped(all, project.root, await listBoxes()).map(toSidebar);

      const resolveTarget = async (boxId: string): Promise<RightTarget> => {
        const box = (await listBoxes()).find((b) => b.id === boxId);
        if (!box) return { kind: 'placeholder', lines: ['', '  box not found'] };
        if (box.state !== 'running') {
          return {
            kind: 'placeholder',
            lines: ['', `  box ${box.name} is ${box.state}.`, `  Start it: agentbox start ${box.name}`],
          };
        }
        const info = await claudeSessionInfo(box.container);
        if (info.running) {
          return { kind: 'attach', argv: buildClaudeAttachArgv(box.container, info.sessionName) };
        }
        return {
          kind: 'placeholder',
          lines: [
            '',
            `  no Claude session in ${box.name}.`,
            `  Start one: agentbox claude start ${box.name}`,
          ],
        };
      };

      const compositor = new Compositor(
        { ptySpawn, termCtor, listCandidates, resolveTarget },
        initialId,
      );
      await compositor.run();
      process.exit(0);
    } catch (err) {
      handleLifecycleError(err);
    }
  });
