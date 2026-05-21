import { execa } from 'execa';

/**
 * Re-own any root-owned file under /home/vscode to the uid-1000 `vscode`
 * user. Root-run `docker exec` steps (checkpoint cleanup, dockerd setup) and
 * any `sudo` the in-box agent runs can leave home-dir files owned by root;
 * since the box's shell and agent both run as `vscode`, those files become
 * silently unwritable (the original symptom: a root-owned `.bash_history`
 * dropping all shell history). Boxes are throwaway dev sandboxes, so healing
 * the whole home dir in one sweep beats per-file whack-a-mole.
 *
 * `--from=root` is load-bearing: it limits the chown to files actually owned
 * by root and skips the (vast) vscode-owned majority. A plain `chown -R`
 * issues a chown syscall per file, which on the box's overlay rootfs forces
 * a copy-up of every image-layer file into the writable layer — ~10s and
 * needless disk bloat. `--from` keeps it a fast (~1s) targeted heal.
 *
 * Best-effort, idempotent: runs at every create + start. A few files are
 * legitimately unfixable (a read-only `.gitconfig` bind-mount, git pack
 * files) — chown's per-file errors are harmless and ignored.
 */
export async function ensureHomeOwnedByVscode(container: string): Promise<void> {
  await execa(
    'docker',
    [
      'exec',
      '--user',
      'root',
      container,
      'chown',
      '-R',
      '--from=root',
      'vscode:vscode',
      '/home/vscode',
    ],
    { reject: false },
  );
}
