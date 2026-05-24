import { log, spinner } from '@clack/prompts';
import {
  agentSpecsForCloud,
  ensureAgentVolumesForCloud,
  seedAgentVolumesIfFresh,
  type CloudAgentKind,
} from '@agentbox/sandbox-cloud';
import { Command } from 'commander';
import { daytonaBackend } from './backend.js';
import {
  ensureDaytonaCredentials,
  maskKey,
  readDaytonaCredStatus,
  secretsPath,
} from './credentials.js';

interface LoginOpts {
  status?: boolean;
}

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log.error(message);
  process.exitCode = 1;
}

const loginSub = new Command('login')
  .description('Set up (or rotate) Daytona credentials for cloud boxes')
  .option('--status', 'show what is currently configured (masked) and exit')
  .action(async (opts: LoginOpts) => {
    try {
      if (opts.status) {
        printStatus();
        return;
      }
      if (!process.stdin.isTTY) {
        process.stderr.write(
          'daytona login needs an interactive terminal — set DAYTONA_API_KEY in the environment for non-interactive use.\n',
        );
        process.exitCode = 1;
        return;
      }
      await ensureDaytonaCredentials({ force: true });
    } catch (err) {
      reportError(err);
    }
  });

function printStatus(): void {
  const s = readDaytonaCredStatus();
  if (s.source === 'none') {
    process.stdout.write(
      'daytona: not configured\n' +
        '  run `agentbox daytona login` to set up credentials\n',
    );
    return;
  }
  const lines = ['daytona: configured', `  source: ${s.source}`];
  if (s.source === 'secrets.env') lines.push(`  file:   ${secretsPath()}`);
  if (s.apiKey) lines.push(`  apiKey: ${maskKey(s.apiKey)}`);
  if (s.jwtToken) lines.push(`  jwt:    ${maskKey(s.jwtToken)}`);
  if (s.organizationId) lines.push(`  orgId:  ${s.organizationId}`);
  process.stdout.write(lines.join('\n') + '\n');
}

interface ResyncOpts {
  agent?: string;
}

const KNOWN_AGENTS: readonly CloudAgentKind[] = ['claude', 'codex', 'opencode'];

/**
 * Parse `--agent` into the list of agents to refresh. Defaults to all three;
 * accepts a single name or 'all'. Throws on unknown agent name so a typo
 * surfaces immediately instead of silently resyncing nothing.
 */
function resolveAgentSelection(raw: string | undefined): CloudAgentKind[] {
  if (!raw || raw === 'all') return [...KNOWN_AGENTS];
  if (!(KNOWN_AGENTS as readonly string[]).includes(raw)) {
    throw new Error(
      `unknown agent '${raw}'. Expected one of: ${KNOWN_AGENTS.join(', ')}, all.`,
    );
  }
  return [raw as CloudAgentKind];
}

