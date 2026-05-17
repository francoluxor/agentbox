import { describe, expect, it } from 'vitest';
import {
  sgrFor,
  composeRow,
  diffFrame,
  type CellLike,
  type ScreenSnapshot,
} from '../src/dashboard/renderer.js';

function cell(over: Partial<CellLike> = {}): CellLike {
  return {
    width: 1,
    chars: ' ',
    fg: { kind: 'default' },
    bg: { kind: 'default' },
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    invisible: false,
    strike: false,
    ...over,
  };
}

function snap(rowsChars: string[]): ScreenSnapshot {
  const cols = Math.max(...rowsChars.map((r) => r.length));
  return {
    cols,
    rows: rowsChars.length,
    cursor: { x: 0, y: 0, visible: false },
    cell: (x, y) => cell({ chars: rowsChars[y]?.[x] ?? '' }),
  };
}

describe('sgrFor', () => {
  it('encodes default/palette/rgb and attrs', () => {
    expect(sgrFor(cell())).toBe('\x1b[0;39;49m');
    expect(sgrFor(cell({ fg: { kind: 'palette', n: 3 } }))).toBe('\x1b[0;33;49m');
    expect(sgrFor(cell({ fg: { kind: 'palette', n: 12 } }))).toBe('\x1b[0;94;49m');
    expect(sgrFor(cell({ fg: { kind: 'palette', n: 200 } }))).toBe('\x1b[0;38;5;200;49m');
    expect(sgrFor(cell({ bg: { kind: 'rgb', rgb: 0x102030 } }))).toBe('\x1b[0;39;48;2;16;32;48m');
    expect(sgrFor(cell({ bold: true, underline: true }))).toBe('\x1b[0;39;49;1;4m');
  });
});

describe('composeRow', () => {
  it('run-length collapses identical SGR and pads via NullCells', () => {
    const s = composeRow(snap(['ab']), 0);
    // one SGR for the whole constant-style row, ends with reset
    expect(s).toBe('\x1b[0;39;49mab\x1b[0m');
  });

  it('skips the trailing half of a wide char', () => {
    const s: ScreenSnapshot = {
      cols: 2,
      rows: 1,
      cursor: { x: 0, y: 0, visible: false },
      cell: (x) => (x === 0 ? cell({ chars: '世', width: 2 }) : cell({ width: 0 })),
    };
    expect(composeRow(s, 0)).toBe('\x1b[0;39;49m世\x1b[0m');
  });
});

describe('diffFrame', () => {
  const rect = { x: 10, y: 0, w: 2, h: 2 };

  it('full paint when prev is null, then no-op when unchanged', () => {
    const first = diffFrame(null, snap(['ab', 'cd']), rect);
    expect(first.rows).toHaveLength(2);
    expect(first.out).toContain('ab');
    const second = diffFrame(first.rows, snap(['ab', 'cd']), rect);
    // cursor hidden + nothing positioned/rewritten
    expect(second.out).toBe('\x1b[?25l');
  });

  it('rewrites only the changed row', () => {
    const a = diffFrame(null, snap(['ab', 'cd']), rect);
    const b = diffFrame(a.rows, snap(['ab', 'XY']), rect);
    expect(b.out).toContain('XY');
    expect(b.out).not.toContain('ab');
  });
});
