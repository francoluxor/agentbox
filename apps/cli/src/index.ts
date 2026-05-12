import { Command } from 'commander';
import { createCommand } from './commands/create.js';

const program = new Command();

program
  .name('agentbox')
  .description('Launch coding agents in isolated sandboxes')
  .version('0.0.0');

program.addCommand(createCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
