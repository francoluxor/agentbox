import { confirm, isCancel, log } from '@clack/prompts';
import {
  destroyBox,
  findBox,
  readState,
  type BoxRecord,
  type FindBoxResult,
} from '@agentbox/sandbox-docker';
import { Command } from 'commander';
import { handleLifecycleError } from './_errors.js';

interface DestroyOptions {
  yes?: boolean;
  keepSnapshot?: boolean;
}

async function resolveOrExit(idOrName: string): Promise<BoxRecord> {
  const state = await readState();
  const r: FindBoxResult = findBox(idOrName, state);
  if (r.kind === 'ok') return r.box;
  if (r.kind === 'none') {
    log.error(`no agentbox matches "${idOrName}"`);
    process.exit(2);
  }
  log.error(`"${idOrName}" matches multiple boxes: ${r.matches.map((m) => m.id).join(', ')}`);
  process.exit(2);
}

export const destroyCommand = new Command('destroy')
  .alias('rm')
  .description('Destroy a box and discard its upper volume')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .option('-y, --yes', 'skip the confirmation prompt')
  .option('--keep-snapshot', "don't delete the snapshot dir under ~/.agentbox/snapshots/")
  .action(async (idOrName: string, opts: DestroyOptions) => {
    try {
      const box = await resolveOrExit(idOrName);

      if (!opts.yes) {
        log.warn(`This will discard the upper volume — agent work-in-progress is lost.`);
        log.info(`id:        ${box.id}`);
        log.info(`container: ${box.container}`);
        log.info(`upper:     ${box.upperVolume}`);
        if (box.snapshotDir) {
          log.info(
            `snapshot:  ${box.snapshotDir}${opts.keepSnapshot ? ' (will be kept)' : ''}`,
          );
        }
        const ok = await confirm({
          message: 'Destroy this box?',
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          log.info('cancelled');
          return;
        }
      }

      const result = await destroyBox(idOrName, { keepSnapshot: opts.keepSnapshot });
      const out: string[] = [`destroyed ${result.record.container}`];
      if (result.removedContainer) out.push('  ✓ container removed');
      out.push(`  ✓ volumes removed: ${result.removedVolumes.join(', ')}`);
      if (result.removedSnapshot) out.push(`  ✓ snapshot removed: ${result.removedSnapshot}`);
      else if (box.snapshotDir && opts.keepSnapshot) {
        out.push(`  · snapshot kept: ${box.snapshotDir}`);
      }
      process.stdout.write(out.join('\n') + '\n');
    } catch (err) {
      handleLifecycleError(err);
    }
  });
