import { describe, expect, it } from 'vitest';
import { activityCell, sidebarLines, statusLine } from '../src/dashboard/sidebar.js';

describe('activityCell', () => {
  it('maps claude activity for running boxes', () => {
    expect(activityCell({ id: '1', name: 'a', state: 'running', claudeActivity: 'working' })).toBe(
      '● working',
    );
    expect(activityCell({ id: '1', name: 'a', state: 'running', claudeActivity: 'waiting' })).toBe(
      '◐ waiting',
    );
    expect(activityCell({ id: '1', name: 'a', state: 'running' })).toBe('? unknown');
  });
  it('shows container state when not running', () => {
    expect(activityCell({ id: '1', name: 'a', state: 'paused' })).toBe('[paused]');
  });
});

describe('sidebarLines', () => {
  const boxes = [
    { id: 'aaa', name: 'api', state: 'running', claudeActivity: 'idle' },
    { id: 'bbb', name: 'web', state: 'stopped' },
  ];
  it('exactly h lines, each exactly w wide, selected marked', () => {
    const lines = sidebarLines(boxes, 'bbb', 24, 8);
    expect(lines).toHaveLength(8);
    for (const l of lines) expect(l).toHaveLength(24);
    const sel = lines.find((l) => l.includes('web'))!;
    expect(sel.startsWith('▸ ')).toBe(true);
    const other = lines.find((l) => l.includes('api'))!;
    expect(other.startsWith('  ')).toBe(true);
  });
  it('handles empty box list', () => {
    const lines = sidebarLines([], '', 20, 5);
    expect(lines).toHaveLength(5);
    expect(lines.some((l) => l.includes('(no boxes)'))).toBe(true);
  });
});

describe('statusLine', () => {
  it('is inverse video and exactly w printable columns', () => {
    const s = statusLine({ id: '1', name: 'api', state: 'running', claudeActivity: 'working' }, 60);
    expect(s.startsWith('\x1b[7m')).toBe(true);
    expect(s.endsWith('\x1b[0m')).toBe(true);
    const printable = s.replace('\x1b[7m', '').replace('\x1b[0m', '');
    expect(printable).toHaveLength(60);
    expect(printable).toContain('api');
  });
});
