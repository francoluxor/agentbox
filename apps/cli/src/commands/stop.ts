import { stopBox } from '@agentbox/sandbox-docker';
import { Command } from 'commander';
import { handleLifecycleError } from './_errors.js';

export const stopCommand = new Command('stop')
  .description('Stop a box (docker stop; preserves upper + node_modules volumes)')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .action(async (idOrName: string) => {
    try {
      const record = await stopBox(idOrName);
      process.stdout.write(
        `stopped ${record.container}\nrestart with: agentbox start ${record.name}\n`,
      );
    } catch (err) {
      handleLifecycleError(err);
    }
  });
