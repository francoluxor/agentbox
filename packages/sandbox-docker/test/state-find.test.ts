import { describe, expect, it } from 'vitest';
import { findBox, type BoxRecord, type StateFile } from '../src/state.js';

const mk = (
  id: string,
  name: string,
  overrides: Partial<BoxRecord> = {},
): BoxRecord => ({
  id,
  name,
  container: `agentbox-${name}`,
  image: 'agentbox/box:dev',
  workspacePath: '/tmp/ws',
  lowerPath: '/tmp/ws',
  upperVolume: `agentbox-upper-${id}`,
  nodeModulesVolume: `agentbox-nm-${id}`,
  snapshotDir: null,
  createdAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
});

const state = (boxes: BoxRecord[]): StateFile => ({ version: 1, boxes });

describe('findBox', () => {
  it('returns none on an empty state', () => {
    expect(findBox('anything', state([])).kind).toBe('none');
  });

  it('returns none when nothing matches', () => {
    expect(findBox('xxxx', state([mk('a1b2c3d4', 'alpha')])).kind).toBe('none');
  });

  it('matches exact id', () => {
    const boxes = [mk('a1b2c3d4', 'alpha'), mk('e5f6a7b8', 'beta')];
    const result = findBox('a1b2c3d4', state(boxes));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.box.id).toBe('a1b2c3d4');
  });

  it('matches a unique id prefix', () => {
    const boxes = [mk('a1b2c3d4', 'alpha'), mk('e5f6a7b8', 'beta')];
    const result = findBox('a1b2', state(boxes));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.box.id).toBe('a1b2c3d4');
  });

  it('reports ambiguous on a prefix that matches multiple ids', () => {
    const boxes = [mk('a1b2c3d4', 'alpha'), mk('a1b2c3d5', 'beta')];
    const result = findBox('a1b2', state(boxes));
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.matches).toHaveLength(2);
  });

  it('falls back to exact name when no id matches', () => {
    const boxes = [mk('a1b2c3d4', 'alpha'), mk('e5f6a7b8', 'beta')];
    const result = findBox('alpha', state(boxes));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.box.name).toBe('alpha');
  });

  it('falls back to exact container name as a last resort', () => {
    const boxes = [mk('a1b2c3d4', 'alpha'), mk('e5f6a7b8', 'beta')];
    const result = findBox('agentbox-beta', state(boxes));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.box.id).toBe('e5f6a7b8');
  });

  it('prefers exact id over name when both could match', () => {
    // a record whose name equals another record's id should not steal the match
    const boxes = [
      mk('a1b2c3d4', 'alpha'),
      mk('e5f6a7b8', 'a1b2c3d4'), // pathological: name collides with sibling id
    ];
    const result = findBox('a1b2c3d4', state(boxes));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.box.id).toBe('a1b2c3d4');
  });

  it('rejects empty/whitespace queries', () => {
    expect(findBox('', state([mk('a1b2c3d4', 'alpha')])).kind).toBe('none');
    expect(findBox('   ', state([mk('a1b2c3d4', 'alpha')])).kind).toBe('none');
  });
});