const resyncSub = new Command('resync')
  .description(
    'Re-upload host agent credentials (~/.claude, ~/.codex, opencode) into the shared Daytona volumes.',
  )
  .option(
    '-a, --agent <name>',
    'which agent to refresh: claude | codex | opencode | all',
    'all',
  )
  .action(async (opts: ResyncOpts) => {
    try {
      const agents = resolveAgentSelection(opts.agent);
      const specs = agentSpecsForCloud().filter((s) => agents.includes(s.kind));

      // Spin up a single throwaway sandbox with all selected volumes mounted.
      // One sandbox amortizes the snapshot/start cost across multiple agents;
      // seedAgentVolumesIfFresh with force:true overwrites each one in turn.
      // Image: the same default `agentbox/box:dev` used for normal cloud
      // boxes. Daytona's snapshot cache should hit if the user has provisioned
      // a real box recently. Resources are minimal — we only need tar + chown.
      const sb = spinner();
      sb.start(`provisioning throwaway sandbox to refresh: ${agents.join(', ')}`);

      const ensured = await ensureAgentVolumesForCloud(daytonaBackend, {
        onLog: (line) => log.info(line),
      });
      if (ensured.agents.length === 0) {
        sb.stop('no agent volumes available — the daytona backend has no volume primitive');
        return;
      }
      // Restrict to only what the user asked for.
      const mounts = ensured.mounts.filter((m) =>
        specs.some((s) => s.mountPath === m.mountPath),
      );

      const handle = await daytonaBackend.provision({
        name: `agentbox-resync-${Date.now().toString(36)}`,
        image: 'agentbox/box:dev',
        resources: { cpu: 1, memory: 1, disk: 4 },
        env: {},
        volumes: mounts,
        onLog: (line) => sb.message(line.slice(0, 80)),
      });
      sb.stop(`throwaway sandbox ${handle.sandboxId} provisioned`);

      try {
        const sb2 = spinner();
        sb2.start('re-seeding host credentials into volumes (force)');
        await seedAgentVolumesIfFresh(daytonaBackend, handle, {
          agents,
          force: true,
          onLog: (line) => sb2.message(line.slice(0, 80)),
        });
        sb2.stop('credentials refreshed');
      } finally {
        const sb3 = spinner();
        sb3.start('destroying throwaway sandbox');
        try {
          await daytonaBackend.destroy(handle);
        } catch (err) {
          sb3.stop(
            `destroy failed (sandbox may linger): ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        sb3.stop('throwaway sandbox destroyed');
      }

      log.success(
        `Daytona agent volumes refreshed: ${agents.join(', ')}. ` +
          `Next \`agentbox create --provider daytona\` will use the updated credentials.`,
      );
    } catch (err) {
      reportError(err);
    }
  });

interface PublishOpts {
  name?: string;
  yes?: boolean;
}

/**
 * `agentbox daytona publish-snapshot [--name X]` — build the agentbox image
 * once (the ~7-min Dockerfile.box cold path) and register it as a named
 * Daytona snapshot. Subsequent `agentbox create --provider daytona --image
 * <name>` (or with `box.image: <name>` in config) provisions from that
 * snapshot in seconds, skipping the build entirely.
 *
 * Idempotent: passing the same name twice rebuilds + replaces. Snapshot
 * names are org-scoped, so this affects only the credentials' org.
 */
const publishSub = new Command('publish-snapshot')
  .description(
    'Build the AgentBox image and register it as a reusable Daytona snapshot (skips the ~7-min Dockerfile build on future creates).',
  )
  .option(
    '-n, --name <name>',
    'snapshot name (default: agentbox-box-prebuilt-<timestamp>)',
  )
  .option('-y, --yes', 'skip the cost confirmation')
  .action(async (opts: PublishOpts) => {
    try {
      const snapshotName =
        opts.name ?? `agentbox-box-prebuilt-${Math.floor(Date.now() / 1000).toString()}`;
      if (!opts.yes && process.stdin.isTTY) {
        process.stdout.write(
          `About to provision a temporary Daytona sandbox + register snapshot '${snapshotName}'.\n` +
            'This takes ~7 minutes and consumes a sandbox slot during the build.\n' +
            'Re-run with --yes to skip this confirmation.\n',
        );
      }
      if (!daytonaBackend.createSnapshot) {
        process.stderr.write('daytona backend does not expose createSnapshot in this build.\n');
        process.exitCode = 1;
        return;
      }
      const sp = spinner();
      sp.start(`provisioning sandbox to capture snapshot '${snapshotName}'`);
      const handle = await daytonaBackend.provision({
        name: `agentbox-snapshot-${Date.now().toString(36)}`,
        image: 'agentbox/box:dev', // resolveImage(...) translates this to Image.fromDockerfile
        resources: { cpu: 2, memory: 4, disk: 8 },
        env: {},
        onLog: (line) => sp.message(line.slice(0, 80)),
      });
      sp.stop(`sandbox ${handle.sandboxId} up — capturing snapshot…`);
      try {
        const sp2 = spinner();
        sp2.start(`createSnapshot '${snapshotName}'`);
        await daytonaBackend.createSnapshot(handle, snapshotName);
        sp2.stop(`snapshot '${snapshotName}' captured`);
      } finally {
        const sp3 = spinner();
        sp3.start('destroying capture sandbox');
        try {
          await daytonaBackend.destroy(handle);
          sp3.stop('capture sandbox destroyed');
        } catch (err) {
          sp3.stop(
            `destroy failed (sandbox may linger): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      log.success(
        `published Daytona snapshot '${snapshotName}'. Use it with:\n` +
          `  agentbox config set --project box.image ${snapshotName}\n` +
          `  agentbox create --provider daytona  # (provisions from the snapshot, no Dockerfile build)`,
      );
    } catch (err) {
      reportError(err);
    }
  });

export const daytonaCommand = new Command('daytona')
  .description('Daytona cloud-provider credential management')
  .addCommand(loginSub, { isDefault: true })
  .addCommand(resyncSub)
  .addCommand(publishSub);
