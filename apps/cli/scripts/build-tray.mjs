// Build the macOS tray app (separate repo `madarco/agentbox-tray`) so `stage-runtime.mjs` can
// bundle its `dist/AgentBoxTray.zip` into the CLI's npm package. Runs in prepublishOnly, on the
// mac that publishes (which also holds the Developer ID identity + notarytool profile that
// `release.sh` uses; without them it falls back to an ad-hoc build).
//
// Gracefully skips (exit 0) when the sibling repo or Swift toolchain isn't present — a Linux/CI
// build just won't carry the tray, and stage-runtime warns about the missing zip.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const trayDir = process.env.AGENTBOX_TRAY_DIR
  ? resolve(process.env.AGENTBOX_TRAY_DIR)
  : resolve(repoRoot, '..', 'agentbox-tray');
const release = join(trayDir, 'scripts', 'release.sh');

if (process.platform !== 'darwin') {
  console.warn('[build-tray] not macOS — skipping tray build');
  process.exit(0);
}
if (!existsSync(release)) {
  console.warn(`[build-tray] tray repo not found at ${trayDir} — skipping (set AGENTBOX_TRAY_DIR)`);
  process.exit(0);
}

console.log(`[build-tray] building tray via ${release}`);
const res = spawnSync('bash', [release], { cwd: trayDir, stdio: 'inherit' });
if (res.status !== 0) {
  console.error('[build-tray] release.sh failed');
  process.exit(res.status ?? 1);
}
