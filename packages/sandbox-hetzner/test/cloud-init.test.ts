import { describe, expect, it } from 'vitest';
import { generateBoxCloudInit, generatePrepareCloudInit } from '../src/cloud-init.js';

const FAKE_PUBKEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILongTextForKey agentbox/test';

describe('generatePrepareCloudInit', () => {
  it('emits a valid `#cloud-config` doc with the pubkey for root', () => {
    const yaml = generatePrepareCloudInit({ sshPubkey: FAKE_PUBKEY });
    expect(yaml.startsWith('#cloud-config')).toBe(true);
    expect(yaml).toContain('name: root');
    expect(yaml).toContain(`- "${FAKE_PUBKEY}"`);
    expect(yaml).toContain('ssh_pwauth: false');
  });

  it('disables first-login password expiry (Hetzner Ubuntu would block key-only ssh otherwise)', () => {
    const yaml = generatePrepareCloudInit({ sshPubkey: FAKE_PUBKEY });
    expect(yaml).toContain('chpasswd:');
    expect(yaml).toContain('expire: false');
    expect(yaml).toContain('lock_passwd: false');
    // The runcmd belt-and-braces (passwd -d / chage) covers cases where
    // the image's pre-baked expiry survives cloud-init's chpasswd module.
    expect(yaml).toContain('[ passwd, -d, root ]');
    expect(yaml).toContain('chage');
  });

  it('trims surrounding whitespace from the pubkey', () => {
    const yaml = generatePrepareCloudInit({ sshPubkey: `   ${FAKE_PUBKEY}\n` });
    expect(yaml).toContain(`- "${FAKE_PUBKEY}"`);
  });
});

describe('generateBoxCloudInit', () => {
  it('injects the pubkey for vscode (not root) and writes the localhost alias', () => {
    const yaml = generateBoxCloudInit({
      sshPubkey: FAKE_PUBKEY,
      boxName: 'mybox',
    });
    expect(yaml).toContain('name: vscode');
    expect(yaml).toContain('disable_root: true');
    expect(yaml).toContain(`- "${FAKE_PUBKEY}"`);
    // /etc/hosts append carrying the symmetric URL target.
    expect(yaml).toContain('path: /etc/hosts');
    expect(yaml).toContain('127.0.0.1 mybox.localhost');
    // Same expiry-disable guard as the prepare cloud-init.
    expect(yaml).toContain('chpasswd:');
    expect(yaml).toContain('expire: false');
  });

  it('emits box.env when provided', () => {
    const yaml = generateBoxCloudInit({
      sshPubkey: FAKE_PUBKEY,
      boxName: 'mybox',
      boxEnv: { AGENTBOX_BOX_ID: 'abc123', AGENTBOX_BRIDGE_TOKEN: 'sec' },
    });
    expect(yaml).toContain('path: /etc/agentbox/box.env');
    expect(yaml).toContain('AGENTBOX_BOX_ID=abc123');
    expect(yaml).toContain('AGENTBOX_BRIDGE_TOKEN=sec');
  });

  it('omits the box.env block when boxEnv is empty / undefined', () => {
    const yaml = generateBoxCloudInit({ sshPubkey: FAKE_PUBKEY, boxName: 'mybox' });
    expect(yaml).not.toContain('path: /etc/agentbox/box.env');
  });
});
