import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSetupInitialPrompt,
  IN_BOX_SETUP_GUIDE_PATH,
  installAgentboxSetupSkill,
  passthroughFlags,
} from '../src/wizard.js';

describe('passthroughFlags', () => {
  it('returns empty for an empty options object', () => {
    expect(passthroughFlags({})).toEqual([]);
  });

  it('emits --host-snapshot / --no-host-snapshot based on the tri-state', () => {
    expect(passthroughFlags({ hostSnapshot: true })).toEqual(['--host-snapshot']);
    expect(passthroughFlags({ hostSnapshot: false })).toEqual(['--no-host-snapshot']);
    expect(passthroughFlags({ hostSnapshot: undefined })).toEqual([]);
  });

  it('forwards --snapshot <ref> (checkpoint) as a value flag', () => {
    expect(passthroughFlags({ snapshot: 'warm-1' })).toEqual(['--snapshot', 'warm-1']);
    expect(passthroughFlags({ snapshot: undefined })).toEqual([]);
  });

  it('emits --no-vnc only when vnc is explicitly false', () => {
    expect(passthroughFlags({ vnc: true })).toEqual([]);
    expect(passthroughFlags({ vnc: false })).toEqual(['--no-vnc']);
  });

  it('forwards workspace / name / image as value flags', () => {
    expect(
      passthroughFlags({ workspace: '/tmp/x', name: 'foo', image: 'agentbox/box:dev' }),
    ).toEqual(['--workspace', '/tmp/x', '--name', 'foo', '--image', 'agentbox/box:dev']);
  });

  it('forwards boolean flags only when true', () => {
    expect(passthroughFlags({ withPlaywright: true, sharedDockerCache: true })).toEqual([
      '--with-playwright',
      '--shared-docker-cache',
    ]);
    expect(passthroughFlags({ withPlaywright: false, sharedDockerCache: false })).toEqual([]);
  });

  it('does NOT forward --yes (claude wizard would suppress the setup-token prompt)', () => {
    const out = passthroughFlags({ workspace: '/tmp/x' } as never);
    expect(out).not.toContain('--yes');
  });
});

describe('buildSetupInitialPrompt', () => {
  it('includes the workspace basename and the in-box guide path', () => {
    const prompt = buildSetupInitialPrompt('/Users/me/repos/cool-project');
    expect(prompt).toContain('cool-project');
    expect(prompt).toContain(IN_BOX_SETUP_GUIDE_PATH);
    expect(prompt).toMatch(/\/workspace\/agentbox\.yaml/);
  });

  it('references the /agentbox-setup skill so claude invokes it', () => {
    const prompt = buildSetupInitialPrompt('/x/y');
    expect(prompt).toContain('/agentbox-setup');
  });

  it('instructs claude to reload the supervisor so tasks run immediately', () => {
    const prompt = buildSetupInitialPrompt('/x/y');
    expect(prompt).toContain('agentbox-ctl reload');
  });
});

describe('installAgentboxSetupSkill', () => {
  let dir: string;
  let target: string;
  let source: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentbox-wizard-test-'));
    target = join(dir, 'skills', 'agentbox-setup', 'SKILL.md');
    source = join(dir, 'src-SKILL.md');
    await writeFile(source, '# bundled-skill-content\n', 'utf8');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('copies the bundled skill into the target dir when absent', async () => {
    const res = await installAgentboxSetupSkill({ targetFile: target, sourceFile: source });
    expect(res.installed).toBe(true);
    expect(res.targetFile).toBe(target);
    const written = await readFile(target, 'utf8');
    expect(written).toBe('# bundled-skill-content\n');
  });

  it('is a no-op when the target file already exists', async () => {
    await installAgentboxSetupSkill({ targetFile: target, sourceFile: source });
    // Overwrite with a sentinel; second call must NOT clobber it.
    await writeFile(target, '# user-edited\n', 'utf8');
    const res = await installAgentboxSetupSkill({ targetFile: target, sourceFile: source });
    expect(res.installed).toBe(false);
    const written = await readFile(target, 'utf8');
    expect(written).toBe('# user-edited\n');
  });

  it('silently skips when the bundled source is missing', async () => {
    const res = await installAgentboxSetupSkill({
      targetFile: target,
      sourceFile: join(dir, 'does-not-exist.md'),
    });
    expect(res.installed).toBe(false);
  });
});
