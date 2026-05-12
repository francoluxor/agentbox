import { Command } from 'commander';
import { status } from '../client.js';
import { DEFAULT_SOCKET_PATH } from '../types.js';
import { renderStatusTable } from '../render.js';

interface StatusOptions {
  socket: string;
  json?: boolean;
}

export const statusCommand = new Command('status')
  .description('Show service status from the running daemon')
  .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
  .option('-j, --json', 'machine-readable JSON output')
  .action(async (opts: StatusOptions) => {
    const list = await status({ socketPath: opts.socket });
    if (opts.json) {
      process.stdout.write(JSON.stringify(list, null, 2) + '\n');
      return;
    }
    process.stdout.write(renderStatusTable(list) + '\n');
  });
