import {
  ABANDONED_SESSION_MS,
  can,
  LIVE_MESSAGE_MAX,
  liveClientMessageSchema,
  type LiveOwnState,
  type LiveServerMessage,
  type LiveSessionInfo,
  type Role,
} from '@gp/core';

// An organisation's live sessions (spec 04, ADR 0004): which window presents
// what, and whether phones may drive it. The same code on Node (in process)
// and in the organisation's Durable Object, which may hibernate between
// messages: so the sessions are rows in a server-only table, and which socket
// owns which session is kept on the socket (an attachment in a Durable Object).

/** One window's live socket, whichever runtime holds it. */
export interface LiveSocket {
  readonly userId: string;
  readonly role: Role;
  /** The sessions this socket reported as their owner. */
  owns: string[];
  send(message: string): void;
}

export interface LiveStore {
  query(sql: string, params?: unknown[]): Record<string, unknown>[];
}

const DDL = `CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, presentation_id TEXT NOT NULL,
  presentation_name TEXT NOT NULL, device_name TEXT NOT NULL, remote INTEGER NOT NULL,
  pointer TEXT NOT NULL, owner_seen_at INTEGER NOT NULL)`;

interface Row {
  id: string;
  owner_user_id: string;
  presentation_id: string;
  presentation_name: string;
  device_name: string;
  remote: number;
  pointer: string;
  owner_seen_at: number;
}

/**
 * Callers serialise every call with the organisation's other writes (its
 * queue), so a live write never lands inside a mutation's transaction.
 */
export class LiveHub {
  constructor(
    private store: LiveStore,
    private sockets: () => LiveSocket[],
    private now: () => number = Date.now,
  ) {
    store.query(DDL);
  }

  /** A new socket gets the sessions at once. */
  opened(s: LiveSocket) {
    s.send(this.snapshot());
  }

  /** A socket went away: what it owned freezes (LIVE-R50) until its owner reports again. */
  closed(s: LiveSocket) {
    const owned = s.owns;
    s.owns = [];
    for (const id of owned) if (!this.ownerOnline(id)) this.store.query('UPDATE live_sessions SET owner_seen_at = ? WHERE id = ?', [this.now(), id]);
    if (owned.length) this.broadcast();
  }

  message(s: LiveSocket, raw: string) {
    let parsed: unknown;
    try {
      parsed = raw.length <= LIVE_MESSAGE_MAX ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    const m = liveClientMessageSchema.safeParse(parsed);
    if (!m.success) return reply(s, { type: 'error', error: 'invalid-message' });
    // Starting and controlling a presentation need ManagePresentations (ADR 0007 decision 5).
    if (!can(s.role, 'ManagePresentations')) return reply(s, { type: 'error', error: 'forbidden' });
    const msg = m.data;
    if (msg.type === 'own') return this.own(s, msg.state);
    const row = this.row(msg.sessionId);
    if (!row) return reply(s, { type: 'error', error: 'not-found' });
    if (msg.type === 'end') {
      // The owner stops; anyone may end a session whose owner is gone (LIVE-R50).
      if (!s.owns.includes(row.id) && this.ownerOnline(row.id)) return reply(s, { type: 'error', error: 'not-owner' });
      this.store.query('DELETE FROM live_sessions WHERE id = ?', [row.id]);
      return this.broadcast();
    }
    // A command (LIVE-R48): only with remote control on and the owner there; never queued.
    if (!row.remote) return reply(s, { type: 'error', error: 'remote-off' });
    const owners = this.sockets().filter((o) => o.owns.includes(row.id));
    if (!owners.length) return reply(s, { type: 'error', error: 'owner-offline' });
    const command = JSON.stringify({ type: 'command', sessionId: row.id, change: msg.change } satisfies LiveServerMessage);
    for (const o of owners) o.send(command);
  }

  private own(s: LiveSocket, state: LiveOwnState) {
    const existing = this.row(state.sessionId);
    // A session id is the owner's; another user cannot take it over by naming it.
    if (existing && existing.owner_user_id !== s.userId) return reply(s, { type: 'error', error: 'not-owner' });
    this.store.query(
      `INSERT INTO live_sessions (id, owner_user_id, presentation_id, presentation_name, device_name, remote, pointer, owner_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET presentation_id = excluded.presentation_id, presentation_name = excluded.presentation_name,
         device_name = excluded.device_name, remote = excluded.remote, pointer = excluded.pointer, owner_seen_at = excluded.owner_seen_at`,
      [state.sessionId, s.userId, state.presentationId, state.presentationName, state.deviceName, state.remote ? 1 : 0, JSON.stringify(state.pointer), this.now()],
    );
    if (!s.owns.includes(state.sessionId)) s.owns = [...s.owns, state.sessionId];
    this.broadcast();
  }

  private row(id: string): Row | undefined {
    return this.store.query('SELECT * FROM live_sessions WHERE id = ?', [id])[0] as Row | undefined;
  }

  private ownerOnline(id: string): boolean {
    return this.sockets().some((o) => o.owns.includes(id));
  }

  /** Every session, after ending those whose owner has been gone too long (LIVE-R50). */
  sessions(): LiveSessionInfo[] {
    const online = new Set(this.sockets().flatMap((o) => o.owns));
    const rows = this.store.query('SELECT * FROM live_sessions ORDER BY id') as unknown as Row[];
    const out: LiveSessionInfo[] = [];
    for (const r of rows) {
      if (!online.has(r.id) && r.owner_seen_at < this.now() - ABANDONED_SESSION_MS) {
        this.store.query('DELETE FROM live_sessions WHERE id = ?', [r.id]);
        continue;
      }
      out.push({
        id: r.id,
        presentationId: r.presentation_id,
        presentationName: r.presentation_name,
        deviceName: r.device_name,
        remote: r.remote === 1,
        ownerOnline: online.has(r.id),
        pointer: JSON.parse(r.pointer) as LiveSessionInfo['pointer'],
      });
    }
    return out;
  }

  private snapshot(): string {
    return JSON.stringify({ type: 'sessions', sessions: this.sessions() } satisfies LiveServerMessage);
  }

  private broadcast() {
    const msg = this.snapshot();
    for (const s of this.sockets()) s.send(msg);
  }
}

function reply(s: LiveSocket, m: LiveServerMessage) {
  s.send(JSON.stringify(m));
}
