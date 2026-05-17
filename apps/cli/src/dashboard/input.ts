export type InputEvent =
  | { type: 'switch'; dir: 'next' | 'prev' }
  | { type: 'quit' }
  | { type: 'forward'; bytes: Buffer };

export interface InputParserOptions {
  onEvent: (e: InputEvent) => void;
  /**
   * Map a 1-based absolute screen coordinate from a host mouse report into the
   * right pane's 1-based local coordinate. Return null to drop the event (the
   * pointer is over the sidebar/status, not Claude). Omit to forward mouse
   * reports unchanged.
   */
  mouseTransform?: (x: number, y: number) => { x: number; y: number } | null;
  /** Timeout after a bare leader (Ctrl-a) before it's sent through. */
  leaderMs?: number;
  /** Inter-byte timeout for an unfinished escape/mouse sequence. */
  escMs?: number;
  /** Injected for unit tests; defaults to global timers. */
  setTimer?: (ms: number, fn: () => void) => unknown;
  clearTimer?: (h: unknown) => void;
}

const LEADER = 0x01; // Ctrl-a
const ESC = 0x1b;

// Ctrl+Option+Up / Down (xterm modifyOtherKeys: CSI 1 ; 7 A|B).
const PREV_SEQ = [0x1b, 0x5b, 0x31, 0x3b, 0x37, 0x41];
const NEXT_SEQ = [0x1b, 0x5b, 0x31, 0x3b, 0x37, 0x42];
const ARROWS: Array<{ seq: number[]; dir: 'prev' | 'next' }> = [
  { seq: [0x1b, 0x5b, 0x41], dir: 'prev' },
  { seq: [0x1b, 0x4f, 0x41], dir: 'prev' },
  { seq: [0x1b, 0x5b, 0x42], dir: 'next' },
  { seq: [0x1b, 0x4f, 0x42], dir: 'next' },
];

function eq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function isPrefix(buf: number[], target: number[]): boolean {
  return buf.length <= target.length && buf.every((v, i) => v === target[i]);
}

type State = 'normal' | 'leader' | 'esc' | 'leaderEsc' | 'mouseSgr' | 'mouseX10';

/**
 * Byte-level host-stdin parser. Recognizes a tiny hotkey set, coordinate-
 * translates mouse reports into the right pane, and forwards everything else
 * verbatim. Timeout-based buffering so a real ESC keypress or a forwarded
 * escape sequence is never swallowed.
 */
export class InputParser {
  private state: State = 'normal';
  private esc: number[] = [];
  private fwd: number[] = [];
  private timer: unknown = null;
  private timerId = 0;
  private readonly leaderMs: number;
  private readonly escMs: number;
  private readonly setTimer: (ms: number, fn: () => void) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly onEvent: (e: InputEvent) => void;
  private readonly mouseTransform?: (x: number, y: number) => { x: number; y: number } | null;

