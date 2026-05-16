import { confirm, isCancel, log } from '@clack/prompts';
import { Command } from 'commander';
import { findProjectRoot, loadEffectiveConfig, setConfigValue } from '@agentbox/config';
import {
  createCheckpoint,
  inspectBox,
  listCheckpoints,
  removeCheckpoint,
  startBox,
  unpauseBox,
} from '@agentbox/sandbox-docker';
import { resolveBoxOrExit } from '../box-ref.js';
import { handleLifecycleError } from './_errors.js';

interface CreateOpts {
  name?: string;
  merged?: boolean;
  setDefault?: boolean;
}

async function projectRootFor(cwd: string, recordRoot?: string): Promise<string> {
  return recordRoot ?? (await findProjectRoot(cwd)).root;
}

const createSub = new Command('create')
  .description('Capture a box state as a project checkpoint (<box-name>-<n>)')
  .argument(
    '[box]',
    'box ref: project index, id, id prefix, name, or container (default: the only box in this project)',
  )
  .option('--name <name>', 'checkpoint name (default: <box-name>-<next>)')
  .option('--merged', 'flatten lower+upper into one tree instead of a layered delta')
  .option('--set-default', 'mark this checkpoint as the project default for new boxes')
  .action(async (idOrName: string | undefined, opts: CreateOpts) => {
    try {
      const box = await resolveBoxOrExit(idOrName);

      const insp = await inspectBox(box.id);
      if (insp.state === 'paused') {
        log.info('box is paused; unpausing');
        await unpauseBox(box.id);
      } else if (insp.state === 'stopped') {
        log.info('box is stopped; starting (remounting overlay)');
        await startBox(box.id);
      } else if (insp.state === 'missing') {
        throw new Error(`box ${box.name} has no container; was it destroyed?`);
      }

      const projectRoot = await projectRootFor(box.workspacePath, box.projectRoot);
      const cfg = await loadEffectiveConfig(projectRoot);

      const info = await createCheckpoint({
        box,
        projectRoot,
        name: opts.name,
        merged: opts.merged === true,
        setDefault: opts.setDefault === true,
        maxLayers: cfg.effective.checkpoint.maxLayers,
        onLog: (line) => log.info(line),
      });

      log.success(
        `checkpoint ${info.name} (${info.manifest.type}) -> ${info.dir}` +
          (opts.setDefault ? '  [project default]' : ''),
      );
      if (!opts.setDefault) {
        log.info(`make it the default for new boxes: agentbox checkpoint set-default ${info.name}`);
      }
    } catch (err) {
      handleLifecycleError(err);
    }
  });

const lsSub = new Command('ls')
  .description('List this project\'s checkpoints')
  .action(async () => {
    try {
      const projectRoot = (await findProjectRoot(process.cwd())).root;
      const cfg = await loadEffectiveConfig(projectRoot);
      const def = cfg.effective.box.defaultCheckpoint;
      const list = await listCheckpoints(projectRoot);
      if (list.length === 0) {
        process.stdout.write(`no checkpoints for ${projectRoot}\n`);
        return;
      }
      for (const c of list) {
        const flag = c.name === def ? ' *default' : '';
        process.stdout.write(
          `${c.name}  ${c.manifest.type}  from ${c.manifest.sourceBoxName}  ${c.manifest.createdAt}${flag}\n`,
        );
      }
    } catch (err) {
      handleLifecycleError(err);
    }
  });

const setDefaultSub = new Command('set-default')
  .description('Pin a checkpoint as the project default (box.defaultCheckpoint)')
  .argument('<ref>', 'checkpoint name')
  .action(async (ref: string) => {
    try {
      const projectRoot = (await findProjectRoot(process.cwd())).root;
      const list = await listCheckpoints(projectRoot);
      if (!list.some((c) => c.name === ref)) {
        throw new Error(`checkpoint not found: ${ref} (see \`agentbox checkpoint ls\`)`);
      }
      const r = await setConfigValue('project', 'box.defaultCheckpoint', ref, projectRoot);
      process.stdout.write(`project default checkpoint = ${ref}   (wrote ${r.path})\n`);
    } catch (err) {
      handleLifecycleError(err);
    }
  });

const rmSub = new Command('rm')
  .description('Delete a checkpoint')
  .argument('<ref>', 'checkpoint name')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action(async (ref: string, opts: { yes?: boolean }) => {
    try {
      const projectRoot = (await findProjectRoot(process.cwd())).root;
      if (!opts.yes) {
        const ok = await confirm({ message: `Delete checkpoint ${ref}?`, initialValue: false });
        if (isCancel(ok) || !ok) {
          log.info('cancelled');
          return;
        }
      }
      const removed = await removeCheckpoint(projectRoot, ref);
      if (!removed) throw new Error(`checkpoint not found: ${ref}`);
      process.stdout.write(`removed checkpoint ${ref}\n`);
    } catch (err) {
      handleLifecycleError(err);
    }
  });

export const checkpointCommand = new Command('checkpoint')
  .description('Capture and manage project checkpoints (warm box state new boxes can start from)')
  .addCommand(createSub, { isDefault: true })
  .addCommand(lsSub)
  .addCommand(setDefaultSub)
  .addCommand(rmSub);
