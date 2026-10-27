import { useEffect, useState } from 'react';
import {
  liveReconnectDelay,
  type LiveChange,
  type LiveOwnState,
  type LivePointer,
  type LiveServerMessage,
  type LiveSessionInfo,
} from '@gp/core';
import { newId } from '../ids.ts';

// Remote control on the client (spec 04 §2, ADR 0004). One socket per
// operator window to `/api/live/socket`: the window reports the session it
// owns, every member sees the organisation's sessions, and a controller's
// commands reach the owner through the server. The owner's outputs never
// wait for the network: they follow its own LiveChannel.

/** What the live page and the stage view drive: the window's own LiveChannel, or a session elsewhere. */
export interface LiveControl {
  readonly pointer: LivePointer;
  set(change: Partial<Omit<LivePointer, 'rev'>>): void;
  subscribe(fn: (p: LivePointer) => void): () => void;
}

/** This window's session id: kept for the tab's life, so a reload resumes the same session (spec 04). */
export function windowSessionId(): string {
  const key = 'gp.liveSession';
  try {
    const known = sessionStorage.getItem(key);
    if (known) return known;
    const made = newId();
    sessionStorage.setItem(key, made);
    return made;
  } catch {
    return newId();
  }
}

/** "Tillåt fjärrstyrning", per window: it stays on from one presentation to the next (LIVE-R39). */
export function remoteAllowed(): boolean {
  try {
    return sessionStorage.getItem('gp.remote') === '1';
  } catch {
    return false;
  }
}

export class LiveLink {
  sessions: LiveSessionInfo[] = [];
  connected = false;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private owned: LiveOwnState | null = null;
  private lastSent = '';
  private closed = false;
  private listeners = new Set<() => void>();
  private commandListeners = new Set<(sessionId: string, change: LiveChange) => void>();
  private errorListeners = new Set<(error: string) => void>();

  constructor(private protocols: string[]) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(new URL('/api/live/socket', location.origin.replace(/^http/, 'ws')).toString(), this.protocols);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.connected = true;
      // The whole state again on every reconnect (LIVE-R47).
      this.lastSent = '';
      if (this.owned) this.sendOwned();
      this.notify();
    });
    ws.addEventListener('message', (e) => {
      let m: LiveServerMessage;
      try {
        m = JSON.parse(String(e.data)) as LiveServerMessage;
      } catch {
        return;
      }
      if (m.type === 'sessions') {
        this.sessions = m.sessions;
        this.notify();
      } else if (m.type === 'command') for (const fn of this.commandListeners) fn(m.sessionId, m.change);
      else for (const fn of this.errorListeners) fn(m.error);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.notify();
      setTimeout(() => this.connect(), liveReconnectDelay(this.attempt++)); // LIVE-R51
    });
  }

  private send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private sendOwned() {
    const json = JSON.stringify(this.owned);
    if (json === this.lastSent) return; // only what changed (LIVE-R47)
    this.lastSent = json;
    this.send({ type: 'own', state: this.owned });
  }

  /** Reports the session this window presents; null when it stops presenting, which ends it. */
  own(state: LiveOwnState | null) {
    if (!state) {
      if (this.owned) this.send({ type: 'end', sessionId: this.owned.sessionId });
      this.owned = null;
      this.lastSent = '';
      return;
    }
    this.owned = state;
    this.sendOwned();
  }

  /** A controller's command: absolute, and dropped if the server cannot be reached (never queued, LIVE-R48). */
  command(sessionId: string, change: LiveChange) {
    this.send({ type: 'set', sessionId, change });
  }

  /** Ends a session whose owner is gone (LIVE-R50). */
  end(sessionId: string) {
    this.send({ type: 'end', sessionId });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onCommand(fn: (sessionId: string, change: LiveChange) => void): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }

  onError(fn: (error: string) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

/** The organisation's live sessions, as they change, and whether this window's socket is up. */
export function useLiveSessions(link: LiveLink): { sessions: LiveSessionInfo[]; connected: boolean } {
  const [value, setValue] = useState(() => ({ sessions: link.sessions, connected: link.connected }));
  useEffect(() => link.subscribe(() => setValue({ sessions: link.sessions, connected: link.connected })), [link]);
  return value;
}

/** How long a controller waits for the owner's echo before it warns (spec 04 §2). */
export const CONFIRM_MS = 2000;

/**
 * A session elsewhere, driven from here: it shows what the owner last
 * reported, except that a click shows at once (optimistic) until the echo.
 * If the owner has not confirmed within 2 s, `onUnconfirmed` is called once.
 */
export class RemoteControl implements LiveControl {
  private pending: { change: LiveChange; at: number } | null = null;
  private warned = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private link: LiveLink,
    readonly sessionId: string,
    private onUnconfirmed: () => void,
  ) {}

  private session(): LiveSessionInfo | undefined {
    return this.link.sessions.find((s) => s.id === this.sessionId);
  }

  get pointer(): LivePointer {
    const s = this.session();
    const reported = s?.pointer ?? { itemId: null, partIndex: 0, black: false, rev: 0 };
    const shown = this.pending && !matches(reported, this.pending.change) ? { ...reported, ...this.pending.change } : reported;
    return { presentationId: s?.presentationId ?? null, itemId: shown.itemId, partIndex: shown.partIndex, black: shown.black, rev: reported.rev };
  }

  set(change: Partial<Omit<LivePointer, 'rev'>>) {
    const now = this.pointer;
    const next: LiveChange = { itemId: change.itemId ?? now.itemId, partIndex: change.partIndex ?? now.partIndex, black: change.black ?? now.black };
    if (change.itemId === null) next.itemId = null;
    this.pending = { change: next, at: Date.now() };
    this.link.command(this.sessionId, next);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const s = this.session();
      if (this.pending && (!s || !matches(s.pointer, this.pending.change)) && !this.warned) {
        this.warned = true; // once (spec 04 §2)
        this.onUnconfirmed();
      }
      this.pending = null;
      this.notifySelf();
    }, CONFIRM_MS);
    this.notifySelf();
  }

  private selfListeners = new Set<(p: LivePointer) => void>();
  private notifySelf() {
    for (const fn of this.selfListeners) fn(this.pointer);
  }

  subscribe(fn: (p: LivePointer) => void): () => void {
    this.selfListeners.add(fn);
    const off = this.link.subscribe(() => {
      const s = this.session();
      if (this.pending && s && matches(s.pointer, this.pending.change)) this.pending = null; // the echo settles it
      fn(this.pointer);
    });
    fn(this.pointer);
    return () => {
      this.selfListeners.delete(fn);
      off();
    };
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

function matches(p: LiveChange, c: LiveChange): boolean {
  return p.itemId === c.itemId && p.partIndex === c.partIndex && p.black === c.black;
}
