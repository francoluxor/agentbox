import { Command } from 'commander';
import { status } from '../client.js';
import { DEFAULT_SOCKET_PATH } from '../types.js';
import { renderStatusTable, renderTaskTable } from '../render.js';

interface StatusOptions {
  socket: string;
  json?: boolean;
}

export const statusCommand = new Command('status')
  .description('Show service + task status from the running daemon')
  .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
  .option('-j, --json', 'machine-readable JSON output')
  .action(async (opts: StatusOptions) => {
    const reply = await status({ socketPath: opts.socket });
    if (opts.json) {
      process.stdout.write(JSON.stringify(reply, null, 2) + '\n');
      return;
    }
    if (reply.tasks.length > 0) {
      process.stdout.write('TASKS\n');
      process.stdout.write(renderTaskTable(reply.tasks) + '\n\n');
    }
    process.stdout.write('SERVICES\n');
    process.stdout.write(renderStatusTable(reply.services) + '\n');
  });
