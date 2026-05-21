import { describe, expect, it } from 'vitest';
import { isOpenableUrl } from '../src/server.js';

describe('isOpenableUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isOpenableUrl('http://example.com')).toBe(true);
    expect(isOpenableUrl('https://example.com')).toBe(true);
    expect(isOpenableUrl('https://example.com/path?q=1#frag')).toBe(true);
    expect(isOpenableUrl('http://127.0.0.1:3000')).toBe(true);
  });

  it('rejects non-http(s) schemes so the box cannot open host files or apps', () => {
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('ftp://example.com')).toBe(false);
    expect(isOpenableUrl('vscode://foo')).toBe(false);
  });

  it('rejects bare paths, relative refs, and garbage', () => {
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('example.com')).toBe(false);
    expect(isOpenableUrl('/Applications/Calculator.app')).toBe(false);
    expect(isOpenableUrl('not a url')).toBe(false);
  });
});
