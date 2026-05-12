import { Command } from 'commander';
import { logs } from '../client.js';
import { DEFAULT_SOCKET_PATH } from '../types.js';
import type { LogEvent } from '../types.js';

interface LogsOptions {
  socket: string;
  tail: string;
  follow?: boolean;
}

function fmt(ev: LogEvent): string {
  return `${ev.ts} ${ev.stream === 'stderr' ? 'E' : 'O'} ${ev.line}`;
}

export const logsCommand = new Command('logs')
  .description('Print recent log lines for a service; -f to stream new ones')
  .argument('<service>', 'service name from agentbox.yaml')
  .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
  .option('-n, --tail <n>', 'how many recent lines to print first', '200')
  .option('-f, --follow', 'keep the connection open and stream new lines')
  .action(async (service: string, opts: LogsOptions) => {
    const tail = Number.parseInt(opts.tail, 10);
    const result = await logs(
      { socketPath: opts.socket },
      { service, tail: Number.isFinite(tail) ? tail : 200, follow: opts.follow ?? false },
    );
    for (const ev of result.initial) process.stdout.write(fmt(ev) + '\n');
    if (result.follow) {
      for await (const ev of result.follow) {
        process.stdout.write(fmt(ev) + '\n');
      }
    }
  });
