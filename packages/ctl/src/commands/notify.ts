import { Command } from 'commander';
import { claudeState } from '../client.js';
import { DEFAULT_SOCKET_PATH, type ClaudeActivityState } from '../types.js';

interface NotifyOptions {
  socket: string;
  /** Reserved for future richer payload (the dashboard could surface this
   *  alongside the row indicator). Accepted but ignored in v1 so callers
   *  can already supply it. */
  message?: string;
}

/**
 * Agent-agnostic "I'm waiting for user input" signal. Internally an alias
 * for `agentbox-ctl claude-state waiting` so the existing claude hooks +
 * supervisor + box-status pipeline carries the state to the dashboard. The
 * separate command name future-proofs for codex et al. — they call
 * `agentbox-ctl notify` from their own hooks instead of touching the
 * claude-named primitive.
 *
 * Fire-and-forget — exits 0 even when the daemon is missing/dead, so a hook
 * that wires this up can never block or fail an agent's turn. Mirrors the
 * claude-state command's safety contract.
 */
async function reportState(opts: NotifyOptions, state: ClaudeActivityState): Promise<void> {
  try {
    await claudeState({ socketPath: opts.socket, timeoutMs: 1500 }, state);
  } catch {
    // best-effort: a missing / late daemon must never break a hook.
  }
}

export const notifyCommand = new Command('notify')
  .description(
    'Signal that the in-box agent is waiting for user input (highlights the box in the dashboard)',
  )
  .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
  .option('--message <text>', 'reserved for future use; accepted but ignored in v1')
  .action(async (opts: NotifyOptions) => {
    await reportState(opts, 'waiting');
    process.exit(0);
  })
  .addCommand(
    new Command('clear')
      .description('Clear the waiting state (alias for `claude-state idle`)')
      .option('--socket <path>', 'unix socket path', DEFAULT_SOCKET_PATH)
      .action(async (opts: NotifyOptions) => {
        await reportState(opts, 'idle');
        process.exit(0);
      }),
  );
