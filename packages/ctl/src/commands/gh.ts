import { Command } from 'commander';
import { postRpcAndExit } from '../relay-rpc.js';
import { buildPrCommand } from './pr-subcommands.js';

interface GhRepoCloneRpcParams {
  path: string;
  repo: string;
  targetPath?: string;
  args?: string[];
}

const repoCommand = new Command('repo')
  .description('GitHub repo operations via the host `gh` CLI (host runs `gh repo …` then ships results to the box)')
  .addCommand(
    new Command('clone')
      .description(
        "Clone a github repo into the box via host `gh repo clone`. The host clones into a tmpdir with its creds, bundles, and ships the bundle back; the box materialises the working copy and resets origin to the original URL.",
      )
      .option('--cwd <path>', 'container path identifying which registered worktree to use (default: cwd)')
      .option('--branch <name>', 'pass --branch <name> to host gh repo clone')
      .option('--depth <n>', 'pass --depth <n> to host gh repo clone')
      .argument('<repo>', 'github repo: owner/name shorthand or full URL')
      .argument('[dir]', 'target directory inside the box (default: derived from repo)')
      .action(
        async (
          repo: string,
          dir: string | undefined,
          opts: { cwd?: string; branch?: string; depth?: string },
        ) => {
          const params: GhRepoCloneRpcParams = {
            path: opts.cwd ?? process.cwd(),
            repo,
          };
          if (dir) params.targetPath = dir;
          const extra: string[] = [];
          if (opts.branch) extra.push('--branch', opts.branch);
          if (opts.depth) extra.push('--depth', opts.depth);
          if (extra.length > 0) params.args = extra;
          const code = await postRpcAndExit('gh.repo.clone', params, {
            errorPrefix: 'agentbox-ctl gh repo clone',
          });
          process.exit(code);
        },
      ),
  );

export const ghCommand = new Command('gh')
  .description('GitHub CLI operations routed through the relay (host `gh` runs with host creds; box never sees a token)')
  .addCommand(buildPrCommand('agentbox-ctl gh pr'))
  .addCommand(repoCommand);
