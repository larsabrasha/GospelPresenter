import {
  ABANDONED_SESSION_MS,
  can,
  LIVE_MESSAGE_MAX,
  liveClientMessageSchema,
  REMOTE_CONTROL_SETTING,
  SCREEN_IDLE_MS,
  SESSION_IDLE_MS,
  remoteControlAllowed,
  remoteControlPolicy,
  type Canvas,
  type LiveOwnState,
  type LiveScreen,
  type LiveServerMessage,
  type LiveSessionInfo,
  type PublicSlide,
  type Role,
  type WatchEvent,
} from '@gp/core';
import { mayShowImage, mayShowVideo } from './live-output-gate.ts';
import { canvasOf, prepareLiveTables, saveSession, sessionInfoOf, slideOf, type LiveStore, type SessionRow } from './live-tables.ts';
import { OutputViewers, type Viewer } from './live-viewers.ts';

// An organisation's live sessions (spec 04, ADR 0004): which window presents
// what, and whether phones may drive it (the window's toggle, under the
// organisation's remote control policy). The same code on Node (in process)
// and in the organisation's Durable Object, which may hibernate between
// messages: so the sessions are rows in a server-only table, and which socket
// owns which session is kept on the socket (an attachment in a Durable Object).

/** One window's live socket, whichever runtime holds it. */
export interface LiveSocket {
  /** Stable for the connection, whichever object stands for it. */
  readonly id: string;
  readonly userId: string;
  readonly role: Role;
  /** The sessions this socket reported as their owner. */
  owns: string[];
  send(message: string): void;
}

/**
 * Callers serialise every call with the organisation's other writes (its
 * queue), so a live write never lands inside a mutation's transaction.
 */
export class LiveHub {
  /** The streams that follow the outputs; a saved screen gone for good loses its binding. */
  private viewers: OutputViewers;
  /**
   * Sockets that have closed. A runtime may go on listing one for a while (a
   * Durable Object during and after webSocketClose), so it is left out until
   * the runtime stops listing it.
   */
  private gone = new Set<string>();
  /** The pending check for idle screens (LIVE-R43), due at `at`; a timer whose entry was replaced does nothing. */
  private idleCheck: { at: number; timer: unknown } | null = null;

  constructor(
    private store: LiveStore,
    private allSockets: () => LiveSocket[],
    private now: () => number = Date.now,
    /** Temporary screens a session let go, for the global tables to forget (`ScreenRegistry.release`). */
    private released: (ids: string[]) => void = () => undefined,
    /** Runs `fn` after `ms`, in the organisation's queue like every other call (the runtime wraps it). */
    private later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {
    prepareLiveTables(store);
    this.viewers = new OutputViewers(
      () => this.broadcast(),
      (displayId) => {
        this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [displayId]);
        this.broadcast();
      },
      later,
    );
  }

  /** Stops the timers: the database is about to close. */
  dispose() {
    this.viewers.dispose();
    if (this.idleCheck) clearTimeout(this.idleCheck.timer as ReturnType<typeof setTimeout>);
    this.idleCheck = null;
  }

  private sockets(): LiveSocket[] {
    const all = this.allSockets();
    const listed = new Set(all.map((o) => o.id));
    for (const id of this.gone) if (!listed.has(id)) this.gone.delete(id);
    return all.filter((o) => !this.gone.has(o.id));
  }

  /** A new socket gets the sessions at once. */
  opened(s: LiveSocket) {
    s.send(this.snapshot());
  }

  /** A socket went away: what it owned freezes (LIVE-R50) until its owner reports again. */
  closed(s: LiveSocket) {
    this.gone.add(s.id);
    const owned = s.owns;
    try {
      s.owns = [];
    } catch {
      // A closing socket may not take a new attachment; it is left out all the same (`gone`).
    }
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
    if (m.data.type === 'ping') return reply(s, { type: 'pong' });
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
    if (!this.remoteAllowed(row)) return reply(s, { type: 'error', error: 'remote-off' });
    const owners = this.sockets().filter((o) => o.owns.includes(row.id));
    if (!owners.length) return reply(s, { type: 'error', error: 'owner-offline' });
    const command = JSON.stringify(
      (msg.type === 'audio'
        ? { type: 'audio-command', sessionId: row.id, command: msg.command }
        : msg.type === 'video'
          ? { type: 'video-command', sessionId: row.id, command: msg.command }
          : { type: 'command', sessionId: row.id, change: msg.change }) satisfies LiveServerMessage,
    );
    for (const o of owners) {
      try {
        o.send(command);
      } catch {
        // closing: the command is dropped, never queued (LIVE-R48)
      }
    }
  }

