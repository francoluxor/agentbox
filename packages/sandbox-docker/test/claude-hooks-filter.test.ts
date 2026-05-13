import { describe, expect, it } from 'vitest';
import {
  addProjectAlias,
  clearInstallMethod,
  filterHostHooks,
  isHostPathHookCommand,
} from '../src/claude-hooks-filter.js';

describe('isHostPathHookCommand', () => {
  const home = '/Users/marco';

  it('matches a bare host-absolute path', () => {
    expect(isHostPathHookCommand('/Users/marco/.config/iterm2/cc-status', home)).toBe(true);
  });

  it('matches a host path embedded in a longer command (e.g. `node /Users/.../x.js`)', () => {
    expect(isHostPathHookCommand('node /Users/marco/scripts/hook.js', home)).toBe(true);
  });

  it('matches a host path inside a shell-quoted form', () => {
    expect(isHostPathHookCommand("bash -c '/Users/marco/.config/iterm2/cc-status'", home)).toBe(
      true,
    );
  });

  it("doesn't match commands resolved via PATH", () => {
    expect(isHostPathHookCommand('pnpm lint', home)).toBe(false);
    expect(isHostPathHookCommand('node script.js', home)).toBe(false);
  });

  it("doesn't match container-internal absolute paths", () => {
    expect(isHostPathHookCommand('/workspace/scripts/foo.sh', home)).toBe(false);
  });

  it("doesn't match an unrelated path that just starts the same as home", () => {
    // No trailing-slash gate would let `/Users/marco-other/...` match.
    expect(isHostPathHookCommand('/Users/marco-other/x', home)).toBe(false);
  });

  it('falls back to false when hostHome is empty', () => {
    expect(isHostPathHookCommand('/anything/here', '')).toBe(false);
  });

  it('falls back to false for non-string / empty commands', () => {
    expect(isHostPathHookCommand('', home)).toBe(false);
  });
});

describe('filterHostHooks', () => {
  const home = '/Users/marco';

  const realSettingsShape = {
    enabledPlugins: { 'code-review': true },
    hooks: {
      Notification: [
        {
          hooks: [{ command: '/Users/marco/.config/iterm2/cc-status', type: 'command' }],
        },
      ],
      PermissionRequest: [
        {
          hooks: [{ command: '/Users/marco/.config/iterm2/cc-status', type: 'command' }],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { command: '/Users/marco/.config/iterm2/cc-status', type: 'command' },
            { command: 'pnpm lint', type: 'command' },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [{ command: '/Users/marco/.config/iterm2/cc-status', type: 'command' }],
        },
      ],
    },
  } as const;

  it('drops cc-status hooks across every trigger', () => {
    // Fixture has 4 cc-status entries (Notification, PermissionRequest,
    // PostToolUse, SessionEnd) plus one survivor (`pnpm lint`).
    const { data, removedCommands } = filterHostHooks(realSettingsShape, home);
    expect(removedCommands).toHaveLength(4);
    expect(removedCommands.every((c) => c.includes('/Users/marco/'))).toBe(true);
    // Non-host-path hook survives.
    const post = (data as typeof realSettingsShape).hooks.PostToolUse[0].hooks;
    expect(post).toEqual([{ command: 'pnpm lint', type: 'command' }]);
  });

  it('leaves emptied hooks: [] arrays in place rather than recursively cleaning up', () => {
    const { data } = filterHostHooks(realSettingsShape, home);
    const notif = (data as typeof realSettingsShape).hooks.Notification;
    expect(notif).toHaveLength(1);
    expect(notif[0]!.hooks).toEqual([]);
  });

  it('does not mutate the input', () => {
    const original = JSON.parse(JSON.stringify(realSettingsShape)) as typeof realSettingsShape;
    filterHostHooks(realSettingsShape, home);
    expect(realSettingsShape).toEqual(original);
  });

  it('preserves sibling top-level fields (e.g. enabledPlugins)', () => {
    const { data } = filterHostHooks(realSettingsShape, home);
    expect((data as typeof realSettingsShape).enabledPlugins).toEqual({ 'code-review': true });
  });

  it('handles data.hooks === null (Marco\'s real ~/.claude.json case)', () => {
    const { data, removedCommands } = filterHostHooks({ hooks: null, other: 1 }, home);
    expect(removedCommands).toEqual([]);
    expect(data).toEqual({ hooks: null, other: 1 });
  });

  it('passes through non-object inputs unchanged', () => {
    expect(filterHostHooks(null, home).data).toBeNull();
    expect(filterHostHooks(42, home).data).toBe(42);
    expect(filterHostHooks('hello', home).data).toBe('hello');
  });
});

