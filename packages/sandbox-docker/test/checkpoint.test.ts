import { describe, expect, it } from 'vitest';
import { computeNextCheckpointName } from '../src/checkpoint.js';

describe('computeNextCheckpointName', () => {
  it('starts at 1 when no checkpoints exist for the box', () => {
    expect(computeNextCheckpointName([], 'warm')).toBe('warm-1');
    expect(computeNextCheckpointName(['other-1', 'other-2'], 'warm')).toBe('warm-1');
  });

  it('is max+1, never recycling gaps from deleted checkpoints', () => {
    expect(computeNextCheckpointName(['warm-1', 'warm-2'], 'warm')).toBe('warm-3');
    // warm-2 deleted -> still 3, the gap is not reused.
    expect(computeNextCheckpointName(['warm-1', 'warm-3'], 'warm')).toBe('warm-4');
  });

  it('scopes the counter to the exact box name', () => {
    expect(computeNextCheckpointName(['warm-1', 'warmer-9'], 'warm')).toBe('warm-2');
    expect(computeNextCheckpointName(['warm-1', 'warmer-9'], 'warmer')).toBe('warmer-10');
  });

  it('treats a box name with regex metacharacters literally', () => {
    expect(computeNextCheckpointName(['a.b-1', 'aXb-5'], 'a.b')).toBe('a.b-2');
  });

  it('ignores non-numeric suffixes', () => {
    expect(computeNextCheckpointName(['warm-foo', 'warm-1'], 'warm')).toBe('warm-2');
  });
});