  private own(s: LiveSocket, state: LiveOwnState) {
    const existing = this.row(state.sessionId);
    // A session id is the owner's; another user cannot take it over by naming it.
    if (existing && existing.owner_user_id !== s.userId) return reply(s, { type: 'error', error: 'not-owner' });
    const slide = state.slide ? JSON.stringify(state.slide) : null;
    // A slide change (another slide, black, an overlay, an edit to what shows) is the screens' activity (LIVE-R43).
    const changed = !existing || existing.pointer !== JSON.stringify(state.pointer) || existing.slide !== slide;
    saveSession(this.store, s.userId, state, slide, this.now());
    if (!s.owns.includes(state.sessionId)) s.owns = [...s.owns, state.sessionId];
    const touched = this.bind(s, state);
    if (changed) this.store.query('UPDATE live_bindings SET active_at = ? WHERE session_id = ?', [this.now(), state.sessionId]);
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
    const displays = this.store.query('SELECT id, kind FROM displays') as { id: string; kind: string }[];
    // A saved screen only while its page is open (LIVE-A21); a temporary screen only for the session that paired it.
    const known = new Set([
      ...displays.filter((d) => d.kind !== 'screen' || this.viewers.online(d.id)).map((d) => d.id),
      ...(this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [state.sessionId]) as { id: string }[]).map((x) => x.id),
    ]);
    const mine = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ?', [state.sessionId]) as { display_id: string }[]).map((b) => b.display_id);
    for (const id of mine) touched.add(id);
    const dropped = mine.filter((d) => !state.outputs.includes(d) || !known.has(d));
    for (const id of dropped) this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [id]);
    // A temporary screen switched off (✕) is let go: its TV shows a new code.
    this.releaseScreens((this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [state.sessionId]) as { id: string }[]).map((x) => x.id).filter((id) => dropped.includes(id)));
    // A saved screen let go for idling stays off until the owner switches it off (LIVE-R43); then it may be switched on again.
    const idled = (this.store.query('SELECT display_id FROM live_released WHERE session_id = ?', [state.sessionId]) as { display_id: string }[]).map((r) => r.display_id);
    for (const id of idled) if (!state.outputs.includes(id)) this.store.query('DELETE FROM live_released WHERE display_id = ? AND session_id = ?', [id, state.sessionId]);
    const stillIdle = idled.filter((id) => state.outputs.includes(id));
    if (stillIdle.length) reply(s, { type: 'released', sessionId: state.sessionId, outputs: stillIdle });
    let refused = false;
    for (const id of state.outputs) {
      if (!known.has(id) || mine.includes(id) || stillIdle.includes(id)) continue;
      const [other] = this.store.query('SELECT session_id FROM live_bindings WHERE display_id = ?', [id]) as { session_id: string }[];
      if (other && this.row(other.session_id) && !state.takeOver.includes(id)) {
        refused = true;
        continue;
      }
      this.store.query(
        'INSERT INTO live_bindings (display_id, session_id, active_at) VALUES (?, ?, ?) ON CONFLICT (display_id) DO UPDATE SET session_id = excluded.session_id, active_at = excluded.active_at',
        [id, state.sessionId, this.now()],
      );
      touched.add(id);
    }
    if (refused) reply(s, { type: 'error', error: 'output-taken' });
    return touched;
  }

  /** `expired`: ended by the server (LIVE-R42, LIVE-R50) rather than by a person. */
  private endSession(id: string, expired = false) {
    const bound = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ?', [id]) as { display_id: string }[]).map((b) => b.display_id);
    this.store.query('DELETE FROM live_bindings WHERE session_id = ?', [id]);
    // An owner still online brings an expired session back with its next report: its let-go screens stay off.
    if (!expired || !this.ownerOnline(id)) this.store.query('DELETE FROM live_released WHERE session_id = ?', [id]);
    this.store.query('DELETE FROM live_sessions WHERE id = ?', [id]);
    // Its temporary screens go with it (LIVE-R24: the screen disconnects itself).
    this.releaseScreens((this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [id]) as { id: string }[]).map((x) => x.id));
    // A saved screen whose session was stopped draws black (Display.razor keeps the pairing when the presentation
    // stops), its name when its page is opened again; one whose session expired shows its name at once.
    for (const d of bound) this.pushTo(d, !expired);
  }

  /**
   * Lets go of the screens whose session has not changed slide for
   * SCREEN_IDLE_MS (LIVE-R43): a temporary screen shows a new code, a saved
   * screen its name. Their owners hear `released`, to switch them off.
   */
  private releaseIdleScreens() {
    const idle = this.store.query(
      `SELECT b.display_id, b.session_id, (t.id IS NOT NULL) AS temporary FROM live_bindings b LEFT JOIN live_screens t ON t.id = b.display_id
       WHERE b.active_at <= ? AND (t.id IS NOT NULL OR b.display_id IN (SELECT id FROM displays WHERE kind = 'screen'))`,
      [this.now() - SCREEN_IDLE_MS],
    ) as { display_id: string; session_id: string; temporary: number }[];
    if (!idle.length) return;
    this.releaseScreens(idle.filter((b) => b.temporary).map((b) => b.display_id));
    for (const b of idle.filter((x) => !x.temporary)) {
      this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [b.display_id]);
      this.store.query('INSERT INTO live_released (display_id, session_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [b.display_id, b.session_id]);
      this.pushTo(b.display_id);
    }
    for (const sessionId of new Set(idle.map((b) => b.session_id))) {
      const message = JSON.stringify({ type: 'released', sessionId, outputs: idle.filter((b) => b.session_id === sessionId).map((b) => b.display_id) } satisfies LiveServerMessage);
      for (const o of this.sockets().filter((x) => x.owns.includes(sessionId))) {
        try {
          o.send(message);
        } catch {
          // closing: the owner hears it with its next report (`bind`)
        }
      }
    }
  }

  /**
   * Keeps one check pending for the screen that idles out first (LIVE-R43).
   * Sessions are checked whenever anything happens (`sessions`), not on a
   * timer, so a Durable Object without open streams may hibernate.
   */
  private scheduleIdleCheck() {
    const [first] = this.store.query(
      `SELECT min(active_at) AS at FROM live_bindings WHERE display_id IN (SELECT id FROM live_screens UNION SELECT id FROM displays WHERE kind = 'screen')`,
    ) as { at: number | null }[];
    if (first?.at == null) return;
    const at = Number(first.at) + SCREEN_IDLE_MS;
    if (this.idleCheck && this.idleCheck.at <= at) return;
    if (this.idleCheck) clearTimeout(this.idleCheck.timer as ReturnType<typeof setTimeout>);
    const mark: { at: number; timer: unknown } = { at, timer: null };
    this.idleCheck = mark;
    mark.timer = this.later(
      () => {
        if (this.idleCheck !== mark) return;
        this.idleCheck = null;
        this.broadcast(); // sweeps, and schedules the next check
      },
      Math.max(at - this.now(), 0) + 1000,
    );
  }

  // ------------------------------------------------------------ temporary screens (spec 04 §5)

  /**
   * A screen this organisation paired (by code or QR token), for `sessionId`:
   * that session may now switch it on. Numbered for its name: one more than
   * the highest paired now. Null when the session is not live here, or not `userId`'s.
   */
  addScreen(id: string, sessionId: string, userId: string): LiveScreen | null {
    if (this.row(sessionId)?.owner_user_id !== userId) return null;
    const [known] = this.store.query('SELECT id, n FROM live_screens WHERE id = ?', [id]) as unknown as LiveScreen[];
    if (known) return known;
    const n = Number((this.store.query('SELECT coalesce(max(n), 0) + 1 AS n FROM live_screens')[0] as { n: number }).n);
    this.store.query('INSERT INTO live_screens (id, n, session_id) VALUES (?, ?, ?)', [id, n, sessionId]);
    this.broadcast();
    return { id, n };
  }

  /** Whether a temporary screen is paired here, and its number. */
  screen(id: string): LiveScreen | null {
    return (this.store.query('SELECT id, n FROM live_screens WHERE id = ?', [id])[0] as unknown as LiveScreen | undefined) ?? null;
  }

  /** A screen that was paired but that no session took in (a dropped QR token, a session gone): its TV starts again. */
  dropScreen(id: string) {
    const known = !!this.screen(id);
    this.releaseScreens([id]);
    if (known) this.broadcast();
  }

  private releaseScreens(ids: string[]) {
    if (!ids.length) return;
    for (const id of ids) {
      this.store.query('DELETE FROM live_screens WHERE id = ?', [id]);
      this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [id]);
      this.viewers.closeAll(id, { type: 'unpaired' });
    }
    this.released(ids);
  }

  // ------------------------------------------------------------ public outputs (spec 04 §6)

  /**
   * What an output shows now (LIVE-R32): the slide of the session it is
   * bound to, while that session exists, frozen or not; else the waiting
   * screen. A black screen or nothing selected is the waiting screen (LIVE-R14).
   */
  current(displayId: string): PublicSlide | null {
    return slideOf(this.boundRow(displayId));
  }

  /**
   * What a paired screen draws now (spec 04 §5): the canvas of the session it
   * is bound to; from an owner that reports none (an older build), the public
   * slide's. Null: black.
   */
  canvas(displayId: string): Canvas | null {
    return canvasOf(this.boundRow(displayId));
  }

  /** The event an output's viewer gets for what it shows now: a public output the public slide, a paired screen the canvas. */
  private shown(displayId: string, screen: boolean): WatchEvent {
    // A screen bound to a session draws its canvas, black included, as Display.razor; unbound, it waits.
    const row = this.boundRow(displayId);
    if (screen) return row ? { type: 'canvas', canvas: canvasOf(row), now: this.now() } : { type: 'idle' };
    const slide = slideOf(row);
    return slide ? { type: 'slide', slide } : { type: 'idle' };
  }

  private boundRow(displayId: string): SessionRow | undefined {
    const [b] = this.store.query('SELECT session_id FROM live_bindings WHERE display_id = ?', [displayId]) as { session_id: string }[];
    return b && this.row(b.session_id);
  }

  /**
   * Registers a viewer (LIVE-R36): at most 500 per output, but one already
   * known (a reload, a reconnect) replaces its old stream and is never refused.
   * Sends the newest state at once. False when it was refused as one too many.
   */
  watch(displayId: string, code: string, viewerId: string, viewer: Viewer, meta: { orgName: string; outputName: string }, screen = false): boolean {
    if (!this.viewers.add(displayId, viewerId, { viewer, code, screen })) return false;
    viewer.send({ type: 'meta', ...meta });
    viewer.send(this.shown(displayId, screen));
    this.viewers.changed();
    return true;
  }

  /** A viewer's stream ended. Only that stream: a newer one under the same id stays. */
  unwatch(displayId: string, viewerId: string, viewer: Viewer) {
    const isSavedScreen = () => this.store.query(`SELECT 1 FROM displays WHERE id = ? AND kind = 'screen'`, [displayId]).length > 0;
    if (this.viewers.remove(displayId, viewerId, viewer, isSavedScreen)) this.viewers.changed();
  }

  /**
   * Whether a picture may be shown to an output's viewers (LIVE-R32,
   * MEDIA-R10): the one on screen, and only if it is a picture of an item in
   * the presentation the session shows, or a page of a slide deck in it. The owner's report alone is not
   * enough: a changed client could otherwise name any picture of the library
   * and make it public through the output. A paired screen may also show the
   * overlay's picture (LIVE-R34), only if it is the picture of the overlay
   * the session's pointer has switched on; a public output never gets it.
   */
  showing(displayId: string, hash: string, screen = false): boolean {
    const row = this.boundRow(displayId);
    return !!row && mayShowImage(this.store, row, hash, screen);
  }

  /**
   * Whether a paired screen may stream a video (TODO.md "Video on the
   * outputs"): the one on its canvas, and only if it is the video of an item
   * in the presentation the session shows, as for a picture (LIVE-R32). A
   * public output never streams one; it shows the still.
   */
  showingVideo(displayId: string, hash: string): boolean {
    const row = this.boundRow(displayId);
    return !!row && mayShowVideo(this.store, row, hash);
  }

  /**
   * After an organisation's outputs changed: a deleted output, or one with a
   * new code, disconnects its viewers at once and loses its binding (spec 04 §7).
   */
  displaysChanged() {
    const codes = new Map((this.store.query('SELECT id, code FROM displays') as { id: string; code: string }[]).map((d) => [d.id, d.code]));
    this.store.query(`DELETE FROM live_bindings WHERE display_id NOT IN (SELECT id FROM displays UNION SELECT id FROM live_screens)`);
    // A temporary screen is no row in displays; one paired by QR may not be in live_screens yet either.
    this.viewers.closeIf((displayId, w, all) => !this.screen(displayId) && !all.every((v) => v.code === displayId) && codes.get(displayId) !== w.code);
    this.viewers.changed();
    this.broadcast();
  }

  private pushTo(displayId: string, ended = false) {
    const watching = this.viewers.of(displayId);
    if (!watching.length) return; // nobody watching: nothing to send (LIVE-R37)
    const events = new Map<boolean, WatchEvent>();
    for (const v of watching) {
      let e = events.get(v.screen);
      if (!e) events.set(v.screen, (e = ended && v.screen ? { type: 'canvas', canvas: null, now: this.now() } : this.shown(displayId, v.screen)));
      v.viewer.send(e);
    }
  }

  private row(id: string): SessionRow | undefined {
    return this.store.query('SELECT * FROM live_sessions WHERE id = ?', [id])[0] as SessionRow | undefined;
  }

  /**
   * The organisation's remote control policy changed: everyone sees at once
   * which sessions may be driven now. Commands read it on every message.
   */
  remoteControlChanged() {
    this.broadcast();
  }

  private policy() {
    const [r] = this.store.query('SELECT value FROM org_settings WHERE id = ?', [REMOTE_CONTROL_SETTING]) as { value: string }[];
    return remoteControlPolicy(r?.value);
  }

  /** The policy decides; the window's own toggle counts only when the policy leaves it to the presenter. */
  private remoteAllowed(r: SessionRow, policy = this.policy()): boolean {
    return remoteControlAllowed(policy, r.remote === 1);
  }

  private ownerOnline(id: string): boolean {
    return this.sockets().some((o) => o.owns.includes(id));
  }

  /**
   * Every session, after ending those whose owner has been gone too long
   * (LIVE-R50) or has not reported for SESSION_IDLE_MS (LIVE-R42), and letting
   * go of idle screens (LIVE-R43). An owner still online brings its session
   * back with its next report.
   */
  sessions(): LiveSessionInfo[] {
    this.releaseIdleScreens();
    const online = new Set(this.sockets().flatMap((o) => o.owns));
    const rows = this.store.query('SELECT * FROM live_sessions ORDER BY id') as unknown as SessionRow[];
    const policy = this.policy();
    const out: LiveSessionInfo[] = [];
    for (const r of rows) {
      if (r.owner_seen_at < this.now() - (online.has(r.id) ? SESSION_IDLE_MS : ABANDONED_SESSION_MS)) {
        this.endSession(r.id, true);
        continue;
      }
      const outputs = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ? ORDER BY display_id', [r.id]) as { display_id: string }[]).map(
        (b) => ({ id: b.display_id, viewers: this.viewers.count(b.display_id) }),
      );
      out.push(sessionInfoOf(r, outputs, this.remoteAllowed(r, policy), online.has(r.id)));
    }
    return out;
  }

  private snapshot(): string {
    const sessions = this.sessions();
    const online = this.viewers.onlineIds();
    const screens = this.store.query('SELECT id, n FROM live_screens ORDER BY n') as unknown as LiveScreen[];
    return JSON.stringify({ type: 'sessions', sessions, online, screens } satisfies LiveServerMessage);
  }

  private broadcast() {
    const msg = this.snapshot();
    for (const s of this.sockets()) {
      try {
        s.send(msg);
      } catch {
        // A socket that is closing: its close is on its way.
      }
    }
    this.scheduleIdleCheck();
  }
}

function reply(s: LiveSocket, m: LiveServerMessage) {
  s.send(JSON.stringify(m));
}



