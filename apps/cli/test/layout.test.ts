import { describe, expect, it } from 'vitest';
import { computeLayout, SIDEBAR_WIDTH } from '../src/dashboard/layout.js';

describe('computeLayout', () => {
  it('splits sidebar + separator + right pane + status row', () => {
    const l = computeLayout(120, 40);
    expect(l.sidebar).toEqual({ x: 0, y: 0, w: SIDEBAR_WIDTH, h: 39 });
    expect(l.sepX).toBe(SIDEBAR_WIDTH);
    expect(l.right.x).toBe(SIDEBAR_WIDTH + 1);
    expect(l.right.w).toBe(120 - SIDEBAR_WIDTH - 1);
    expect(l.right.h).toBe(39);
    expect(l.statusY).toBe(39);
    expect(l.tooSmall).toBe(false);
  });

  it('flags tooSmall when the right pane cannot fit', () => {
    // Sidebar shrinks to protect a 20-col right pane; only too small below ~21.
    expect(computeLayout(40, 40).tooSmall).toBe(false);
    expect(computeLayout(20, 40).tooSmall).toBe(true);
    expect(computeLayout(120, 4).tooSmall).toBe(true);
  });

  it('shrinks the sidebar before going negative', () => {
    const l = computeLayout(45, 20);
    expect(l.sidebar.w).toBeLessThan(SIDEBAR_WIDTH);
    expect(l.right.w).toBeGreaterThanOrEqual(0);
  });
});
