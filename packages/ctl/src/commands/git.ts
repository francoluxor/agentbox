import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { postRpcAndExit } from '../relay-rpc.js';

interface CommonOptions {
  remote?: string;
  cwd?: string;
}

interface GitRpcParams {
  path: string;
  remote?: string;
  args?: string[];
}

function buildParams(opts: CommonOptions, extra: string[]): GitRpcParams {
  const params: GitRpcParams = { path: opts.cwd ?? process.cwd() };
  if (opts.remote) params.remote = opts.remote;
  if (extra.length > 0) params.args = extra;
  return params;
}

/**
 * Run a local `git` command inside the box, streaming output to the parent's
 * stdio. Used by `pull` for the in-container merge step (no creds needed —
 * the fetch already happened host-side via the relay).
 */
function runLocalGit(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      process.stderr.write(`agentbox-ctl git: ${String(err.message ?? err)}\n`);
      resolve(126);
    });
  });
}

interface PrSubcommandSpec {
  op: 'create' | 'view' | 'list' | 'comment' | 'review' | 'merge' | 'checkout' | 'close' | 'reopen';
  description: string;
}

/**
 * `gh pr` subcommands exposed via the relay. Each maps to RPC method
 * `gh.pr.<op>`. The relay validates the op server-side (must match `GH_PR_OPS`
 * in `@agentbox/relay/src/gh.ts`).
 *
 * Confirmation matrix lives host-side:
 *   - `view`, `list` → read-only, no prompt.
 *   - `create`, `comment`, `review`, `close`, `reopen` → prompt.
 *   - `merge` → prompt; AGENTBOX_PROMPT=off bypass requires AGENTBOX_GH_FORCE=1.
 *   - `checkout` → prompt + dirty-tree guard + opt-in (AGENTBOX_GH_PR_CHECKOUT=allow).
 */
const PR_SUBCOMMANDS: PrSubcommandSpec[] = [
  {
    op: 'create',
    description:
      'Run `gh pr create` on the host (creates a PR for this box\'s branch). User is prompted on the host wrapper.',
  },
  { op: 'view', description: 'Run `gh pr view` on the host (read-only; no prompt).' },
  { op: 'list', description: 'Run `gh pr list` on the host (read-only; no prompt).' },
  {
    op: 'comment',
    description: 'Run `gh pr comment` on the host (prompted; visible to others).',
  },
  {
    op: 'review',
    description: 'Run `gh pr review` on the host (prompted; visible to others).',
  },
  {
    op: 'merge',
    description:
      'Run `gh pr merge` on the host (prompted; destructive — AGENTBOX_PROMPT=off bypass requires AGENTBOX_GH_FORCE=1).',
  },
  {
    op: 'checkout',
    description:
      'Run `gh pr checkout` on the host (prompted + clean-tree guard; opt-in via AGENTBOX_GH_PR_CHECKOUT=allow because it switches the host main repo branch).',
  },
  { op: 'close', description: 'Run `gh pr close` on the host (prompted).' },
  { op: 'reopen', description: 'Run `gh pr reopen` on the host (prompted).' },
];

interface PrCommonOptions {
  cwd?: string;
}

const prCommand = new Command('pr').description(
  'PR operations via the host `gh` CLI (requires `gh` installed and `gh auth login` on the host)',
);
for (const spec of PR_SUBCOMMANDS) {
  prCommand.addCommand(
    new Command(spec.op)
      .description(spec.description)
      .option('--cwd <path>', 'container path identifying which registered worktree to use')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument(
        '[args...]',
        'extra flags forwarded to `gh pr <op>` verbatim (e.g. `--title`, `--body`, `--label`, `--draft`, `--json`).',
      )
      .action(async (args: string[], opts: PrCommonOptions) => {
        const params: GhPrRpcParams = { path: opts.cwd ?? process.cwd() };
        if (args.length > 0) params.args = args;
        const code = await postRpcAndExit(`gh.pr.${spec.op}`, params, {
          errorPrefix: 'agentbox-ctl git pr',
        });
        process.exit(code);
      }),
  );
}

interface GhPrRpcParams {
  path: string;
  args?: string[];
}

export const gitCommand = new Command('git')
  .description('Git operations that need host credentials (routed through the agentbox relay)')
  .addCommand(
    new Command('push')
      .description("Run `git push` on the host main repo against this box's branch (user is prompted on the host wrapper to confirm)")
      .option('--remote <name>', 'remote name (default: origin)')
      .option('--cwd <path>', 'container path identifying which registered worktree to use')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument(
        '[args...]',
        "extra flags appended to the host-built `git push <remote> <branch>` (e.g. `--force-with-lease`, `--tags`). Do NOT re-pass the remote or branch — they are taken from --remote and the registered worktree; appending them as positionals makes git treat them as refspecs and fail with `refs/remotes/origin/HEAD cannot be resolved to branch`. Use --remote to change the remote.",
      )
      .action(async (args: string[], opts: CommonOptions) => {
        const code = await postRpcAndExit('git.push', buildParams(opts, args), {
          errorPrefix: 'agentbox-ctl git',
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command('fetch')
      .description('Run `git fetch` on the host main repo (refs land in the shared .git)')
      .option('--remote <name>', 'remote name (default: origin)')
      .option('--cwd <path>', 'container path identifying which registered worktree to use')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument(
        '[args...]',
        'extra flags appended to the host-built `git fetch <remote> <branch>` (e.g. `--prune`, `--tags`). Do NOT re-pass the remote or branch; they come from --remote and the registered worktree (same gotcha as `push`).',
      )
      .action(async (args: string[], opts: CommonOptions) => {
        const code = await postRpcAndExit('git.fetch', buildParams(opts, args), {
          errorPrefix: 'agentbox-ctl git',
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command('pull')
      .description(
        'Fetch via the relay (host creds), then merge into the in-container working tree locally',
      )
      .option('--remote <name>', 'remote name (default: origin)')
      .option('--cwd <path>', 'container path identifying which registered worktree to use')
      .option('--ff-only', 'pass --ff-only to the local merge')
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .argument(
        '[args...]',
        'extra flags appended to the host-built `git fetch <remote> <branch>` (e.g. `--prune`). Do NOT re-pass the remote or branch; they come from --remote and the registered worktree (same gotcha as `push`).',
      )
      .action(
        async (
          args: string[],
          opts: CommonOptions & { ffOnly?: boolean },
        ) => {
          const fetchCode = await postRpcAndExit('git.fetch', buildParams(opts, args), {
            errorPrefix: 'agentbox-ctl git',
          });
          if (fetchCode !== 0) process.exit(fetchCode);
          // Merge happens in the container, where the working tree lives. No
          // creds needed; refs are already in the shared .git from the fetch.
          const remote = opts.remote ?? 'origin';
          // Resolve branch via the current HEAD's upstream, falling back to
          // `<remote>/HEAD` so a freshly cloned worktree still pulls.
          const cwd = opts.cwd ?? process.cwd();
          const mergeArgs = ['merge'];
          if (opts.ffOnly) mergeArgs.push('--ff-only');
          mergeArgs.push(`${remote}/HEAD`);
          const mergeCode = await runLocalGit(mergeArgs, cwd);
          process.exit(mergeCode);
        },
      ),
  )
  .addCommand(prCommand);
