import { confirm, isCancel, log } from '@clack/prompts';
import { Command } from 'commander';
import { inspectBox, pullToHost, startBox, unpauseBox } from '@agentbox/sandbox-docker';
import { resolveBoxOrExit } from '../box-ref.js';
import { handleLifecycleError } from './_errors.js';

interface PullOpts {
  yes?: boolean;
  dryRun?: boolean;
  respectGitignore: boolean; // commander gives `--no-respect-gitignore` => false
  includeNodeModules?: boolean;
  refresh: boolean; // commander gives `--no-refresh` => false
}

export const pullCommand = new Command('pull')
  .description("Pull a box's /workspace back into your host workspace dir (gitignore-aware)")
  .argument(
    '[box]',
    'box ref: project index, id, id prefix, name, or container (default: the only box in this project)',
  )
  .option('-y, --yes', 'skip the confirmation prompt')
  .option('--dry-run', "print the change list and exit; don't write")
  .option(
    '--no-respect-gitignore',
    'disable git ls-files mode; use --exclude=node_modules,.git instead',
  )
  .option(
    '--include-node-modules',
    'do not exclude node_modules in fallback mode (no effect in gitignore mode)',
  )
  .option('--no-refresh', "skip the box->scratch-dir rsync step (use whatever's already there)")
  .action(async (idOrName: string | undefined, opts: PullOpts) => {
    try {
      const box = await resolveBoxOrExit(idOrName);

      const insp = await inspectBox(box.id);
      if (insp.state === 'paused') {
        log.info('box is paused; unpausing');
        await unpauseBox(box.id);
      } else if (insp.state === 'stopped') {
        log.info('box is stopped; starting (remounting overlay)');
        await startBox(box.id);
      } else if (insp.state === 'missing') {
        throw new Error(`box ${box.name} has no container; was it destroyed?`);
      }

      const rootWorktree = box.gitWorktrees?.find((w) => w.kind === 'root');
      if (rootWorktree) {
        log.warn(
          `This box has been committing to branch \`${rootWorktree.branch}\` in a separate worktree.\n` +
            `For a git-aware merge instead of a file copy, run from your checkout:\n` +
            `  git merge ${rootWorktree.branch}\n` +
            `Continuing with rsync into ${box.workspacePath}`,
        );
      }

      const preview = await pullToHost(box, {
        dryRun: true,
        respectGitignore: opts.respectGitignore,
        includeNodeModules: opts.includeNodeModules,
        noRefresh: !opts.refresh,
      });

      if (preview.changes.length === 0) {
        process.stdout.write(`no changes to pull into ${box.workspacePath}\n`);
        return;
      }

      if (opts.dryRun) {
        for (const line of preview.changes) process.stdout.write(`${line}\n`);
        process.stdout.write(
          `\n[dry-run] ${preview.changes.length} file(s) would change in ${box.workspacePath}\n`,
        );
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: `Pull ${preview.changes.length} changed file(s) into ${box.workspacePath}?`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          log.info('cancelled');
          return;
        }
      }

      const result = await pullToHost(box, {
        dryRun: false,
        respectGitignore: opts.respectGitignore,
        includeNodeModules: opts.includeNodeModules,
        // The dry-run pass above already refreshed (or intentionally skipped)
        // the scratch dir — don't rsync box->scratch a second time.
        noRefresh: true,
      });
      process.stdout.write(
        `updated ${result.changes.length} file(s) in ${result.hostPath}` +
          `${result.usedGitignore ? '' : ' (exclude-list mode)'}\n`,
      );
    } catch (err) {
      handleLifecycleError(err);
    }
  });
