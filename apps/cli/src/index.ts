import { Command } from 'commander';
import { createCommand } from './commands/create.js';
import { destroyCommand } from './commands/destroy.js';
import { inspectCommand } from './commands/inspect.js';
import { listCommand } from './commands/list.js';
import { pauseCommand } from './commands/pause.js';
import { pruneCommand } from './commands/prune.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { unpauseCommand } from './commands/unpause.js';

const program = new Command();

program
  .name('agentbox')
  .description('Launch coding agents in isolated sandboxes')
  .version('0.0.0');

program.addCommand(createCommand);
program.addCommand(listCommand);
program.addCommand(inspectCommand);
program.addCommand(pauseCommand);
program.addCommand(unpauseCommand);
program.addCommand(stopCommand);
program.addCommand(startCommand);
program.addCommand(destroyCommand);
program.addCommand(pruneCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
