import { describe, expect, it } from 'vitest';
import { executeCloudAction } from '../src/host-actions.js';
import type { HostAction } from '../src/types.js';

/**
 * Pure routing-level tests for `executeCloudAction`. The cloud backend +
 * sandbox-cloud helpers are loaded via dynamic `import()` keyed by string,
 * which makes them hard to mock from vitest without a full module shim.
 * These tests focus on the routing surface (unknown method, parameter
 * validation, prompt denial) that doesn't actually need the cloud SDK.
 */
describe('executeCloudAction routing', () => {
  function makeDeps(): Parameters<typeof executeCloudAction>[1] {
    return {
      backendName: 'daytona',
      boxId: 'box1',
      boxName: 'b1',
      // Omit prompts/subscribers so askPrompt-gated paths short-circuit on
      // the existence checks (and so we don't accidentally block awaiting a
      // prompt nobody will answer).
      log: () => {},
    };
  }

  function action(method: string, params: unknown = {}): HostAction {
    return {
      id: 'action-1',
      boxId: 'box1',
      method,
      params,
      createdAt: new Date().toISOString(),
    };
  }

  it('returns a clear "not supported" error for unknown methods', async () => {
    const result = await executeCloudAction(action('unknown.method'), makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("'unknown.method'");
    expect(result.stderr).toContain('not yet supported');
  });

  it('cp.* with missing params returns exit 64 (invalid arguments)', async () => {
    const r1 = await executeCloudAction(action('cp.toHost', { boxPath: '/x' }), makeDeps());
    expect(r1.exitCode).toBe(64);
    expect(r1.stderr).toContain('requires {boxPath, hostPath} strings');
    const r2 = await executeCloudAction(action('cp.fromHost', {}), makeDeps());
    expect(r2.exitCode).toBe(64);
  });

  it('download.* with non-workspace kind returns clear "not supported" error', async () => {
    const result = await executeCloudAction(action('download.env'), makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('download.env is not yet supported');
    expect(result.stderr).toContain('only download.workspace');
  });

  it('checkpoint.create without AGENTBOX_CLI_ENTRY returns exit 64', async () => {
    const prevEntry = process.env['AGENTBOX_CLI_ENTRY'];
    delete process.env['AGENTBOX_CLI_ENTRY'];
    try {
      const result = await executeCloudAction(action('checkpoint.create'), makeDeps());
      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain('AGENTBOX_CLI_ENTRY not set');
    } finally {
      if (prevEntry !== undefined) process.env['AGENTBOX_CLI_ENTRY'] = prevEntry;
    }
  });

  it('browser.open.mirror with bad URL silently succeeds (no host action)', async () => {
    const result = await executeCloudAction(
      action('browser.open.mirror', { url: 'file:///etc/passwd' }),
      makeDeps(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('browser.open.mirror without prompts/subscribers silently succeeds', async () => {
    const result = await executeCloudAction(
      action('browser.open.mirror', { url: 'https://example.com' }),
      makeDeps(),
    );
    // No prompts/subscribers => can't ask; falls through to exit 0 (the
    // box already opened it in-sandbox, the mirror is purely best-effort).
    expect(result.exitCode).toBe(0);
  });
});
