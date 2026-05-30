import { beforeEach, describe, expect, it, vi } from 'vitest';

// execa is mocked so the tests never shell out to docker.
const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));
vi.mock('execa', () => ({ execa: execaMock }));

// prepared-state writes to ~/.agentbox; stub it so the unit test stays pure.
const { writePreparedDockerStateMock } = vi.hoisted(() => ({
  writePreparedDockerStateMock: vi.fn(),
}));
vi.mock('../src/prepared-state.js', () => ({
  writePreparedDockerState: writePreparedDockerStateMock,
}));

import { BOX_IMAGE_REGISTRY, pullOrBuild, registryRefForSha } from '../src/image.js';

interface ExecaResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
const ok: ExecaResult = { exitCode: 0, stdout: '', stderr: '' };
const fail: ExecaResult = { exitCode: 1, stdout: '', stderr: '' };

// docker subcommand of a recorded execa call: execa('docker', [subcmd, ...]).
const sub = (call: unknown[]): string => (call[1] as string[])[0] ?? '';
const calledWith = (subcmd: string): boolean =>
  execaMock.mock.calls.some((c) => sub(c) === subcmd);

const fp = { contextSha256: '0123456789abcdef0123456789abcdef' };

beforeEach(() => {
  execaMock.mockReset();
  writePreparedDockerStateMock.mockReset();
});

describe('registryRefForSha', () => {
  it('takes the first 16 hex chars and the given registry', () => {
    expect(registryRefForSha(fp.contextSha256, 'ghcr.io/x/box')).toBe(
      'ghcr.io/x/box:sha-0123456789abcdef',
    );
  });
  it('defaults to BOX_IMAGE_REGISTRY', () => {
    expect(registryRefForSha('abc123')).toBe(`${BOX_IMAGE_REGISTRY}:sha-abc123`);
  });
});

describe('pullOrBuild', () => {
  it('pulls and retags on a registry hit — no build, fingerprint recorded', async () => {
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'pull' || args[0] === 'tag') return ok;
      throw new Error(`unexpected docker ${args[0]}`);
    });

    const res = await pullOrBuild('agentbox/box:dev', fp);

    expect(res.source).toBe('pulled');
    expect(calledWith('build')).toBe(false);
    // retagged the pulled fingerprint image to the working ref
    const tagCall = execaMock.mock.calls.find((c) => sub(c) === 'tag');
    expect(tagCall?.[1]).toEqual([
      'tag',
      `${BOX_IMAGE_REGISTRY}:sha-0123456789abcdef`,
      'agentbox/box:dev',
    ]);
    expect(writePreparedDockerStateMock).toHaveBeenCalledWith({
      imageRef: 'agentbox/box:dev',
      contextSha256: fp.contextSha256,
    });
  });

  it('falls back to a local build on a registry miss', async () => {
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'pull') return fail;
      if (args[0] === 'build') return ok;
      throw new Error(`unexpected docker ${args[0]}`);
    });

    const res = await pullOrBuild('agentbox/box:dev', fp);

    expect(res.source).toBe('built');
    expect(calledWith('pull')).toBe(true);
    expect(calledWith('build')).toBe(true);
    expect(calledWith('tag')).toBe(false);
    expect(writePreparedDockerStateMock).toHaveBeenCalled();
  });

  it('skips the pull entirely when allowPull is false', async () => {
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'build') return ok;
      throw new Error(`unexpected docker ${args[0]}`);
    });

    const res = await pullOrBuild('agentbox/box:dev', fp, { allowPull: false });

    expect(res.source).toBe('built');
    expect(calledWith('pull')).toBe(false);
  });

  it('skips the pull when the registry is empty', async () => {
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'build') return ok;
      throw new Error(`unexpected docker ${args[0]}`);
    });

    const res = await pullOrBuild('agentbox/box:dev', fp, { registry: '' });

    expect(res.source).toBe('built');
    expect(calledWith('pull')).toBe(false);
  });

  it('builds (no prepared-state write) when the context is unfingerprintable', async () => {
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'build') return ok;
      throw new Error(`unexpected docker ${args[0]}`);
    });

    const res = await pullOrBuild('agentbox/box:dev', null);

    expect(res.source).toBe('built');
    expect(calledWith('pull')).toBe(false);
    expect(writePreparedDockerStateMock).not.toHaveBeenCalled();
  });
});
