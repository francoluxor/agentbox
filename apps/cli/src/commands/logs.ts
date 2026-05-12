import { log } from '@clack/prompts';
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import {
  AmbiguousBoxError,
  BoxNotFoundError,
  execInBox,
  findBox,
  readState,
} from '@agentbox/sandbox-docker';
import { handleLifecycleError } from './_errors.js';

interface LogsOptions {
  tail: string;
  follow?: boolean;
}

export const logsCommand = new Command('logs')
  .description('Print recent log lines from a box service; -f to stream')
  .argument('<box>', 'box id, id prefix, name, or container name')
  .argument('<service>', 'service name from agentbox.yaml')
  .option('-n, --tail <n>', 'how many recent lines to print first', '200')
  .option('-f, --follow', 'keep the connection open and stream new lines')
  .action(async (idOrName: string, service: string, opts: LogsOptions) => {
    try {
      const state = await readState();
      const result = findBox(idOrName, state);
      if (result.kind === 'none') throw new BoxNotFoundError(idOrName);
      if (result.kind === 'ambiguous') throw new AmbiguousBoxError(idOrName, result.matches);
      const box = result.box;

      const tail = String(Number.parseInt(opts.tail, 10) || 200);
      const args = ['agentbox-ctl', 'logs', service, '--tail', tail];
      if (opts.follow) args.push('--follow');

      if (!opts.follow) {
        const proc = await execInBox(box.container, args, { user: 'vscode' });
        if (proc.exitCode !== 0) {
          log.error(`agentbox-ctl logs failed: ${proc.stderr || proc.stdout}`);
          process.exit(1);
        }
        process.stdout.write(proc.stdout);
        if (!proc.stdout.endsWith('\n')) process.stdout.write('\n');
        return;
      }

      // Streaming: hand stdio to `docker exec` directly so the user sees lines
      // as the daemon emits them, and Ctrl-C kills both ends cleanly.
      const child = spawn('docker', ['exec', '--user', 'vscode', box.container, ...args], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('exit', (code) => process.exit(code ?? 0));
    } catch (err) {
      handleLifecycleError(err);
    }
  });
