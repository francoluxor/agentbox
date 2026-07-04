/**
 * Reusable core of the headless `claude auth login` flow: drive `claude auth
 * login` in a throwaway docker container under a node-pty, mirror its output
 * verbatim, publish the OAuth URL it prints, feed back the pasted approval code,
 * and on success run the warm-up + host-backup sync.
 *
 * The IPC is injected (log/phase/code sinks) so two callers reuse the exact same
 * loop with different transports:
 *   - `_claude-login-worker.ts` (the CLI `agentbox claude login --headless`
 *     worker) uses file-backed state (`state.json` / `code`).
 *   - the create-job worker (`_run-queued-job.ts`) uses the queue manifest's
 *     `login` sub-state so the hub API/UI can surface it.
 *
 * PKCE requires the URL-printer and the code-exchanger to be the same process,
 * which is why this holds one live login process for its whole lifetime.
 */
import {
  buildClaudeLoginRunArgv,
  SHARED_CLAUDE_VOLUME,
  syncClaudeCredentials,
  volumeClaudeCredentials,
  warmUpClaudeCredentials,
} from '@agentbox/sandbox-docker';
import { loadPtyBackend } from '../pty/pty-backend.js';
import { extractOAuthUrl, type LoginPhase } from './claude-login-session.js';

const URL_TIMEOUT_MS = 60_000;
const CODE_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 500;
// After a code is submitted, a line that looks like a rejection means claude
// re-prompted rather than exited — so we drop back to awaiting-code and let the
// user retry against the same (still-valid) PKCE verifier.
const INVALID_CODE = /invalid|incorrect|not a valid|try again|expired|rejected/i;
const BUF_CAP = 64 * 1024;

/** Last meaningful line(s) of buffered output, stripped of escapes and clamped. */
function tailOf(buf: string): string {
  const clean = buf
    .replace(new RegExp('\\u001b\\[[0-9;?]*[ -\\/]*[@-~]', 'g'), '')
    .replace(/\r/g, '');
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const tail = lines.slice(-2).join(' ');
  return tail.length > 240 ? tail.slice(-240) : tail;
}

export interface LoginPhaseUpdate {
  url?: string;
  error?: string;
  lastError?: string;
  warmed?: boolean;
  exitCode?: number;
}

export interface RunClaudeLoginOptions {
  image: string;
  /** Shared claude credential volume the login writes into. */
  volume?: string;
  /** Login-method args forwarded to `claude auth login` (default `['--claudeai']`). */
  extraArgs?: string[];
  /** Verbatim mirror of the container's pty stream (do NOT reformat). */
  writeRaw: (chunk: string) => void;
  /** Optional annotated log line (progress notes, not the raw stream). */
  writeLog?: (line: string) => void;
  /** Publish a phase transition (url on `awaiting-code`, error/warmed on terminal). */
  onPhase: (phase: LoginPhase, update?: LoginPhaseUpdate) => void;
  /** Poll+consume a pasted approval code (return null when none is pending). */
  getCode: () => string | null | undefined;
  /** Abort the login (e.g. on SIGTERM); resolves with an error result. */
  signal?: AbortSignal;
  urlTimeoutMs?: number;
  codeTimeoutMs?: number;
}

export interface RunClaudeLoginResult {
  ok: boolean;
  error?: string;
  warmed?: boolean;
  exitCode?: number;
}

/**
 * Run one `claude auth login` to completion. Resolves when the login process
 * exits or a timeout/abort fires; `onPhase` is called for every transition
 * (`starting`→`awaiting-code`→`exchanging`→`done`/`error`) so the caller can
 * mirror state to its own transport.
 */
