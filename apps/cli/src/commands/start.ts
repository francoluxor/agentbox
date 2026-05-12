import { startBox } from '@agentbox/sandbox-docker';
import { Command } from 'commander';
import { handleLifecycleError } from './_errors.js';

export const startCommand = new Command('start')
  .description('Start a stopped box (docker start + re-mount the FUSE overlay)')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .action(async (idOrName: string) => {
    try {
      const { record, overlayChecks } = await startBox(idOrName);
      process.stdout.write(`started ${record.container}\n`);
      const failed = overlayChecks.filter((c) => !c.ok);
      if (failed.length > 0) {
        for (const c of failed) {
          process.stderr.write(`  ✗ ${c.name}: ${c.detail}\n`);
        }
        process.exit(1);
      }
      for (const c of overlayChecks) {
        process.stdout.write(`  ✓ ${c.name}\n`);
      }
    } catch (err) {
      handleLifecycleError(err);
    }
  });
