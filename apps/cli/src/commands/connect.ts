import { readFile } from 'node:fs/promises';
import { confirm, isCancel, log } from '@clack/prompts';
import { resolveCloudSshTarget } from '@agentbox/sandbox-core';
import { Command } from 'commander';
import { resolveBoxOrExit } from '../box-ref.js';
import { providerForBox } from '../provider/registry.js';
import { handleLifecycleError } from './_errors.js';

interface ConnectOptions {
  addKey?: string;
  exportKey?: boolean;
  json?: boolean;
  yes?: boolean;
}

/** A public SSH key line looks like `ssh-ed25519 AAAA… [comment]` / `ecdsa-…` / `sk-…`. */
function looksLikePublicKey(s: string): boolean {
  return /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-\S+|sk-ssh-\S+|sk-ecdsa-\S+)\s+\S+/.test(s.trim());
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const connectCommand = new Command('connect')
  .description(
    'Print a VPS box\'s SSH connection details (to drive it from a phone / other SSH client with the laptop off), ' +
      'add another device\'s key, or export the box key. Pair with `agentbox inbound <box> open` so the box is reachable off-network. ' +
      'Hetzner / DigitalOcean only.',
  )
  .argument(
    '[box]',
    'box ref: project index, id, id prefix, name, or container (default: the only box in this project)',
  )
  .option(
    '--add-key <pubkey>',
    "append an SSH PUBLIC key (a key string, or @path to a .pub file) to the box so another device connects with its OWN key — the box's own key never leaves the host (recommended)",
  )
  .option(
    '--export-key',
    "print the box's PRIVATE key to import into a mobile SSH client (Terminus/Blink). The key leaves the host — a new trust edge; confirm required",
  )
  .option('--json', 'machine-readable connection bundle')
  .option('-y, --yes', 'skip the confirmation prompt for --export-key')
  .action(async (idOrName: string | undefined, opts: ConnectOptions) => {
    try {
      const box = await resolveBoxOrExit(idOrName);
      const provider = await providerForBox(box);
      if (!provider.buildAttach) {
        log.error(
          `\`connect\` needs an SSH box — provider '${box.provider ?? 'docker'}' isn't reachable over SSH ` +
            '(only hetzner / digitalocean boxes are).',
        );
        process.exit(2);
      }
      // add-key needs a live box (exec); the read-only bundle / export don't.
      const conn = await resolveCloudSshTarget(box, provider, {
        bringOnline: Boolean(opts.addKey),
        logInfo: (l) => log.step(l),
      });
      if (!conn.identityFile) {
        log.error(`box '${box.name}' has no persistent SSH key — only hetzner / digitalocean boxes are supported.`);
        process.exit(2);
      }

      if (opts.addKey) {
        const raw = opts.addKey.startsWith('@')
          ? (await readFile(opts.addKey.slice(1), 'utf8')).trim()
          : opts.addKey.trim();
        if (!looksLikePublicKey(raw)) {
          log.error(
            'that does not look like an SSH public key (expected e.g. `ssh-ed25519 AAAA… comment`). ' +
              'Pass the public key string or @path-to-key.pub.',
          );
          process.exit(2);
        }
        const q = shellSingleQuote(raw);
        const script =
          'set -e; mkdir -p ~/.ssh && chmod 700 ~/.ssh; ' +
          'touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys; ' +
          `if grep -qxF ${q} ~/.ssh/authorized_keys; then echo already-present; else echo ${q} >> ~/.ssh/authorized_keys && echo added; fi`;
        const res = await provider.exec(box, ['bash', '-lc', script]);
        if (res.exitCode !== 0) {
          log.error(`failed to add key: ${res.stderr || res.stdout || `exit ${String(res.exitCode)}`}`);
          process.exit(1);
        }
        const already = res.stdout.includes('already-present');
        process.stdout.write(
          `${already ? 'key already authorized' : 'key added'} on ${box.name}. ` +
            `Connect with that device's own key:\n  ssh ${conn.user}@${conn.host}\n`,
        );
        return;
      }

      if (opts.exportKey) {
        if (!opts.yes) {
          log.warn(
            `This prints box '${box.name}''s PRIVATE key. Anyone with it can SSH in as ${conn.user}. ` +
              'Prefer `--add-key <your-device.pub>` (the box key then never leaves this host).',
          );
          const ok = await confirm({ message: 'Export the private key?', initialValue: false });
          if (isCancel(ok) || !ok) {
            log.info('cancelled');
            return;
          }
        }
        const priv = await readFile(conn.identityFile, 'utf8');
        // Raw to stdout so it can be piped/redirected cleanly into a keyfile.
        process.stdout.write(priv.endsWith('\n') ? priv : `${priv}\n`);
        return;
      }

      // Default: the connection bundle.
      const inbound = box.cloud?.inbound?.mode ?? 'locked';
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              host: conn.host,
              user: conn.user,
              identityFile: conn.identityFile,
              sshCommand: `ssh ${conn.user}@${conn.host} -i ${conn.identityFile}`,
              inbound,
            },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      const reachHint =
        inbound === 'open'
          ? 'reachable from anywhere (inbound: open)'
          : `reachable from your host IP only (inbound: ${inbound}) — run \`agentbox inbound ${box.name} open\` for off-network access`;
      process.stdout.write(
        [
          `host:      ${conn.host}`,
          `user:      ${conn.user}`,
          `identity:  ${conn.identityFile}`,
          ``,
          `connect:   ssh ${conn.user}@${conn.host} -i ${conn.identityFile}`,
          ``,
          `${reachHint}.`,
          `From a phone: copy the identity file to the device (or \`--add-key <device.pub>\`), then use the connect line above.`,
        ].join('\n') + '\n',
      );
    } catch (err) {
      handleLifecycleError(err);
    }
  });