describe('clearInstallMethod', () => {
  it('removes the field when present and reports cleared=true', () => {
    const r = clearInstallMethod({ installMethod: 'native', other: 1 });
    expect(r.cleared).toBe(true);
    expect(r.data).toEqual({ other: 1 });
  });

  it('reports cleared=false when the field is absent', () => {
    const r = clearInstallMethod({ other: 1 });
    expect(r.cleared).toBe(false);
    expect(r.data).toEqual({ other: 1 });
  });

  it('does not mutate the input', () => {
    const input = { installMethod: 'native' };
    clearInstallMethod(input);
    expect(input).toEqual({ installMethod: 'native' });
  });

  it('handles non-object inputs gracefully', () => {
    expect(clearInstallMethod(null)).toEqual({ data: null, cleared: false });
    expect(clearInstallMethod(42)).toEqual({ data: 42, cleared: false });
    expect(clearInstallMethod([1, 2, 3])).toEqual({ data: [1, 2, 3], cleared: false });
  });
});

describe('addProjectAlias', () => {
  const hostCwd = '/Users/marco/Projects/foo';
  const inboxCwd = '/workspace';

  type ProjectsMap = Record<string, Record<string, unknown>>;

  it('copies the host-keyed project entry to the in-box workspace path', () => {
    const input: { projects: ProjectsMap; anonymousId: string } = {
      projects: {
        [hostCwd]: { mcpServers: { sentry: { url: 'https://sentry.example/mcp' } }, history: [1] },
        '/Users/marco/Projects/other': { history: [9] },
      },
      anonymousId: 'abc',
    };
    const { data, aliased } = addProjectAlias(input, hostCwd, inboxCwd);
    expect(aliased).toBe(true);
    const projects = (data as typeof input).projects;
    expect(projects[inboxCwd]).toEqual({
      mcpServers: { sentry: { url: 'https://sentry.example/mcp' } },
      history: [1],
    });
    // Original host entry is preserved (copy, not move).
    expect(projects[hostCwd]).toEqual({
      mcpServers: { sentry: { url: 'https://sentry.example/mcp' } },
      history: [1],
    });
    // Untouched siblings still there.
    expect(projects['/Users/marco/Projects/other']).toEqual({ history: [9] });
    expect((data as typeof input).anonymousId).toBe('abc');
  });

  it('merges into an existing /workspace entry, host-authoritative for overlapping keys', () => {
    const input: { projects: ProjectsMap } = {
      projects: {
        [hostCwd]: { mcpServers: { sentry: { url: 'host' } }, trusted: true },
        [inboxCwd]: { mcpServers: { sentry: { url: 'box' } }, boxOnly: 1 },
      },
    };
    const { data, aliased } = addProjectAlias(input, hostCwd, inboxCwd);
    expect(aliased).toBe(true);
    const merged = (data as typeof input).projects[inboxCwd];
    // Host wins on `mcpServers`; box-only key survives.
    expect(merged).toEqual({
      mcpServers: { sentry: { url: 'host' } },
      trusted: true,
      boxOnly: 1,
    });
  });

  it('is a no-op when the host path is not in projects', () => {
    const input: { projects: ProjectsMap } = {
      projects: { '/somewhere/else': { history: [] } },
    };
    const { aliased, data } = addProjectAlias(input, hostCwd, inboxCwd);
    expect(aliased).toBe(false);
    expect((data as typeof input).projects).toEqual({ '/somewhere/else': { history: [] } });
  });

  it('is a no-op when projects is missing or non-object', () => {
    expect(addProjectAlias({}, hostCwd, inboxCwd).aliased).toBe(false);
    expect(addProjectAlias({ projects: null }, hostCwd, inboxCwd).aliased).toBe(false);
    expect(addProjectAlias({ projects: 'oops' }, hostCwd, inboxCwd).aliased).toBe(false);
    expect(addProjectAlias({ projects: [] }, hostCwd, inboxCwd).aliased).toBe(false);
  });

  it('is a no-op when fromPath equals toPath', () => {
    const input = { projects: { [inboxCwd]: { history: [1] } } };
    const { aliased } = addProjectAlias(input, inboxCwd, inboxCwd);
    expect(aliased).toBe(false);
  });

  it('does not mutate the input', () => {
    const input = { projects: { [hostCwd]: { mcpServers: { x: { url: 'a' } } } } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    addProjectAlias(input, hostCwd, inboxCwd);
    expect(input).toEqual(snapshot);
  });
});

// Reopen the filterHostHooks describe to keep the original "tolerates unexpected shapes" assertion
// (the closing brace above ends the suite; this restores it so existing assertions stay together).
describe('filterHostHooks — unexpected shapes', () => {
  const home = '/Users/marco';
  it('handles non-array trigger values and bad leaf objects without throwing', () => {
    const weird = {
      hooks: {
        StrangeTrigger: 'this should be an array but isn\'t',
        AnotherOne: [
          {
            // entry.hooks isn't an array either
            hooks: 'nope',
          },
          {
            // valid entry; leaf is not the right shape
            hooks: [{ command: '/Users/marco/x', type: 'not-command' }],
          },
        ],
      },
    };
    const { removedCommands } = filterHostHooks(weird, home);
    expect(removedCommands).toEqual([]);
  });
});
