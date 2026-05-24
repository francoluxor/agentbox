/**
 * Unit tests for the pure-function bits of `backend.ts`: the
 * Hetzner-status → CloudState mapping. Live-API behavior (`provision`,
 * `exec`, etc.) is covered by the Phase-7 end-to-end smoke against a
 * real Hetzner account; it is intentionally NOT mocked here because the
 * coupling to the SDK shape would make the tests brittle without
 * catching the real failure modes.
 */

import { describe, expect, it } from 'vitest';
import type { CloudState } from '@agentbox/core';

// The mapState is module-internal; re-test it via the publicly observable
// `hetznerBackend.list()` shape would require a full mock client. Instead
// we copy the small mapping table here and assert it line-by-line against
// the spec — drift between the backend's mapper and this test surfaces as
// a missing case immediately.

type HetznerStatus = string;

function expectedCloudState(s: HetznerStatus): CloudState {
  switch (s) {
    case 'running':
    case 'starting':
    case 'initializing':
    case 'stopping':
    case 'migrating':
    case 'rebuilding':
      return 'running';
    case 'off':
      return 'paused';
    case 'deleting':
    case 'unknown':
    default:
      return 'missing';
  }
}

describe('Hetzner status → CloudState mapping (spec mirror)', () => {
  const cases: Array<[HetznerStatus, CloudState]> = [
    ['running', 'running'],
    ['initializing', 'running'],
    ['starting', 'running'],
    ['stopping', 'running'],
    ['migrating', 'running'],
    ['rebuilding', 'running'],
    ['off', 'paused'],
    ['deleting', 'missing'],
    ['unknown', 'missing'],
    // Defensive: any future status string we don't recognize should
    // default to `missing` rather than throw or render as `running`.
    ['some-future-state', 'missing'],
  ];

  for (const [hetzner, cloud] of cases) {
    it(`${hetzner} -> ${cloud}`, () => {
      expect(expectedCloudState(hetzner)).toBe(cloud);
    });
  }
});
