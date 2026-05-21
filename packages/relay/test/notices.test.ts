import { describe, expect, it, vi } from 'vitest';
import { BoxNotices } from '../src/notices.js';
import { PromptSubscribers } from '../src/prompts.js';

/** Minimal `ServerResponse`-shaped sink — captures every `write()`. */
function makeSink(): { writes: string[]; res: { write(s: string): true } } {
  const writes: string[] = [];
  return {
    writes,
    res: {
      write(s: string): true {
        writes.push(s);
        return true;
      },
    },
  };
}

describe('BoxNotices', () => {
  it('set generates an id, stores the notice, and broadcasts notice-set', () => {
    const subs = new PromptSubscribers();
    const sink = makeSink();
    subs.add('box-1', sink.res as never);
    const notices = new BoxNotices(subs);

    const id = notices.set('box-1', 'checkpoint', 'frozen');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(notices.size()).toBe(1);
    expect(sink.writes).toHaveLength(1);
    expect(sink.writes[0]!.startsWith('event: notice-set\n')).toBe(true);
    const match = /data: (\{.*\})/.exec(sink.writes[0]!);
    const ev = JSON.parse(match![1]!) as { id: string; kind: string; message: string };
    expect(ev).toEqual({ id, kind: 'checkpoint', message: 'frozen' });
  });

  it('clear removes the notice and broadcasts notice-clear', () => {
    const subs = new PromptSubscribers();
    const sink = makeSink();
    subs.add('box-1', sink.res as never);
    const notices = new BoxNotices(subs);

    const id = notices.set('box-1', 'checkpoint', 'frozen');
    expect(notices.clear(id)).toBe(true);
    expect(notices.size()).toBe(0);
    expect(sink.writes[1]).toBe(`event: notice-clear\ndata: {"id":"${id}"}\n\n`);
  });

  it('clear is idempotent (second call returns false)', () => {
    const notices = new BoxNotices(new PromptSubscribers());
    const id = notices.set('b', 'checkpoint', 'm');
    expect(notices.clear(id)).toBe(true);
    expect(notices.clear(id)).toBe(false);
  });

  it('a same-kind set replaces the previous notice and cancels its timer', () => {
    vi.useFakeTimers();
    try {
      const subs = new PromptSubscribers();
      const sink = makeSink();
      subs.add('b', sink.res as never);
      const notices = new BoxNotices(subs);

      const first = notices.set('b', 'checkpoint', 'one', 1000);
      const second = notices.set('b', 'checkpoint', 'two', 1000);
      expect(first).not.toBe(second);
      expect(notices.forBox('b').map((e) => e.id)).toEqual([second]);

      // Past the first notice's TTL — its timer was cancelled, so the only
      // notice-clear that fires is the second's (and only after its own TTL).
      vi.advanceTimersByTime(1000);
      const clears = sink.writes.filter((w) => w.startsWith('event: notice-clear\n'));
      expect(clears).toEqual([`event: notice-clear\ndata: {"id":"${second}"}\n\n`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a notice self-expires after its TTL and broadcasts notice-clear', () => {
    vi.useFakeTimers();
    try {
      const subs = new PromptSubscribers();
      const sink = makeSink();
      subs.add('b', sink.res as never);
      const notices = new BoxNotices(subs);

      const id = notices.set('b', 'checkpoint', 'm', 500);
      expect(notices.size()).toBe(1);
      vi.advanceTimersByTime(500);
      expect(notices.size()).toBe(0);
      expect(sink.writes.at(-1)).toBe(`event: notice-clear\ndata: {"id":"${id}"}\n\n`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forBox returns only the requested box notices', () => {
    const notices = new BoxNotices(new PromptSubscribers());
    const a = notices.set('a', 'checkpoint', 'ma');
    notices.set('b', 'checkpoint', 'mb');
    expect(notices.forBox('a').map((e) => e.id)).toEqual([a]);
    expect(notices.forBox('b')).toHaveLength(1);
    expect(notices.forBox('missing')).toEqual([]);
  });
});
