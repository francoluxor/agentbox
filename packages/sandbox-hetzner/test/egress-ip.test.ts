import { afterEach, describe, expect, it } from 'vitest';
import { detectEgressIp, egressIpCached, __resetEgressCache } from '../src/egress-ip.js';

function fakeFetch(map: Record<string, { status: number; body: string }>): typeof fetch {
  // Use Parameters<typeof fetch>[0] instead of `RequestInfo | URL` so this
  // doesn't depend on DOM lib being in scope — different @types/node versions
  // expose `RequestInfo` inconsistently and CI was failing the typecheck.
  return (async (url: Parameters<typeof fetch>[0]) => {
    const u = typeof url === 'string' ? url : url.toString();
    const r = map[u];
    if (!r) throw new Error(`no fake for ${u}`);
    return new Response(r.body, { status: r.status }) as unknown as Response;
  }) as typeof fetch;
}

describe('detectEgressIp', () => {
  it('returns the IP from the first probe that succeeds', async () => {
    const ip = await detectEgressIp({
      probes: ['https://probe-a', 'https://probe-b'],
      fetchImpl: fakeFetch({
        'https://probe-a': { status: 200, body: '203.0.113.42\n' },
        'https://probe-b': { status: 500, body: 'down' },
      }),
    });
    expect(ip).toBe('203.0.113.42');
  });

  it('falls through to later probes when an earlier one returns garbage', async () => {
    const ip = await detectEgressIp({
      probes: ['https://probe-a', 'https://probe-b', 'https://probe-c'],
      fetchImpl: fakeFetch({
        'https://probe-a': { status: 200, body: 'not an ip' },
        'https://probe-b': { status: 200, body: '999.0.0.1' }, // octet out of range
        'https://probe-c': { status: 200, body: '198.51.100.7' },
      }),
    });
    expect(ip).toBe('198.51.100.7');
  });

  it('fails loud when every probe fails (no 0.0.0.0/0 silent default)', async () => {
    await expect(
      detectEgressIp({
        probes: ['https://probe-a', 'https://probe-b'],
        fetchImpl: fakeFetch({
          'https://probe-a': { status: 500, body: 'nope' },
          'https://probe-b': { status: 502, body: 'down' },
        }),
      }),
    ).rejects.toThrow(/could not auto-detect/i);
  });
});

describe('egressIpCached', () => {
  afterEach(() => __resetEgressCache());

  /** A fetch that counts how many times it was invoked. */
  function countingFetch(body: string): { fetchImpl: typeof fetch; calls: () => number } {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return new Response(body, { status: 200 }) as unknown as Response;
    }) as typeof fetch;
    return { fetchImpl, calls: () => n };
  }

  it('probes once within the TTL window, re-probes after it', async () => {
    const { fetchImpl, calls } = countingFetch('203.0.113.9\n');
    const opts = { probes: ['https://p'], fetchImpl, ttlMs: 1000 };
    let t = 10_000;
    const now = () => t;

    expect(await egressIpCached({ ...opts, now })).toBe('203.0.113.9');
    t = 10_500; // within TTL → cached, no new probe
    expect(await egressIpCached({ ...opts, now })).toBe('203.0.113.9');
    expect(calls()).toBe(1);

    t = 11_500; // past TTL → re-probe
    expect(await egressIpCached({ ...opts, now })).toBe('203.0.113.9');
    expect(calls()).toBe(2);
  });
});
