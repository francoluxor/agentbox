import { pauseBox } from '@agentbox/sandbox-docker';
import { Command } from 'commander';
import { handleLifecycleError } from './_errors.js';

export const pauseCommand = new Command('pause')
  .description('Freeze a box (docker pause — 0 CPU, RAM stays mapped)')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .action(async (idOrName: string) => {
    try {
      const record = await pauseBox(idOrName);
      process.stdout.write(`paused ${record.container}\n`);
    } catch (err) {
      handleLifecycleError(err);
    }
  });
