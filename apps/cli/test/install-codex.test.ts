import { describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import {
  codexConfigPath,
  codexPluginEnableBlock,
  upsertCodexPluginEnable,
} from '../src/commands/install-codex.js';

const ID = 'agentbox@agentbox';
const enabledOf = (text: string) =>
  (parseToml(text) as { plugins?: Record<string, { enabled?: boolean }> }).plugins?.[ID]?.enabled;

describe('upsertCodexPluginEnable', () => {
  it('appends a managed enable block to an empty config', () => {
    const { text, status } = upsertCodexPluginEnable('');
    expect(status).toBe('added');
    expect(text).toContain('[plugins."agentbox@agentbox"]');
    expect(enabledOf(text)).toBe(true);
  });

  it('preserves existing config and appends below it', () => {
    const existing = 'model = "gpt-5"\n\n[mcp_servers.foo]\ncommand = "bar"\n';
    const { text, status } = upsertCodexPluginEnable(existing);
    expect(status).toBe('added');
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain('[mcp_servers.foo]');
    // Whole file still parses (no duplicate/!malformed tables).
    const parsed = parseToml(text) as { model?: string };
    expect(parsed.model).toBe('gpt-5');
    expect(enabledOf(text)).toBe(true);
  });

  it('is idempotent — re-running does not duplicate the block', () => {
    const once = upsertCodexPluginEnable('').text;
    const twice = upsertCodexPluginEnable(once);
    expect(twice.status).toBe('added');
    expect(twice.text).toBe(once);
    // Exactly one managed block, one plugins table.
    expect(twice.text.match(/agentbox install codex \(managed\)/g)?.length).toBe(2); // begin+end
    expect(twice.text.match(/\[plugins\."agentbox@agentbox"\]/g)?.length).toBe(1);
    expect(() => parseToml(twice.text)).not.toThrow();
  });

  it('respects a user/TUI-enabled entry and drops our managed block', () => {
    const userCfg = '[plugins."agentbox@agentbox"]\nenabled = true\n';
    const { text, status } = upsertCodexPluginEnable(userCfg);
    expect(status).toBe('user-enabled');
    expect(text).not.toContain('(managed)');
    expect(enabledOf(text)).toBe(true);
  });

  it('respects an explicit user disable (does not force-enable)', () => {
    const userCfg = '[plugins."agentbox@agentbox"]\nenabled = false\n';
    const { text, status } = upsertCodexPluginEnable(userCfg);
    expect(status).toBe('user-disabled');
    expect(enabledOf(text)).toBe(false);
    expect(text).not.toContain('(managed)');
  });

  it('removes a stale managed block when the user later adds their own entry', () => {
    // managed block first, then a user table appears (e.g. via the TUI).
    const managed = upsertCodexPluginEnable('').text;
    const withUser = managed + '\n[plugins."agentbox@agentbox"]\nenabled = false\n';
    // The combined doc would be a duplicate table; our upsert must collapse it.
    const { text, status } = upsertCodexPluginEnable(withUser);
    expect(status).toBe('user-disabled');
    expect(text).not.toContain('(managed)');
    expect(() => parseToml(text)).not.toThrow();
    expect(text.match(/\[plugins\."agentbox@agentbox"\]/g)?.length).toBe(1);
  });

  it('leaves a malformed config untouched', () => {
    const bad = 'this is = not [valid toml';
    const { text, status } = upsertCodexPluginEnable(bad);
    expect(status).toBe('parse-error');
    expect(text).toBe(bad);
  });
});

describe('codexConfigPath', () => {
  it('honors CODEX_HOME', () => {
    expect(codexConfigPath({ CODEX_HOME: '/tmp/cx' })).toBe('/tmp/cx/config.toml');
  });
  it('defaults under ~/.codex', () => {
    expect(codexConfigPath({})).toMatch(/\.codex\/config\.toml$/);
  });
});

describe('codexPluginEnableBlock', () => {
  it('is a valid standalone TOML table that enables the plugin', () => {
    expect(enabledOf(codexPluginEnableBlock())).toBe(true);
  });
});
