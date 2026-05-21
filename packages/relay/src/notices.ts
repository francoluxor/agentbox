import { randomUUID } from 'node:crypto';
import type { PromptSubscribers } from './prompts.js';
import type { BoxNoticeEvent, NoticeKind } from './types.js';

/**
 * Default lifespan of a notice when its owner never clears it explicitly.
 * Longer than the relay's checkpoint RPC timeout (600s) so a notice still
 * self-expires even if the host CLI is SIGKILLed before its `finally` runs.
 */
const DEFAULT_NOTICE_TTL_MS = 660_000;

interface NoticeEntry {
  ev: BoxNoticeEvent;
  boxId: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * In-memory per-box informational notices, broadcast over the same SSE
 * channel as confirmation prompts. Unlike {@link import('./prompts.js').PendingPrompts}
 * these are fire-and-forget: there is no awaited promise and no answer. A
 * notice marks a box as transiently busy (a checkpoint freezes it via
 * `docker commit`); the host wrapper renders a spinner so the user can
 * tell the box from stuck.
 *
 * Deliberately NOT gated by `AGENTBOX_PROMPT=off` (which `askPrompt`
 * honours): a notice is informational, not a consent gate, so suppressing
 * it would only hide useful feedback.
 */
export class BoxNotices {
  /** keyed by notice id. */
  private readonly entries = new Map<string, NoticeEntry>();

  constructor(private readonly subscribers: PromptSubscribers) {}

  /**
   * Register a notice for `boxId` and broadcast `notice-set`. At most one
   * notice per (box, kind) is kept — a fresh `set` for the same kind
   * replaces the previous one (and cancels its TTL timer so a stale timer
   * can't later fire a `notice-clear` racing the replacement). Returns the
   * generated notice id.
   */
  set(boxId: string, kind: NoticeKind, message: string, ttlMs?: number): string {
    for (const [id, entry] of this.entries) {
      if (entry.boxId === boxId && entry.ev.kind === kind) {
        clearTimeout(entry.timer);
        this.entries.delete(id);
      }
    }
    const ev: BoxNoticeEvent = { id: randomUUID(), kind, message };
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : DEFAULT_NOTICE_TTL_MS;
    const timer = setTimeout(() => {
      // Safety net: a notice whose owner died without clearing it self-expires.
      if (this.entries.delete(ev.id)) {
        this.subscribers.broadcast(boxId, 'notice-clear', { id: ev.id });
      }
    }, ttl);
    if (typeof timer.unref === 'function') timer.unref();
    this.entries.set(ev.id, { ev, boxId, timer });
    this.subscribers.broadcast(boxId, 'notice-set', ev);
    return ev.id;
  }

  /**
   * Clear a notice by id. Idempotent: returns false when no such notice
   * exists (already cleared / expired). Broadcasts `notice-clear` on a hit.
   */
  clear(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    this.subscribers.broadcast(entry.boxId, 'notice-clear', { id });
    return true;
  }

  /** Snapshot of active notices for a box; replayed to a new SSE subscriber. */
  forBox(boxId: string): BoxNoticeEvent[] {
    const out: BoxNoticeEvent[] = [];
    for (const entry of this.entries.values()) {
      if (entry.boxId === boxId) out.push(entry.ev);
    }
    return out;
  }

  size(): number {
    return this.entries.size;
  }
}
