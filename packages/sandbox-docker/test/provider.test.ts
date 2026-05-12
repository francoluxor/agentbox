import { describe, expect, it } from 'vitest';
import { dockerProvider } from '../src/index.js';

describe('@agentbox/sandbox-docker', () => {
  it('exposes the docker provider name', () => {
    expect(dockerProvider.name).toBe('docker');
  });

  it('pause/resume/stop/destroy are still stubs (next task)', async () => {
    await expect(dockerProvider.pause('a')).rejects.toThrow(/not yet implemented/);
    await expect(dockerProvider.resume('a')).rejects.toThrow(/not yet implemented/);
    await expect(dockerProvider.stop('a')).rejects.toThrow(/not yet implemented/);
    await expect(dockerProvider.destroy('a')).rejects.toThrow(/not yet implemented/);
  });
});
