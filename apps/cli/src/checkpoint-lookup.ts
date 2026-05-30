/**
 * Provider-aware checkpoint existence check used by the wizard. The default
 * checkpoint name lives in a single config field (`box.defaultCheckpoint`),
 * but the actual artifact may exist for Docker, for Daytona, both, or
 * neither. The wizard consults this helper before announcing "starting from
 * checkpoint …" — if the named checkpoint doesn't exist for the active
 * provider, the wizard falls through to the normal setup flow instead of
 * misleadingly skipping it.
 *
 * For cloud providers the local manifest is only half the story: the provider
 * snapshot it points at can expire or be deleted out-of-band. We probe the
 * backend for liveness and prune the dangling manifest when it's gone, so the
 * wizard re-asks the setup wizard (start-from-scratch) rather than booting
 * from a snapshot that would 410 mid-create.
 */

import type { ProviderName } from '@agentbox/core';
import { resolveCheckpoint } from '@agentbox/sandbox-docker';
import { probeCloudCheckpoint, resolveCloudCheckpoint } from '@agentbox/sandbox-cloud';
import { cloudBackendForProvider } from './provider/cloud-backend.js';

export async function checkpointExistsForProvider(
  provider: ProviderName,
  projectRoot: string,
  ref: string,
): Promise<boolean> {
  if (provider === 'docker') {
    return (await resolveCheckpoint(projectRoot, ref)) !== null;
  }
  // v1: every cloud backend ships its checkpoints under the
  // `~/.agentbox/cloud-checkpoints/<backend>/…` tree. The provider name is
  // also the backend name so the lookup is a 1:1 mapping.
  if ((await resolveCloudCheckpoint(projectRoot, provider, ref)) === null) return false;
  // Manifest present — confirm the provider snapshot it points at is still
  // bootable. A gone snapshot is pruned here so the next read sees nothing and
  // the create path provisions from the base image. A probe failure (network /
  // creds) is treated as "assume live": we never strand a usable checkpoint on
  // a transient error.
  try {
    const backend = await cloudBackendForProvider(provider);
    if (!backend) return true;
    const { live } = await probeCloudCheckpoint(backend, projectRoot, ref);
    return live;
  } catch {
    return true;
  }
}