  constructor(opts: InputParserOptions) {
    this.onEvent = opts.onEvent;
    this.mouseTransform = opts.mouseTransform;
    this.leaderMs = opts.leaderMs ?? 700;
    this.escMs = opts.escMs ?? 50;
    this.setTimer = opts.setTimer ?? ((ms, fn) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  feed(buf: Buffer): void {
    let i = 0;
    while (i < buf.length) {
      const b = buf[i]!;
      if (this.state === 'normal') {
        if (b === LEADER) {
          this.flush();
          this.state = 'leader';
          this.arm(this.leaderMs, 'leader');
        } else if (b === ESC) {
          this.flush();
          this.state = 'esc';
          this.esc = [ESC];
          this.arm(this.escMs, 'esc');
        } else {
          this.fwd.push(b);
        }
        i++;
        continue;
      }
      if (this.state === 'leader') {
        this.disarm();
        if (b === LEADER) {
          this.fwd.push(LEADER);
          this.flush();
          this.state = 'normal';
          i++;
        } else if (b === ESC) {
          this.state = 'leaderEsc';
          this.esc = [ESC];
          this.arm(this.escMs, 'esc');
          i++;
        } else {
          const c = String.fromCharCode(b);
          if (c === 'k' || c === 'p' || c === 'P') this.onEvent({ type: 'switch', dir: 'prev' });
          else if (c === 'j' || c === 'n' || c === 'N') this.onEvent({ type: 'switch', dir: 'next' });
          else if (c === 'd' || c === 'q') this.onEvent({ type: 'quit' });
          else {
            this.fwd.push(b);
            this.flush();
          }
          this.state = 'normal';
          i++;
        }
        continue;
      }
      if (this.state === 'mouseSgr') {
        this.esc.push(b);
        if (b === 0x4d || b === 0x6d) {
          // 'M' (press/scroll) or 'm' (release) terminates an SGR mouse report.
          this.disarm();
          this.emitMouseSgr();
          this.reset();
        } else {
          this.arm(this.escMs, 'esc');
        }
        i++;
        continue;
      }
      if (this.state === 'mouseX10') {
        this.esc.push(b);
        if (this.esc.length === 6) {
          // ESC [ M  +  cb cx cy  (each byte = value + 32)
          this.disarm();
          this.emitMouseX10();
          this.reset();
        } else {
          this.arm(this.escMs, 'esc');
        }
        i++;
        continue;
      }
      // esc / leaderEsc
      if (this.state === 'esc' && eq(this.esc, [ESC, 0x5b]) && b === 0x3c) {
        this.esc.push(b); // ESC [ <  → SGR mouse report
        this.state = 'mouseSgr';
        this.arm(this.escMs, 'esc');
        i++;
        continue;
      }
      if (this.state === 'esc' && eq(this.esc, [ESC, 0x5b]) && b === 0x4d) {
        this.esc.push(b); // ESC [ M  → legacy X10 mouse report
        this.state = 'mouseX10';
        this.arm(this.escMs, 'esc');
        i++;
        continue;
      }
      const cand = this.esc.concat(b);
      const targets =
        this.state === 'esc' ? [PREV_SEQ, NEXT_SEQ] : ARROWS.map((a) => a.seq);
      if (this.state === 'esc' && eq(cand, PREV_SEQ)) {
        this.disarm();
        this.onEvent({ type: 'switch', dir: 'prev' });
        this.reset();
        i++;
      } else if (this.state === 'esc' && eq(cand, NEXT_SEQ)) {
        this.disarm();
        this.onEvent({ type: 'switch', dir: 'next' });
        this.reset();
        i++;
      } else if (this.state === 'leaderEsc' && ARROWS.some((a) => eq(cand, a.seq))) {
        this.disarm();
        const dir = ARROWS.find((a) => eq(cand, a.seq))!.dir;
        this.onEvent({ type: 'switch', dir });
        this.reset();
        i++;
      } else if (targets.some((t) => isPrefix(cand, t))) {
        this.esc = cand;
        this.arm(this.escMs, 'esc');
        i++;
      } else {
        const buffered = this.esc;
        const wasEsc = this.state === 'esc';
        this.disarm();
        this.reset();
        if (wasEsc) {
          for (const x of buffered) this.fwd.push(x);
          this.flush();
        }
        // do not advance i — reprocess b in 'normal'
      }
    }
    if (this.state === 'normal') this.flush();
  }

  dispose(): void {
    this.disarm();
  }

  private reset(): void {
    this.state = 'normal';
    this.esc = [];
  }

  private flush(): void {
    if (this.fwd.length === 0) return;
    this.onEvent({ type: 'forward', bytes: Buffer.from(this.fwd) });
    this.fwd = [];
  }

  private forwardVerbatim(bytes: number[]): void {
    for (const x of bytes) this.fwd.push(x);
    this.flush();
  }

  private emitMouseSgr(): void {
    const s = Buffer.from(this.esc).toString('latin1'); // ESC [ < b ; x ; y (M|m)
    const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(s);
    if (!m || !this.mouseTransform) {
      this.forwardVerbatim(this.esc);
      return;
    }
    const t = this.mouseTransform(Number(m[2]), Number(m[3]));
    if (!t) return; // over the sidebar/status — drop
    this.forwardVerbatim([
      ...Buffer.from(`\x1b[<${m[1]!};${String(t.x)};${String(t.y)}${m[4]!}`, 'latin1'),
    ]);
  }

  private emitMouseX10(): void {
    const e = this.esc; // ESC [ M cb cx cy
    if (e.length !== 6 || !this.mouseTransform) {
      this.forwardVerbatim(e);
      return;
    }
    const t = this.mouseTransform(e[4]! - 32, e[5]! - 32);
    if (!t) return;
    this.forwardVerbatim([0x1b, 0x5b, 0x4d, e[3]!, t.x + 32, t.y + 32]);
  }

  private arm(ms: number, kind: 'leader' | 'esc'): void {
    this.disarm();
    const id = ++this.timerId;
    this.timer = this.setTimer(ms, () => {
      if (id !== this.timerId) return; // stale
      this.timer = null;
      if (kind === 'leader' && this.state === 'leader') {
        this.fwd.push(LEADER);
        this.flush();
        this.state = 'normal';
      } else if (
        kind === 'esc' &&
        (this.state === 'esc' || this.state === 'mouseSgr' || this.state === 'mouseX10')
      ) {
        this.forwardVerbatim(this.esc);
        this.reset();
      } else if (kind === 'esc' && this.state === 'leaderEsc') {
        this.reset(); // lone ESC after leader → cancel
      }
    });
  }

  private disarm(): void {
    this.timerId++;
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
