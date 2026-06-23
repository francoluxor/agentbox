/**
 * Restore the agent (Claude / Codex) that was running in a box before it
 * stopped — so a restart (or a cloud idle-timeout resume) looks like the box
 * never went down.
 *
 * The box's agent runs as a detached tmux session that dies with the
 * container/VM; the agent's session files survive in the (shared) config
 * volumes, but those are pooled across every box, so a file probe can't tell
 * whose session is whose. Instead the in-box activity hooks capture the live
 * session into per-box pointer files on the box's own writable layer (see
 * `@agentbox/ctl`'s session-pointer.ts):
 *   - `~/.local/state/agentbox/claude-session` — the exact Claude session id
 *     (claude exposes it on every hook payload; updated on /new, /branch).
 *   - `~/.local/state/agentbox/codex-active`    — presence marker (Codex exposes
 *     no resumable id, so restore falls back to `codex resume --last`).
 *
 * On restart we read those pointers over `provider.exec` and relaunch the agent
 * resuming the exact (claude) / most-recent-in-cwd (codex) session. OpenCode is
 * skipped — it has no session-resume support yet.
 */
import { loadEffectiveConfig } from '@agentbox/config';
import type { BoxRecord, Provider } from '@agentbox/core';
import { startClaudeSession, startCodexSession } from '@agentbox/sandbox-docker';
import { cloudAgentStartDetached } from './commands/_cloud-attach.js';
import { applyClaudeSkipPermissions, applyCodexSkipPermissions } from './lib/skip-permissions.js';

/** Agents that support session resume. OpenCode is excluded. */
export type ResumableAgent = 'claude' | 'codex';

const POINTER_DIR = '"$HOME/.local/state/agentbox"';
const CLAUDE_POINTER = `${POINTER_DIR}/claude-session`;
const CODEX_MARKER = `${POINTER_DIR}/codex-active`;

/** Run a small read-only shell snippet in the box; '' on any failure. */
async function execRead(provider: Provider, box: BoxRecord, script: string): Promise<string> {
  try {
    const r = await provider.exec(box, ['bash', '-lc', script], { user: 'vscode' });
    return r.exitCode === 0 ? r.stdout.trim() : '';
  } catch {
    return '';
  }
}

/** True if a tmux session by this name is already alive in the box. */
async function tmuxAlive(
  provider: Provider,
  box: BoxRecord,
  sessionName: string,
): Promise<boolean> {
  const q = `'${sessionName.replace(/'/g, `'\\''`)}'`;
  return (await execRead(provider, box, `tmux has-session -t ${q} 2>/dev/null && echo y`)) === 'y';
}

/**
 * The args to resume the box's recorded session for `kind`, or null if there's
 * nothing to resume. Claude resumes the exact captured id; Codex (no id) resumes
 * the most-recent session in the box's cwd. Skip-permissions is NOT applied here
 * — callers layer it via their own config (the attach paths already do).
 */
export async function agentResumeArgs(
  provider: Provider,
  box: BoxRecord,
  kind: ResumableAgent,
): Promise<string[] | null> {
  if (kind === 'claude') {
    const id = await execRead(provider, box, `cat ${CLAUDE_POINTER} 2>/dev/null`);
    // Guard: only a uuid-ish token is safe to hand to `claude --resume`.
    return /^[0-9a-fA-F][0-9a-fA-F-]{7,}$/.test(id) ? ['--resume', id] : null;
  }
  const ran = await execRead(provider, box, `test -f ${CODEX_MARKER} && echo y`);
  return ran === 'y' ? ['resume', '--last'] : null;
}

export interface RestoreOptions {
  onLog?: (line: string) => void;
}

/**
 * Re-launch (detached) whichever agents the box had running, resuming their
 * session. Idempotent: an already-live tmux session is left as-is. Best-effort
 * per agent — a relaunch failure is logged, never thrown (a box restart must not
 * fail because an agent couldn't resume).
 *
 * The box must already be running (call after `provider.start` / `startBox`).
 */
export async function restoreAgentSessions(
  box: BoxRecord,
  provider: Provider,
  opts: RestoreOptions = {},
): Promise<void> {
  const cfg = await loadEffectiveConfig(box.workspacePath).catch(() => null);
  const isDocker = (box.provider ?? 'docker') === 'docker';
  const kinds: Array<{ kind: ResumableAgent; sessionName: string }> = [
    { kind: 'claude', sessionName: cfg?.effective.claude.sessionName ?? 'claude' },
    { kind: 'codex', sessionName: cfg?.effective.codex.sessionName ?? 'codex' },
  ];
  for (const { kind, sessionName } of kinds) {
    if (await tmuxAlive(provider, box, sessionName)) continue;
    const resume = await agentResumeArgs(provider, box, kind);
    if (!resume) continue;
    const args =
      kind === 'claude'
        ? cfg
          ? applyClaudeSkipPermissions(resume, cfg.effective)
          : resume
        : cfg
          ? applyCodexSkipPermissions(resume, cfg.effective)
          : resume;
    try {
      if (isDocker) {
        if (kind === 'claude') {
          await startClaudeSession({ container: box.container, claudeArgs: args, sessionName });
        } else {
          await startCodexSession({ container: box.container, codexArgs: args, sessionName });
        }
      } else {
        await cloudAgentStartDetached({ box, binary: kind, sessionName, extraArgs: args });
      }
      opts.onLog?.(`resumed ${kind} session`);
    } catch (err) {
      opts.onLog?.(`could not resume ${kind} session: ${(err as Error).message}`);
    }
  }
}