export async function runClaudeLogin(opts: RunClaudeLoginOptions): Promise<RunClaudeLoginResult> {
  const volume = opts.volume ?? SHARED_CLAUDE_VOLUME;
  const extraArgs = opts.extraArgs && opts.extraArgs.length > 0 ? opts.extraArgs : ['--claudeai'];
  const urlTimeoutMs = opts.urlTimeoutMs ?? URL_TIMEOUT_MS;
  const codeTimeoutMs = opts.codeTimeoutMs ?? CODE_TIMEOUT_MS;
  const writeLog = opts.writeLog ?? ((): void => {});

  const backend = await loadPtyBackend();
  if (!backend) {
    const error = 'pty-unavailable: the node-pty prebuild is not installed';
    opts.onPhase('error', { error });
    return { ok: false, error };
  }

  const dockerArgv = buildClaudeLoginRunArgv({ volume, image: opts.image, extraArgs });
  writeLog(`spawning: docker ${dockerArgv.join(' ')}`);

  return await new Promise<RunClaudeLoginResult>((resolve) => {
    let buf = '';
    let phase: LoginPhase = 'starting';
    let urlPublished = false;
    let lastError: string | undefined;
    let finished = false;
    const disposers: Array<() => void> = [];

    const setPhase = (next: LoginPhase, update?: LoginPhaseUpdate): void => {
      phase = next;
      opts.onPhase(next, update);
    };

    const pty = backend.ptySpawn('docker', dockerArgv, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      env: process.env,
    });

    const finish = (result: RunClaudeLoginResult): void => {
      if (finished) return;
      finished = true;
      for (const d of disposers) d();
      try {
        pty.kill();
      } catch {
        /* already gone */
      }
      resolve(result);
    };

    if (opts.signal) {
      const onAbort = (): void => {
        if (finished) return;
        const error = 'login aborted';
        writeLog('aborted');
        setPhase('error', { error });
        finish({ ok: false, error });
      };
      if (opts.signal.aborted) onAbort();
      else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        disposers.push(() => opts.signal?.removeEventListener('abort', onAbort));
      }
    }

    // Poll for the pasted code; only consume one while actually awaiting it.
    const codePoll = setInterval(() => {
      if (finished || phase !== 'awaiting-code') return;
      const code = opts.getCode();
      if (code) {
        writeLog('received code; submitting to login');
        setPhase('exchanging');
        pty.write(code + '\r');
      }
    }, POLL_MS);
    disposers.push(() => clearInterval(codePoll));

    pty.onData((d: string) => {
      buf += d;
      if (buf.length > BUF_CAP) buf = buf.slice(-BUF_CAP);
      opts.writeRaw(d);
      if (!urlPublished) {
        const url = extractOAuthUrl(buf);
        if (url) {
          urlPublished = true;
          writeLog(`published auth url: ${url}`);
          setPhase('awaiting-code', { url });
        }
        return;
      }
      if (phase === 'exchanging' && INVALID_CODE.test(d)) {
        lastError = 'the code was not accepted — paste a fresh one';
        writeLog('code rejected; back to awaiting-code');
        setPhase('awaiting-code', { lastError });
      }
    });

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      if (finished) return;
      writeLog(`login process exited code=${String(exitCode)}`);
      void (async () => {
        let creds = { present: false, hasRefreshToken: false };
        try {
          creds = await volumeClaudeCredentials(volume, opts.image);
        } catch {
          /* treat as no-creds */
        }
        if (exitCode === 0 && creds.hasRefreshToken) {
          const warm = await warmUpClaudeCredentials(volume, opts.image, {
            onProgress: (l) => writeLog(l),
          });
          await syncClaudeCredentials({ volume }, { image: opts.image, isolate: false });
          setPhase('done', { warmed: warm.warmed });
          finish({ ok: true, warmed: warm.warmed, exitCode });
          return;
        }
        const tail = tailOf(buf);
        let error =
          exitCode === 0
            ? 'login exited without writing credentials'
            : `login exited with code ${String(exitCode)}`;
        if (lastError) error = lastError;
        if (tail) error += ` — ${tail}`;
        setPhase('error', { error, exitCode });
        finish({ ok: false, error, exitCode });
      })();
    });

    const urlTimer = setTimeout(() => {
      if (urlPublished || finished) return;
      const error = 'login never printed an auth URL (see the log)';
      writeLog('no auth URL within timeout');
      setPhase('error', { error });
      finish({ ok: false, error });
    }, urlTimeoutMs);
    disposers.push(() => clearTimeout(urlTimer));

    const codeTimer = setTimeout(() => {
      // Only abort while still WAITING for a code — never kill an in-flight
      // exchange (a code submitted near the deadline, or a slow token-exchange +
      // warm-up, must be allowed to finish).
      if (finished || (phase !== 'starting' && phase !== 'awaiting-code')) return;
      const error = 'timed out waiting for a code (10 min) — run login again';
      writeLog('no code within timeout; aborting');
      setPhase('error', { error });
      finish({ ok: false, error });
    }, codeTimeoutMs);
    disposers.push(() => clearTimeout(codeTimer));
  });
}
