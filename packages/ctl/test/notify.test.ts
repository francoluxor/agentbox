import { describe, expect, it } from 'vitest';
import { notifyCommand } from '../src/commands/notify.js';

/**
 * notifyCommand is a thin alias around `claudeState({state:'waiting'|'idle'})`
 * — the underlying socket wire op is already exercised end-to-end in
 * `socket.test.ts`. These tests cover the command-structure invariants
 * (subcommand mapping, options) so a future refactor can't silently
 * remove the `notify clear` alias or rename a flag.
 */
describe('notifyCommand', () => {
  it('registers as `notify` with a `clear` subcommand', () => {
    expect(notifyCommand.name()).toBe('notify');
    const sub = notifyCommand.commands.find((c) => c.name() === 'clear');
    expect(sub).toBeDefined();
  });

  it('top-level accepts --socket and --message', () => {
    const opts = notifyCommand.options.map((o) => o.long);
    expect(opts).toContain('--socket');
    expect(opts).toContain('--message');
  });

  it('clear subcommand accepts --socket', () => {
    const sub = notifyCommand.commands.find((c) => c.name() === 'clear');
    const opts = sub?.options.map((o) => o.long) ?? [];
    expect(opts).toContain('--socket');
  });

  it('description mentions the dashboard / user-input semantic so docs stay in sync', () => {
    expect(notifyCommand.description()).toMatch(/waiting/i);
  });
});
