import { unpauseBox } from '@agentbox/sandbox-docker';
import { Command } from 'commander';
import { handleLifecycleError } from './_errors.js';

export const unpauseCommand = new Command('unpause')
  .description('Resume a paused box (docker unpause — sub-second)')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .action(async (idOrName: string) => {
    try {
      const record = await unpauseBox(idOrName);
      process.stdout.write(`unpaused ${record.container}\n`);
    } catch (err) {
      handleLifecycleError(err);
    }
  });
