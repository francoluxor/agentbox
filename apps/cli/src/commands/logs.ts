import { log } from '@clack/prompts';
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { resolveBoxOrExit } from '../box-ref.js';
import { providerForBox } from '../provider/registry.js';
import { handleLifecycleError } from './_errors.js';

interface LogsOptions {
  tail: string;
  follow?: boolean;
}

export const logsCommand = new Command('logs')
  .description('Print recent log lines from a box service; -f to stream')
  // Both args optional so we can support `agentbox logs <service>` (auto-pick
  // the box) AND the original `agentbox logs <box> <service>`. Validation +
  // smart re-binding happens in the action handler.
  .argument(
    '[box]',
    'box ref (optional when cwd has exactly 1 box): project index, id, id prefix, name, or container',
  )
  .argument('[service]', 'service name from agentbox.yaml')
  .option('-n, --tail <n>', 'how many recent lines to print first', '200')
  .option('-f, --follow', 'keep the connection open and stream new lines')
  .action(async (boxArg: string | undefined, serviceArg: string | undefined, opts: LogsOptions) => {
    try {
      // Smart parse: if only one positional was given, commander binds it to
      // `boxArg` (the first positional). Treat that as the service and
      // auto-pick the box from the current project.
      let idOrName: string | undefined;
      let service: string | undefined;
      if (serviceArg !== undefined) {
        idOrName = boxArg;
        service = serviceArg;
      } else {
        idOrName = undefined;
        service = boxArg;
      }
      if (!service) {
        log.error('missing <service> argument');
        log.info('usage: agentbox logs [box] <service> [-n N] [-f]');
        process.exit(2);
      }

      const box = await resolveBoxOrExit(idOrName);
      const provider = await providerForBox(box);
      const isCloud = (box.provider ?? 'docker') !== 'docker';

      const tail = String(Number.parseInt(opts.tail, 10) || 200);
      const args = ['agentbox-ctl', 'logs', service, '--tail', tail];
      if (opts.follow) args.push('--follow');

      if (!opts.follow) {
        // Non-follow returns once the snapshot dump is done — safe to round-trip
        // through provider.exec on both docker and cloud.
        const proc = await provider.exec(box, args, { user: 'vscode' });
        if (proc.exitCode !== 0) {
          log.error(`agentbox-ctl logs failed: ${proc.stderr || proc.stdout}`);
          process.exit(1);
        }
        process.stdout.write(proc.stdout);
        if (!proc.stdout.endsWith('\n')) process.stdout.write('\n');
        return;
      }

      // Streaming. Docker keeps the spawn-docker-exec fast path so Ctrl-C
      // tears both ends down cleanly. Cloud goes through `provider.buildAttach`
      // which mints a fresh SSH token and runs `agentbox-ctl logs --follow`
      // directly (no tmux wrap — `kind: 'logs'` skips the tmux render).
      if (!isCloud) {
        const child = spawn('docker', ['exec', '--user', 'vscode', box.container, ...args], {
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        child.on('exit', (code) => process.exit(code ?? 0));
        return;
      }

      if (!provider.buildAttach) {
        throw new Error(
          `provider '${provider.name}' does not support follow-mode log streaming`,
        );
      }
      const spec = await provider.buildAttach(box, 'logs', {
        service,
        tail: Number.parseInt(tail, 10),
        follow: true,
        user: 'vscode',
      });
      const [argv0, ...rest] = spec.argv;
      if (!argv0) throw new Error('provider.buildAttach returned an empty argv');
      const child = spawn(argv0, rest, { stdio: ['ignore', 'inherit', 'inherit'] });
      const cleanup = async (): Promise<void> => {
        if (spec.cleanup) await spec.cleanup();
      };
      child.on('exit', async (code) => {
        await cleanup();
        process.exit(code ?? 0);
      });
      const term = (): void => {
        child.kill('SIGTERM');
      };
      process.on('SIGINT', term);
      process.on('SIGTERM', term);
    } catch (err) {
      handleLifecycleError(err);
    }
  });
