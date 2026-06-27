/**
 * Per-box (and per-prepare-run) SSH key minting.
 *
 * AgentBox mints a fresh ed25519 keypair per box at provision time. The
 * private key never leaves the host; the public key is shipped to the VPS
 * via cloud-init `users:` (NOT the DigitalOcean SSH-keys-import API, which
 * would make the same pubkey available to attach to other VPSes the user
 * provisions — see the plan's §"Key & key-lifecycle hygiene").
 *
 * Storage layout (per the plan):
 *   ~/.agentbox/boxes/<box-id>/ssh/
 *     id_ed25519        (private, 0600)
 *     id_ed25519.pub    (public, 0644)
 *     known_hosts       (per-box, populated post-first-connect)
 *     control.sock      (ssh ControlMaster socket — created at runtime)
 *
 * For the temp prepare VPS we use a parallel path:
 *   ~/.agentbox/digitalocean/prepare-<timestamp>/
 * deleted after the snapshot completes.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execa } from 'execa';

export interface MintedSshKey {
  /** Directory holding the key files. */
  dir: string;
  /** Absolute path to the private key. */
  privatePath: string;
  /** Absolute path to the public key. */
  publicPath: string;
  /** Public key contents (one OpenSSH-format line). */
  publicKey: string;
}

/**
 * Mint a fresh ed25519 keypair into `targetDir/id_ed25519` (+ `.pub`). The
 * directory is created if missing. Throws if the private key already exists
 * — callers handle reuse explicitly (we don't silently overwrite).
 *
 * `comment` is embedded in the public key (the `agentbox/<box-id>` tag) so
 * the key is identifiable in `~/.ssh/authorized_keys` on a forensic look.
 */
export async function mintSshKey(targetDir: string, comment: string): Promise<MintedSshKey> {
  const dir = resolve(targetDir);
  const priv = join(dir, 'id_ed25519');
  const pub = `${priv}.pub`;
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // `ssh-keygen -N ''` for no passphrase; `-q` to suppress the random art.
  // Caller is responsible for ensuring the dir is fresh — if `priv` already
  // exists, ssh-keygen would prompt to overwrite (and we don't pipe stdin so
  // it would hang). `mintPrepareKey` creates a fresh dir per call; the
  // per-box minter in backend.ts uses a fresh stamp directory too.
  await execa(
    'ssh-keygen',
    ['-t', 'ed25519', '-N', '', '-C', comment, '-f', priv, '-q'],
    { stdio: 'pipe' },
  );

  const publicKey = (await readFile(pub, 'utf8')).trim();
  return { dir, privatePath: priv, publicPath: pub, publicKey };
}

/**
 * Mint a temporary keypair for the prepare orchestrator. Returns the same
 * shape as `mintSshKey` plus a `cleanup()` that rm -rf's the directory.
 * The caller is expected to call `cleanup()` in a `finally` block.
 */
export async function mintPrepareKey(): Promise<MintedSshKey & { cleanup: () => Promise<void> }> {
  const root = resolve(homedirOrCwd(), '.agentbox', 'digitalocean', `prepare-${Date.now().toString(36)}`);
  const key = await mintSshKey(root, `agentbox-prepare-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return {
    ...key,
    cleanup: async () => {
      try {
        const { rm } = await import('node:fs/promises');
        await rm(dirname(key.privatePath), { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

function homedirOrCwd(): string {
  try {
    // Lazy require so this module is import-safe even if `os` is shimmed
    // away in some weird bundle environment.
    return process.env.HOME ?? process.cwd();
  } catch {
    return process.cwd();
  }
}
