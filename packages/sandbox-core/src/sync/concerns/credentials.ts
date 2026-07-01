/**
 * Concern: credentials — the per-agent login secrets (`~/.claude/.credentials.json`
 * for claude, `auth.json` for codex/opencode) that ride separately from static
 * config because they change per login and must never be baked into a shared
 * snapshot.
 *
 * What lives here is the provider-neutral core of the concern:
 *  - the pure host-side guards (`isRealAgentCredential`, `hostClaudeBackupExpired`,
 *    `hostBackupHasCredentials`) — the "is this blob real / expired?" decisions,
 *    driven by the registry's `credential.realShape` so the per-agent switch has
 *    one home;
 *  - the box→host extract (`extractCredentials`) expressed against the
 *    `SyncTransport.readText` seam, so cloud's `extractCloudAgentCredentials`
 *    becomes a thin transport-injecting wrapper;
 *  - the seed-once marker name (`SEED_MARKER`) shared by the cloud volume seed.
 *
 * What deliberately does NOT live here (yet): the *seed* mechanisms. Docker
 * seeds claude via a throwaway root helper container that bidirectionally syncs
 * the shared config volume with the host backup (`syncClaudeCredentials`,
 * `SYNC_SCRIPT`) — it predates any running box, so it has no `SyncTransport`
 * (box-bound) analog and no polymorphic caller; codex/opencode ride the whole-
 * dir volume rsync. Cloud seeds via `seedCredentialsOne` (marker/force gate +
 * `uploadFile` + a volume-vs-ephemeral extract split). Those stay in their
 * providers; their transport-seam collapse folds into the Phase 7 driver, the
 * same call carry's apply mechanism and skills' box→host pull already made.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SyncTransport } from '@agentbox/core';
import { AGENT_SYNC_SPECS, resolveAgentSpec } from '../registry.js';
import type { AgentId } from '../agents/types.js';

/** Agents whose credentials we extract from a box back to the host. Mirrors `AgentId`. */
export type CredentialAgentKind = AgentId;

/**
 * Marker filename written inside a cloud agent's credentials subpath recording
 * when we last seeded it (a single ISO-8601 timestamp on disk). Absent marker =
 * first time on this volume → seed. Volume/idempotency-only: ephemeral cloud
 * backends can't persist it and push every create; docker uses a content check
 * (real-vs-empty) instead of a marker.
 */
export const SEED_MARKER = '.agentbox-seeded-at';

/** Host backup of the claude OAuth blob — the registry is the single source of truth. */
const CLAUDE_HOST_BACKUP = resolveAgentSpec('claude').credential.hostBackup;

/**
 * True iff `text` looks like a real (usable) credential for `agent`, not an
 * empty/placeholder file. Used so the box→host extract never clobbers a good
 * host backup with an empty box file. The per-agent shape comes from the
 * registry (`credential.realShape`): claude requires a non-empty
 * `claudeAiOauth.refreshToken`; codex/opencode auth files just have to parse as
 * a non-empty JSON object. Unknown agents fall back to the JSON-object check
 * (never throws — matches the pre-registry `if (agent === 'claude')` switch).
 */
export function isRealAgentCredential(agent: CredentialAgentKind, text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const spec = AGENT_SYNC_SPECS.find((s) => s.id === agent);
  if (spec?.credential.realShape === 'claude-oauth') {
    const rt = (parsed as { claudeAiOauth?: { refreshToken?: unknown } }).claudeAiOauth?.refreshToken;
    return typeof rt === 'string' && rt.length > 0;
  }
  return Object.keys(parsed as Record<string, unknown>).length > 0;
}

/**
 * True iff the claude host backup holds an OAuth blob whose access token is
 * already expired (`claudeAiOauth.expiresAt`, ms epoch, < now). A missing
 * `expiresAt` (or unreadable file) → false: we only report a *known* expiry, so
 * callers don't nag when the box could still refresh the token itself. `now` is
 * injectable for tests. Claude is the only agent with a token-expiry gate (codex
 * / opencode auth files carry no comparable field).
 */
export async function hostClaudeBackupExpired(
  path: string = CLAUDE_HOST_BACKUP,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      claudeAiOauth?: { expiresAt?: unknown };
    };
    const exp = parsed?.claudeAiOauth?.expiresAt;
    return typeof exp === 'number' && Number.isFinite(exp) && exp < now;
  } catch {
    return false;
  }
}

/**
 * True iff the claude host backup file holds a real OAuth blob (a non-empty
 * `claudeAiOauth.refreshToken`). Used to decide whether to offer an interactive
 * sign-in before creating a box. Tolerant of a missing or garbage file — returns
 * false.
 */
export async function hostBackupHasCredentials(
  path: string = CLAUDE_HOST_BACKUP,
): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      claudeAiOauth?: { refreshToken?: unknown };
    };
    const rt = parsed?.claudeAiOauth?.refreshToken;
    return typeof rt === 'string' && rt.length > 0;
  } catch {
    return false;
  }
}

export interface ExtractCredentialsOptions {
  onLog?: (line: string) => void;
  /** Override host backup paths per agent (tests). Defaults to the registry `hostBackup`. */
  backups?: Partial<Record<AgentId, string>>;
}

/**
 * Extract each agent's login credential from a running box back to the host
 * backups under `~/.agentbox/`, so the next box (seeded from those backups)
 * inherits the login. The provider-neutral core of docker's
 * `syncClaudeCredentials` extract direction and cloud's
 * `extractCloudAgentCredentials`, expressed against `transport.readText`.
 *
 * Reads the canonical in-box path (`credential.boxAbsPath`) via
 * `transport.readText`; only writes the host backup (mode 0600) when the content
 * passes `isRealAgentCredential`, so an empty / not-logged-in box never clobbers
 * a good backup. Best-effort per agent (never throws). Returns the agents whose
 * backup was updated.
 */
export async function extractCredentials(
  transport: SyncTransport,
  opts: ExtractCredentialsOptions = {},
): Promise<AgentId[]> {
  const log = opts.onLog ?? (() => {});
  const extracted: AgentId[] = [];
  for (const spec of AGENT_SYNC_SPECS) {
    const hostBackup = opts.backups?.[spec.id] ?? spec.credential.hostBackup;
    try {
      // `readText` is `cat <path> 2>/dev/null` with noRetry → null on a missing
      // file; tolerate that silently. `!text` also covers an empty stdout.
      const text = await transport.readText(spec.credential.boxAbsPath);
      if (!text || !isRealAgentCredential(spec.id, text)) continue;
      await mkdir(dirname(hostBackup), { recursive: true });
      await writeFile(hostBackup, text, { mode: 0o600 });
      await chmod(hostBackup, 0o600).catch(() => {});
      extracted.push(spec.id);
      log(`extracted ${spec.id} login from box to ${hostBackup}`);
    } catch (err) {
      log(
        `WARN: ${spec.id} credential extract failed (${err instanceof Error ? err.message : String(err)}) — skipping`,
      );
    }
  }
  return extracted;
}
