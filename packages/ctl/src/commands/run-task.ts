import { Command } from 'commander';
import { runTask } from '../client.js';
import { DEFAULT_SOCKET_PATH } from '../types.js';

interface RunTaskOptions {
  socket: string;
  force?: boolean;
  json?: boolean;
}

export const runTaskCommand = new Command('run-task')
  .description('Re-run a task by name. No-op if already done unless --force.')
  .argument('<name>')
  .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
  .option('--force', 're-run even if already done', false)
  .option('-j, --json', 'machine-readable JSON output')
  .action(async (name: string, opts: RunTaskOptions) => {
    const status = await runTask({ socketPath: opts.socket }, name, opts.force);
    if (opts.json) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    } else {
      process.stdout.write(`${status.name}: ${status.state}\n`);
    }
  });
