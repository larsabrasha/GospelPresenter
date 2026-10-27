import {
  ABANDONED_SESSION_MS,
  can,
  LIVE_MESSAGE_MAX,
  liveClientMessageSchema,
  MAX_VIEWERS,
  type LiveOwnState,
  type LiveServerMessage,
  type LiveSessionInfo,
  type PublicSlide,
  type Role,
  type WatchEvent,
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

const DDL = [
  `CREATE TABLE IF NOT EXISTS live_sessions (
     id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, presentation_id TEXT NOT NULL,
     presentation_name TEXT NOT NULL, device_name TEXT NOT NULL, remote INTEGER NOT NULL,
     pointer TEXT NOT NULL, owner_seen_at INTEGER NOT NULL, slide TEXT)`,
  // Which session a public output sends from: at most one (LIVE-R23).
  `CREATE TABLE IF NOT EXISTS live_bindings (display_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL)`,
];

/** One public viewer's stream (LIVE-R35): it only ever needs the newest event. */
export interface Viewer {
  send(e: WatchEvent): void;
  close(): void;
}

/** How often at most the viewer counts go out (LIVE-R36), with a trailing update. */
const COUNT_THROTTLE_MS = 2000;

interface Row {
  id: string;
  owner_user_id: string;
  presentation_id: string;
  presentation_name: string;
  device_name: string;
  remote: number;
  pointer: string;
  owner_seen_at: number;
  slide: string | null;
}

/**
 * Callers serialise every call with the organisation's other writes (its
 * queue), so a live write never lands inside a mutation's transaction.
 */
export class LiveHub {
  /** Public viewers, by output, by viewer id. In memory: a viewer reconnects if the process restarts. */
  private viewers = new Map<string, Map<string, { viewer: Viewer; code: string }>>();
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private countDue = false;

  constructor(
    private store: LiveStore,
    private sockets: () => LiveSocket[],
    private now: () => number = Date.now,
  ) {
    for (const d of DDL) store.query(d);
  }

  /** Stops the viewer-count timer: the database is about to close. */
  dispose() {
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = null;
    this.countDue = false;
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
      this.endSession(row.id);
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
      `INSERT INTO live_sessions (id, owner_user_id, presentation_id, presentation_name, device_name, remote, pointer, owner_seen_at, slide)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET presentation_id = excluded.presentation_id, presentation_name = excluded.presentation_name,
         device_name = excluded.device_name, remote = excluded.remote, pointer = excluded.pointer, owner_seen_at = excluded.owner_seen_at,
         slide = excluded.slide`,
      [
        state.sessionId,
        s.userId,
        state.presentationId,
        state.presentationName,
        state.deviceName,
        state.remote ? 1 : 0,
        JSON.stringify(state.pointer),
        this.now(),
        state.slide ? JSON.stringify(state.slide) : null,
      ],
    );
    if (!s.owns.includes(state.sessionId)) s.owns = [...s.owns, state.sessionId];
    const touched = this.bind(s, state);
    this.broadcast();
    for (const displayId of touched) this.pushTo(displayId);
  }

  /**
   * Binds the outputs the owner asked for and unbinds the rest of its own
   * (LIVE-R23). An output another live session sends to is taken only when
   * the owner says so ("Ta över"); otherwise the owner hears `output-taken`.
   * Returns every output whose picture may have changed.
   */
  private bind(s: LiveSocket, state: LiveOwnState): Set<string> {
    const touched = new Set<string>();
    const known = new Set((this.store.query('SELECT id FROM displays') as { id: string }[]).map((d) => d.id));
    const mine = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ?', [state.sessionId]) as { display_id: string }[]).map((b) => b.display_id);
    for (const id of mine) touched.add(id);
    for (const id of mine.filter((d) => !state.outputs.includes(d))) this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [id]);
    let refused = false;
    for (const id of state.outputs) {
      if (!known.has(id) || mine.includes(id)) continue;
      const [other] = this.store.query('SELECT session_id FROM live_bindings WHERE display_id = ?', [id]) as { session_id: string }[];
      if (other && this.row(other.session_id) && !state.takeOver.includes(id)) {
        refused = true;
        continue;
      }
      this.store.query(
        'INSERT INTO live_bindings (display_id, session_id) VALUES (?, ?) ON CONFLICT (display_id) DO UPDATE SET session_id = excluded.session_id',
        [id, state.sessionId],
      );
      touched.add(id);
    }
    if (refused) reply(s, { type: 'error', error: 'output-taken' });
    return touched;
  }

  private endSession(id: string) {
    const bound = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ?', [id]) as { display_id: string }[]).map((b) => b.display_id);
    this.store.query('DELETE FROM live_bindings WHERE session_id = ?', [id]);
    this.store.query('DELETE FROM live_sessions WHERE id = ?', [id]);
    for (const d of bound) this.pushTo(d);
  }

  // ------------------------------------------------------------ public outputs (spec 04 §6)

  /**
   * What an output shows now (LIVE-R32): the slide of the session it is
   * bound to, while that session exists, frozen or not; else the waiting
   * screen. A black screen or nothing selected is the waiting screen (LIVE-R14).
   */
  current(displayId: string): PublicSlide | null {
    const [b] = this.store.query('SELECT session_id FROM live_bindings WHERE display_id = ?', [displayId]) as { session_id: string }[];
    const row = b && this.row(b.session_id);
    return row?.slide ? (JSON.parse(row.slide) as PublicSlide) : null;
  }

  /**
   * Registers a viewer (LIVE-R36): at most 500 per output, but one already
   * known (a reload, a reconnect) replaces its old stream and is never refused.
   * Sends the newest state at once. False when it was refused as one too many.
   */
  watch(displayId: string, code: string, viewerId: string, viewer: Viewer, meta: { orgName: string; outputName: string }): boolean {
    let set = this.viewers.get(displayId);
    if (!set) this.viewers.set(displayId, (set = new Map()));
    const old = set.get(viewerId);
    if (!old && set.size >= MAX_VIEWERS) {
      viewer.send({ type: 'full' });
      viewer.close();
      return false;
    }
    set.set(viewerId, { viewer, code });
    old?.viewer.close();
    viewer.send({ type: 'meta', ...meta });
    const slide = this.current(displayId);
    viewer.send(slide ? { type: 'slide', slide } : { type: 'idle' });
    this.countsChanged();
    return true;
  }

  /** A viewer's stream ended. Only that stream: a newer one under the same id stays. */
  unwatch(displayId: string, viewerId: string, viewer: Viewer) {
    const set = this.viewers.get(displayId);
    if (set?.get(viewerId)?.viewer !== viewer) return;
    set.delete(viewerId);
    this.countsChanged();
  }

  /** Whether a picture may be shown to an output's viewers: only the one on screen (LIVE-R32, MEDIA-R10). */
  showing(displayId: string, hash: string): boolean {
    return this.current(displayId)?.image === hash;
  }

  /**
   * After an organisation's outputs changed: a deleted output, or one with a
   * new code, disconnects its viewers at once and loses its binding (spec 04 §7).
   */
  displaysChanged() {
    const codes = new Map((this.store.query('SELECT id, code FROM displays') as { id: string; code: string }[]).map((d) => [d.id, d.code]));
    this.store.query(`DELETE FROM live_bindings WHERE display_id NOT IN (SELECT id FROM displays)`);
    for (const [displayId, set] of this.viewers) {
      for (const [viewerId, v] of set) {
        if (codes.get(displayId) === v.code) continue;
        set.delete(viewerId);
        v.viewer.close();
      }
    }
    this.countsChanged();
    this.broadcast();
  }

  private pushTo(displayId: string) {
    const set = this.viewers.get(displayId);
    if (!set?.size) return; // nobody watching: nothing to send (LIVE-R37)
    const slide = this.current(displayId);
    const e: WatchEvent = slide ? { type: 'slide', slide } : { type: 'idle' };
    for (const v of set.values()) v.viewer.send(e);
  }

  private viewerCount(displayId: string): number {
    return this.viewers.get(displayId)?.size ?? 0;
  }

  /** Viewer counts reach the operators at most every 2 s: at once, then one trailing update (LIVE-R36). */
  private countsChanged() {
    if (this.countTimer) {
      this.countDue = true;
      return;
    }
    this.broadcast();
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      if (!this.countDue) return;
      this.countDue = false;
      this.countsChanged();
    }, COUNT_THROTTLE_MS);
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
        this.endSession(r.id);
        continue;
      }
      const outputs = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ? ORDER BY display_id', [r.id]) as { display_id: string }[]).map(
        (b) => ({ id: b.display_id, viewers: this.viewerCount(b.display_id) }),
      );
      out.push({
        id: r.id,
        presentationId: r.presentation_id,
        presentationName: r.presentation_name,
        deviceName: r.device_name,
        remote: r.remote === 1,
        ownerOnline: online.has(r.id),
        pointer: JSON.parse(r.pointer) as LiveSessionInfo['pointer'],
        outputs,
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
