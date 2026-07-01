/**
 * `@agentbox/sandbox-core`'s `sync/` layer — the provider-neutral, fs/execa-
 * bearing implementation of the sync contracts declared in `@agentbox/core`.
 * The per-tool registry, concern modules (git/env/files/credentials/skills/
 * dynamic), and the data-driven driver land here across the refactor phases.
 *
 * Today it exports the parity net used to golden-test each concern as it is
 * migrated onto the `SyncTransport` seam.
 */

export {
  makeRecordingTransport,
  type RecordingSyncTransport,
  type RecordingTransportOptions,
  type RecordedOp,
} from './recording-transport.js';
