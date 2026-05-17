import { describe, expect, it } from 'vitest';
import { InputParser, type InputEvent } from '../src/dashboard/input.js';

function harness() {
  const events: InputEvent[] = [];
  const timers: Array<{ id: number; fn: () => void }> = [];
  let seq = 0;
  const parser = new InputParser({
    onEvent: (e) => events.push(e),
    setTimer: (_ms, fn) => {
      const id = ++seq;
      timers.push({ id, fn });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const fire = (): void => {
    const cur = timers.splice(0, timers.length);
    for (const t of cur) t.fn();
  };
  const forwarded = (): string =>
    events
      .filter((e) => e.type === 'forward')
      .map((e) => (e.type === 'forward' ? e.bytes.toString('utf8') : ''))
      .join('');
  return { parser, events, fire, forwarded };
}

describe('InputParser', () => {
  it('forwards normal bytes verbatim', () => {
    const h = harness();
    h.parser.feed(Buffer.from('hello'));
    expect(h.forwarded()).toBe('hello');
  });

  it('Ctrl-a chord: q quits, n/p switch', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x01, 0x71])); // Ctrl-a q
    h.parser.feed(Buffer.from([0x01, 0x6e])); // Ctrl-a n
    h.parser.feed(Buffer.from([0x01, 0x70])); // Ctrl-a p
    expect(h.events).toEqual([
      { type: 'quit' },
      { type: 'switch', dir: 'next' },
      { type: 'switch', dir: 'prev' },
    ]);
  });

  it('Ctrl-a Ctrl-a sends a single literal Ctrl-a', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x01, 0x01]));
    expect(h.forwarded()).toBe('\x01');
  });

  it('bare Ctrl-a flushes after the leader timeout', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x01]));
    expect(h.forwarded()).toBe('');
    h.fire();
    expect(h.forwarded()).toBe('\x01');
  });

  it('Ctrl+Option+Up/Down (CSI 1;7 A/B) switches', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x1b, 0x5b, 0x31, 0x3b, 0x37, 0x41]));
    h.parser.feed(Buffer.from([0x1b, 0x5b, 0x31, 0x3b, 0x37, 0x42]));
    expect(h.events).toEqual([
      { type: 'switch', dir: 'prev' },
      { type: 'switch', dir: 'next' },
    ]);
  });

  it('forwards a plain arrow key verbatim (not a hotkey)', () => {
    const h = harness();
    h.parser.feed(Buffer.from('\x1b[A'));
    expect(h.forwarded()).toBe('\x1b[A');
    expect(h.events.some((e) => e.type === 'switch')).toBe(false);
  });

  it('forwards a lone ESC after the inter-byte timeout', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x1b]));
    expect(h.forwarded()).toBe('');
    h.fire();
    expect(h.forwarded()).toBe('\x1b');
  });

  it('Ctrl-a then arrow switches', () => {
    const h = harness();
    h.parser.feed(Buffer.from([0x01, 0x1b, 0x5b, 0x41])); // Ctrl-a, ESC [ A
    expect(h.events).toEqual([{ type: 'switch', dir: 'prev' }]);
  });
});

describe('InputParser mouse', () => {
  function mharness(transform?: (x: number, y: number) => { x: number; y: number } | null) {
    const events: InputEvent[] = [];
    const parser = new InputParser({
      onEvent: (e) => events.push(e),
      mouseTransform: transform,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    const fwd = (): string =>
      events
        .filter((e) => e.type === 'forward')
        .map((e) => (e.type === 'forward' ? e.bytes.toString('latin1') : ''))
        .join('');
    return { parser, fwd };
  }

  it('translates an SGR wheel-scroll report into pane-local coords', () => {
    // sidebar+sep = 33 cols offset; wheel-up (64) at host col 50,row 10.
    const h = mharness((x, y) => ({ x: x - 33, y }));
    h.parser.feed(Buffer.from('\x1b[<64;50;10M', 'latin1'));
    expect(h.fwd()).toBe('\x1b[<64;17;10M');
  });

  it('drops a mouse report over the sidebar (transform returns null)', () => {
    const h = mharness(() => null);
    h.parser.feed(Buffer.from('\x1b[<0;5;3M', 'latin1'));
    expect(h.fwd()).toBe('');
  });

  it('forwards SGR mouse verbatim when no transform is set', () => {
    const h = mharness(undefined);
    h.parser.feed(Buffer.from('\x1b[<0;12;7m', 'latin1'));
    expect(h.fwd()).toBe('\x1b[<0;12;7m');
  });

  it('translates a legacy X10 mouse report', () => {
    const h = mharness((x, y) => ({ x: x - 10, y: y - 1 }));
    // ESC [ M  cb=32(' ')  cx=32+50  cy=32+10
    const seq = Buffer.from([0x1b, 0x5b, 0x4d, 32, 32 + 50, 32 + 10]);
    h.parser.feed(seq);
    expect(Buffer.from(h.fwd(), 'latin1')).toEqual(
      Buffer.from([0x1b, 0x5b, 0x4d, 32, 32 + 40, 32 + 9]),
    );
  });
});
