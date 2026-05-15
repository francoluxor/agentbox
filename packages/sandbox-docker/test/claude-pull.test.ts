import { describe, expect, it } from 'vitest';
import {
  mergeInstalledPlugins,
  mergeKnownMarketplaces,
  pickNewItems,
  SKILL_EXCLUDE_PREFIXES,
} from '../src/claude-pull.js';

describe('pickNewItems', () => {
  it('returns box names absent on host, sorted', () => {
    expect(pickNewItems(['b', 'a', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('drops names matching an exclude prefix', () => {
    expect(pickNewItems(['agentbox-setup', 'my-skill'], [], SKILL_EXCLUDE_PREFIXES)).toEqual([
      'my-skill',
    ]);
  });

  it('dedupes and ignores empties', () => {
    expect(pickNewItems(['a', 'a', ''], [])).toEqual(['a']);
  });

  it('is a no-op when everything already exists on host', () => {
    expect(pickNewItems(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('mergeKnownMarketplaces', () => {
  const hostHome = '/Users/marco';

  it('adds a box-only marketplace and rewrites installLocation to the host path', () => {
    const host = {
      existing: { source: { source: 'github', repo: 'x/y' }, installLocation: '/Users/marco/.claude/plugins/marketplaces/existing' },
    };
    const box = {
      existing: { source: { source: 'github', repo: 'x/y' }, installLocation: '/home/vscode/.claude/plugins/marketplaces/existing' },
      added: { source: { source: 'github', repo: 'a/b' }, installLocation: '/home/vscode/.claude/plugins/marketplaces/added' },
    };
    const r = mergeKnownMarketplaces(host, box, { hostHome });
    expect(r.changed).toBe(true);
    expect(r.addedKeys).toEqual(['added']);
    const data = r.data as Record<string, { installLocation: string }>;
    // Existing host entry untouched.
    expect(data['existing']!.installLocation).toBe(
      '/Users/marco/.claude/plugins/marketplaces/existing',
    );
    // New entry's container path rewritten back to the host path.
    expect(data['added']!.installLocation).toBe(
      '/Users/marco/.claude/plugins/marketplaces/added',
    );
  });

  it('is unchanged when the box has no new marketplaces', () => {
    const host = { a: { installLocation: '/Users/marco/.claude/plugins/marketplaces/a' } };
    const box = { a: { installLocation: '/home/vscode/.claude/plugins/marketplaces/a' } };
    const r = mergeKnownMarketplaces(host, box, { hostHome });
    expect(r.changed).toBe(false);
    expect(r.data).toBe(host);
  });

  it('tolerates garbage box JSON (no change)', () => {
    const host = { a: {} };
    const r = mergeKnownMarketplaces(host, 'not-an-object', { hostHome });
    expect(r.changed).toBe(false);
    expect(r.data).toBe(host);
  });
});

describe('mergeInstalledPlugins', () => {
  const hostHome = '/Users/marco';

  it('adds a box-only plugin under .plugins, rewrites installPath, preserves version', () => {
    const host = {
      version: 2,
      plugins: {
        'a@mkt': [{ scope: 'user', installPath: '/Users/marco/.claude/plugins/cache/mkt/a/unknown' }],
      },
    };
    const box = {
      version: 2,
      plugins: {
        'a@mkt': [{ scope: 'user', installPath: '/home/vscode/.claude/plugins/cache/mkt/a/unknown' }],
        'b@mkt': [{ scope: 'user', installPath: '/home/vscode/.claude/plugins/cache/mkt/b/unknown' }],
      },
    };
    const r = mergeInstalledPlugins(host, box, { hostHome });
    expect(r.changed).toBe(true);
    expect(r.addedKeys).toEqual(['b@mkt']);
    const data = r.data as { version: number; plugins: Record<string, Array<{ installPath: string }>> };
    expect(data.version).toBe(2);
    expect(data.plugins['a@mkt']![0]!.installPath).toBe(
      '/Users/marco/.claude/plugins/cache/mkt/a/unknown',
    );
    expect(data.plugins['b@mkt']![0]!.installPath).toBe(
      '/Users/marco/.claude/plugins/cache/mkt/b/unknown',
    );
  });

  it('seeds .plugins when the host file is missing/garbage', () => {
    const box = { version: 2, plugins: { 'b@mkt': [{ installPath: '/home/vscode/.claude/plugins/cache/mkt/b/unknown' }] } };
    const r = mergeInstalledPlugins(undefined, box, { hostHome });
    expect(r.changed).toBe(true);
    const data = r.data as { plugins: Record<string, Array<{ installPath: string }>> };
    expect(data.plugins['b@mkt']![0]!.installPath).toBe(
      '/Users/marco/.claude/plugins/cache/mkt/b/unknown',
    );
  });

  it('is unchanged when no new plugins', () => {
    const host = { version: 2, plugins: { 'a@mkt': [{ installPath: '/Users/marco/.claude/plugins/cache/mkt/a/unknown' }] } };
    const box = { version: 2, plugins: { 'a@mkt': [{ installPath: '/home/vscode/.claude/plugins/cache/mkt/a/unknown' }] } };
    const r = mergeInstalledPlugins(host, box, { hostHome });
    expect(r.changed).toBe(false);
  });
});
