import { describe, expect, it } from 'vitest';
import { BoxNotFoundError, dockerProvider } from '../src/index.js';

describe('@agentbox/sandbox-docker', () => {
  it('exposes the docker provider name', () => {
    expect(dockerProvider.name).toBe('docker');
  });

  it('pause/resume/stop/destroy reject unknown ids with BoxNotFoundError', async () => {
    await expect(dockerProvider.pause('does-not-exist')).rejects.toBeInstanceOf(BoxNotFoundError);
    await expect(dockerProvider.resume('does-not-exist')).rejects.toBeInstanceOf(BoxNotFoundError);
    await expect(dockerProvider.stop('does-not-exist')).rejects.toBeInstanceOf(BoxNotFoundError);
    await expect(dockerProvider.destroy('does-not-exist')).rejects.toBeInstanceOf(BoxNotFoundError);
  });
});
