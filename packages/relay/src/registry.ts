import type { BoxRegistration, RelayEvent } from './types.js';
import { RELAY_EVENT_RING_SIZE } from './types.js';

export class BoxRegistry {
  private readonly map = new Map<string, BoxRegistration>();

  register(reg: BoxRegistration): void {
    this.map.set(reg.boxId, reg);
  }

  forget(boxId: string): boolean {
    return this.map.delete(boxId);
  }

  /** Returns the registration whose token matches, or null. */
  authenticate(token: string): BoxRegistration | null {
    if (token.length === 0) return null;
    for (const reg of this.map.values()) {
      if (reg.token === token) return reg;
    }
    return null;
  }

  get(boxId: string): BoxRegistration | undefined {
    return this.map.get(boxId);
  }

  list(): BoxRegistration[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }
}

export class EventBuffer {
  private readonly buf: RelayEvent[] = [];
  private nextId = 1;
  constructor(private readonly capacity: number = RELAY_EVENT_RING_SIZE) {}

  append(input: Omit<RelayEvent, 'id' | 'receivedAt'>): RelayEvent {
    const ev: RelayEvent = {
      id: this.nextId++,
      receivedAt: new Date().toISOString(),
      ...input,
    };
    this.buf.push(ev);
    if (this.buf.length > this.capacity) this.buf.shift();
    return ev;
  }

  /** Returns events with id > since. If `box` is given, filters to that box. */
  since(since: number, box?: string): RelayEvent[] {
    const out: RelayEvent[] = [];
    for (const ev of this.buf) {
      if (ev.id <= since) continue;
      if (box && ev.boxId !== box) continue;
      out.push(ev);
    }
    return out;
  }

  all(): RelayEvent[] {
    return this.buf.slice();
  }

  size(): number {
    return this.buf.length;
  }
}
