import { describe, expect, it } from 'vitest';
import { mapState, previewSlug, safeName } from '../src/backend.js';

describe('mapState', () => {
  it('maps running-ish states to running', () => {
    for (const s of ['RUNNING', 'CREATING', 'RESUMING'] as const) {
      expect(mapState(s)).toBe('running');
    }
  });

  it('maps pausing/paused to paused', () => {
    for (const s of ['PAUSED', 'PAUSING'] as const) {
      expect(mapState(s)).toBe('paused');
    }
  });

  it('maps terminal / unknown / undefined to missing', () => {
    for (const s of ['TERMINATING', 'TERMINATED', 'UNSPECIFIED'] as const) {
      expect(mapState(s)).toBe('missing');
    }
    expect(mapState(undefined)).toBe('missing');
  });
});

describe('previewSlug', () => {
  it('is stable + DNS-safe per (session, port)', () => {
    const a = previewSlug('sess_AbC123XyZ789', 8080);
    expect(a).toBe(previewSlug('sess_AbC123XyZ789', 8080));
    expect(a).toMatch(/^ab-[a-z0-9]+-8080$/);
  });

  it('differs by port', () => {
    expect(previewSlug('sess_x', 80)).not.toBe(previewSlug('sess_x', 6080));
  });

  it('falls back to a non-empty slug for an id with no alnum chars', () => {
    expect(previewSlug('___', 80)).toBe('ab-box-80');
  });
});

describe('safeName', () => {
  it('keeps hyphens and alphanumerics (box names are not mangled)', () => {
    expect(safeName('my-box-123')).toBe('my-box-123');
  });

  it('strips control characters (newlines/tabs)', () => {
    expect(safeName('a\nb\tc')).toBe('abc');
  });

  it('caps length at 200', () => {
    expect(safeName('x'.repeat(500)).length).toBe(200);
  });
});
