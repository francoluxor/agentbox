import { Command } from 'commander';
import { postRpcAndExit } from '../relay-rpc.js';

interface CpRpcParams {
  boxPath: string;
  hostPath: string;
  recursive?: boolean;
  /** tar glob patterns / bare dir names to exclude from the copy. */
  exclude?: string[];
  /** false to keep the heavy dirs the host CLI drops by default. */
  defaultExcludes?: boolean;
  /** true to copy even when the source is over the host's size limit. */
  yes?: boolean;
}

interface CpCliOptions {
  recursive: boolean;
  exclude: string[];
  defaultExcludes: boolean;
  yes: boolean;
}

function collectExclude(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

function buildCpParams(boxPath: string, hostPath: string, opts: CpCliOptions): CpRpcParams {
  const params: CpRpcParams = { boxPath, hostPath };
  if (opts.recursive === false) params.recursive = false;
  if (opts.exclude.length > 0) params.exclude = opts.exclude;
  if (opts.defaultExcludes === false) params.defaultExcludes = false;
  if (opts.yes) params.yes = true;
  return params;
}

/**
 * `agentbox-ctl cp toHost|fromHost <boxPath> <hostPath>` — ask the host
 * (via relay) to copy a file/dir between this box and the host. The user
 * is prompted on the host wrapper to confirm; denials come back as exit 10
 * with `denied by user` on stderr.
 *
 * `<boxPath>` is a path inside this container (no `<name>:` prefix — the
 * relay knows which box we are from the bearer token). `<hostPath>` may be
 * absolute, `~`-anchored, or relative — a relative path resolves against this
 * box's host workspace (the host dir that mirrors `/workspace`), not wherever
 * the host relay happens to be running.
 *
 * Direction labels chosen for clarity at the agent's call site:
 *   `toHost`   = box -> host (push out)
 *   `fromHost` = host -> box (pull in)
 */
export const cpCommand = new Command('cp')
  .description('Copy a file/dir between this box and the host (gated by user prompt on the host wrapper)')
  .addCommand(
    new Command('toHost')
      .description('Copy box:<boxPath> -> host:<hostPath>')
      .argument('<boxPath>', 'source path inside the container')
      .argument('<hostPath>', 'destination on the host (relative resolves against the box workspace)')
      .option('--no-recursive', 'reserved; current implementation is always recursive (docker cp -a)')
      .option('--exclude <pattern>', 'exclude paths matching <pattern> (repeatable)', collectExclude, [])
      .option('--no-default-excludes', 'keep heavy dirs the host drops by default (.git, node_modules, ...)')
      .option('-y, --yes', 'copy even if the source is over the host size limit')
      .action(async (boxPath: string, hostPath: string, opts: CpCliOptions) => {
        const code = await postRpcAndExit('cp.toHost', buildCpParams(boxPath, hostPath, opts), {
          errorPrefix: 'agentbox-ctl cp',
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command('fromHost')
      .description('Copy host:<hostPath> -> box:<boxPath>')
      .argument('<hostPath>', 'source on the host (relative resolves against the box workspace)')
      .argument('<boxPath>', 'destination path inside the container')
      .option('--no-recursive', 'reserved; current implementation is always recursive (docker cp -a)')
      .option('--exclude <pattern>', 'exclude paths matching <pattern> (repeatable)', collectExclude, [])
      .option('--no-default-excludes', 'keep heavy dirs the host drops by default (.git, node_modules, ...)')
      .option('-y, --yes', 'copy even if the source is over the host size limit')
      .action(async (hostPath: string, boxPath: string, opts: CpCliOptions) => {
        const code = await postRpcAndExit('cp.fromHost', buildCpParams(boxPath, hostPath, opts), {
          errorPrefix: 'agentbox-ctl cp',
        });
        process.exit(code);
      }),
  );
