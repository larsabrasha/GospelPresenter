import {
  ABANDONED_SESSION_MS,
  can,
  canvasOfPublicSlide,
  LIVE_MESSAGE_MAX,
  liveClientMessageSchema,
  MAX_VIEWERS,
  REMOTE_CONTROL_SETTING,
  remoteControlAllowed,
  remoteControlPolicy,
  ITEM_IMAGES_SQL,
  SLIDE_PAGES_SQL,
  type Canvas,
  type LiveOwnState,
  type LiveScreen,
  type LiveServerMessage,
  type LiveSessionInfo,
  type PublicSlide,
  type Role,
  type WatchEvent,
} from '@gp/core';

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

export interface LiveStore {
  query(sql: string, params?: unknown[]): Record<string, unknown>[];
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS live_sessions (
     id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, presentation_id TEXT NOT NULL,
     presentation_name TEXT NOT NULL, device_name TEXT NOT NULL, remote INTEGER NOT NULL,
     pointer TEXT NOT NULL, owner_seen_at INTEGER NOT NULL, slide TEXT, audio TEXT, canvas TEXT)`,
  // Which session an output sends from: at most one (LIVE-R23).
  `CREATE TABLE IF NOT EXISTS live_bindings (display_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL)`,
  // Temporary screens paired with the organisation (spec 04 §5), each for the session that paired it.
  `CREATE TABLE IF NOT EXISTS live_screens (id TEXT PRIMARY KEY NOT NULL, n INTEGER NOT NULL, session_id TEXT NOT NULL)`,
];

/** One public viewer's stream (LIVE-R35): it only ever needs the newest event. */
export interface Viewer {
  send(e: WatchEvent): void;
  close(): void;
}

/**
 * How long a saved screen whose stream dropped stays switched on: a TV whose
 * Wi-Fi blinks reconnects within it; a page that closed is off after it (LIVE-A20).
 */
export const SCREEN_GRACE_MS = 15_000;

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
  audio: string | null;
  canvas: string | null;
}

/**
 * Callers serialise every call with the organisation's other writes (its
 * queue), so a live write never lands inside a mutation's transaction.
 */
export class LiveHub {
  /** Public viewers, by output, by viewer id. In memory: a viewer reconnects if the process restarts. */
  private viewers = new Map<string, Map<string, { viewer: Viewer; code: string; screen: boolean }>>();
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private countDue = false;
  /**
   * Saved screens whose last stream dropped, waiting out SCREEN_GRACE_MS. The
   * entry is its own mark: a timer whose entry was replaced (the screen came
   * back and dropped again) does nothing.
   */
  private dropped = new Map<string, { timer: unknown }>();
  /**
   * Sockets that have closed. A runtime may go on listing one for a while (a
   * Durable Object during and after webSocketClose), so it is left out until
   * the runtime stops listing it.
   */
  private gone = new Set<string>();

  constructor(
    private store: LiveStore,
    private allSockets: () => LiveSocket[],
    private now: () => number = Date.now,
    /** Temporary screens a session let go, for the global tables to forget (`ScreenRegistry.release`). */
    private released: (ids: string[]) => void = () => undefined,
    /** Runs `fn` after `ms`, in the organisation's queue like every other call (the runtime wraps it). */
    private later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {
    for (const d of DDL) store.query(d);
    // A table made before audio or the canvas: sessions are short-lived, so it is simply made again.
    if (!(store.query(`SELECT 1 FROM pragma_table_info('live_sessions') WHERE name = 'canvas'`).length)) {
      store.query('DROP TABLE live_sessions');
      store.query(DDL[0]!);
    }
  }

  /** Stops the viewer-count timer: the database is about to close. */
  dispose() {
    for (const d of this.dropped.values()) clearTimeout(d.timer as ReturnType<typeof setTimeout>);
    this.dropped.clear();
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = null;
    this.countDue = false;
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
    this.store.query(
      `INSERT INTO live_sessions (id, owner_user_id, presentation_id, presentation_name, device_name, remote, pointer, owner_seen_at, slide, audio, canvas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET presentation_id = excluded.presentation_id, presentation_name = excluded.presentation_name,
         device_name = excluded.device_name, remote = excluded.remote, pointer = excluded.pointer, owner_seen_at = excluded.owner_seen_at,
         slide = excluded.slide, audio = excluded.audio, canvas = excluded.canvas`,
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
        state.audio ? JSON.stringify(state.audio) : null,
        state.canvas ? JSON.stringify(stampVideo(state.canvas, this.now())) : null,
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
    const displays = this.store.query('SELECT id, kind FROM displays') as { id: string; kind: string }[];
    // A saved screen only while its page is open (LIVE-A21); a temporary screen only for the session that paired it.
    const known = new Set([
      ...displays.filter((d) => d.kind !== 'screen' || this.screenOnline(d.id)).map((d) => d.id),
      ...(this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [state.sessionId]) as { id: string }[]).map((x) => x.id),
    ]);
    const mine = (this.store.query('SELECT display_id FROM live_bindings WHERE session_id = ?', [state.sessionId]) as { display_id: string }[]).map((b) => b.display_id);
    for (const id of mine) touched.add(id);
    const dropped = mine.filter((d) => !state.outputs.includes(d) || !known.has(d));
    for (const id of dropped) this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [id]);
    // A temporary screen switched off (✕) is let go: its TV shows a new code.
    this.releaseScreens((this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [state.sessionId]) as { id: string }[]).map((x) => x.id).filter((id) => dropped.includes(id)));
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
    // Its temporary screens go with it (LIVE-R24: the screen disconnects itself).
    this.releaseScreens((this.store.query('SELECT id FROM live_screens WHERE session_id = ?', [id]) as { id: string }[]).map((x) => x.id));
    // A saved screen whose session ended draws black, not its name (Display.razor keeps the pairing when the
    // presentation stops); its name comes back when its page is opened again.
    for (const d of bound) this.pushTo(d, true);
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
      const set = this.viewers.get(id);
      for (const v of set?.values() ?? []) {
        v.viewer.send({ type: 'unpaired' });
        v.viewer.close();
      }
      this.viewers.delete(id);
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

  private boundRow(displayId: string): Row | undefined {
    const [b] = this.store.query('SELECT session_id FROM live_bindings WHERE display_id = ?', [displayId]) as { session_id: string }[];
    return b && this.row(b.session_id);
  }

  /**
   * Registers a viewer (LIVE-R36): at most 500 per output, but one already
   * known (a reload, a reconnect) replaces its old stream and is never refused.
   * Sends the newest state at once. False when it was refused as one too many.
   */
  watch(displayId: string, code: string, viewerId: string, viewer: Viewer, meta: { orgName: string; outputName: string }, screen = false): boolean {
    let set = this.viewers.get(displayId);
    if (!set) this.viewers.set(displayId, (set = new Map()));
    const old = set.get(viewerId);
    if (!old && set.size >= MAX_VIEWERS) {
      viewer.send({ type: 'full' });
      viewer.close();
      return false;
    }
    set.set(viewerId, { viewer, code, screen });
    const pending = this.dropped.get(displayId);
    if (pending) clearTimeout(pending.timer as ReturnType<typeof setTimeout>); // back within the grace
    this.dropped.delete(displayId);
    old?.viewer.close();
    viewer.send({ type: 'meta', ...meta });
    viewer.send(this.shown(displayId, screen));
    this.countsChanged();
    return true;
  }

  /** A viewer's stream ended. Only that stream: a newer one under the same id stays. */
  unwatch(displayId: string, viewerId: string, viewer: Viewer) {
    const set = this.viewers.get(displayId);
    if (set?.get(viewerId)?.viewer !== viewer) return;
    set.delete(viewerId);
    // A saved screen whose page closed is switched off (LIVE-R24, LIVE-A20), once it has not come back for SCREEN_GRACE_MS.
    if (!set.size && !this.dropped.has(displayId) && this.store.query(`SELECT 1 FROM displays WHERE id = ? AND kind = 'screen'`, [displayId]).length) {
      const mark: { timer: unknown } = { timer: null };
      this.dropped.set(displayId, mark);
      mark.timer = this.later(() => {
        if (this.dropped.get(displayId) !== mark) return;
        this.dropped.delete(displayId);
        if (this.viewerCount(displayId) > 0) return;
        this.store.query('DELETE FROM live_bindings WHERE display_id = ?', [displayId]);
        this.broadcast();
      }, SCREEN_GRACE_MS);
    }
    this.countsChanged();
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
    if (!row) return false;
    const shown = screen ? canvasOf(row) : null;
    const slideImage = screen ? shown?.slide?.image : slideOf(row)?.image;
    if (
      slideImage === hash &&
      this.store.query(
        `SELECT 1 FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id
         WHERE p.presentation_id = ? AND i.full_hash = ?
         UNION ALL
         SELECT 1 FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ? AND s.full_hash = ?
         UNION ALL
         SELECT 1 FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id = ? AND v.still_hash = ?`,
        [row.presentation_id, hash, row.presentation_id, hash, row.presentation_id, hash],
      ).length > 0
    ) {
      return true;
    }
    if (!screen || shown?.overlay?.image !== hash) return false;
    const overlayId = (JSON.parse(row.pointer) as LiveOwnState['pointer']).overlayId;
    return (
      !!overlayId &&
      this.store.query('SELECT 1 FROM overlays o JOIN images i ON i.id = o.image_id WHERE o.id = ? AND i.full_hash = ?', [overlayId, hash]).length > 0
    );
  }

  /**
   * Whether a paired screen may stream a video (TODO.md "Video on the
   * outputs"): the one on its canvas, and only if it is the video of an item
   * in the presentation the session shows, as for a picture (LIVE-R32). A
   * public output never streams one; it shows the still.
   */
  showingVideo(displayId: string, hash: string): boolean {
    const row = this.boundRow(displayId);
    if (!row || canvasOf(row)?.slide?.video?.hash !== hash) return false;
    return (
      this.store.query(`SELECT 1 FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id = ? AND v.hash = ?`, [
        row.presentation_id,
        hash,
      ]).length > 0
    );
  }

  /**
   * After an organisation's outputs changed: a deleted output, or one with a
   * new code, disconnects its viewers at once and loses its binding (spec 04 §7).
   */
  displaysChanged() {
    const codes = new Map((this.store.query('SELECT id, code FROM displays') as { id: string; code: string }[]).map((d) => [d.id, d.code]));
    this.store.query(`DELETE FROM live_bindings WHERE display_id NOT IN (SELECT id FROM displays UNION SELECT id FROM live_screens)`);
    for (const [displayId, set] of this.viewers) {
      // A temporary screen is no row in displays; one paired by QR may not be in live_screens yet either.
      if (this.screen(displayId) || [...set.values()].every((v) => v.code === displayId)) continue;
      for (const [viewerId, v] of set) {
        if (codes.get(displayId) === v.code) continue;
        set.delete(viewerId);
        v.viewer.close();
      }
    }
    this.countsChanged();
    this.broadcast();
  }

  private pushTo(displayId: string, ended = false) {
    const set = this.viewers.get(displayId);
    if (!set?.size) return; // nobody watching: nothing to send (LIVE-R37)
    const events = new Map<boolean, WatchEvent>();
    for (const v of set.values()) {
      let e = events.get(v.screen);
      if (!e) events.set(v.screen, (e = ended && v.screen ? { type: 'canvas', canvas: null, now: this.now() } : this.shown(displayId, v.screen)));
      v.viewer.send(e);
    }
  }

  /** A saved screen is online while a page follows it, and for SCREEN_GRACE_MS after the last one dropped. */
  private screenOnline(displayId: string): boolean {
    return this.viewerCount(displayId) > 0 || this.dropped.has(displayId);
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
  private remoteAllowed(r: Row, policy = this.policy()): boolean {
    return remoteControlAllowed(policy, r.remote === 1);
  }

  private ownerOnline(id: string): boolean {
    return this.sockets().some((o) => o.owns.includes(id));
  }

  /** Every session, after ending those whose owner has been gone too long (LIVE-R50). */
  sessions(): LiveSessionInfo[] {
    const online = new Set(this.sockets().flatMap((o) => o.owns));
    const rows = this.store.query('SELECT * FROM live_sessions ORDER BY id') as unknown as Row[];
    const policy = this.policy();
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
        remote: this.remoteAllowed(r, policy),
        ownerOnline: online.has(r.id),
        pointer: JSON.parse(r.pointer) as LiveSessionInfo['pointer'],
        outputs,
        audio: r.audio ? (JSON.parse(r.audio) as LiveSessionInfo['audio']) : null,
      });
    }
    return out;
  }

  private snapshot(): string {
    const sessions = this.sessions();
    const online = [...new Set([...this.viewers].filter(([, set]) => set.size > 0).map(([id]) => id).concat([...this.dropped.keys()]))].toSorted();
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
  }
}

function reply(s: LiveSocket, m: LiveServerMessage) {
  s.send(JSON.stringify(m));
}

/** The public slide a session shows (LIVE-R32); null without a session, or black. */
function slideOf(row: Row | undefined): PublicSlide | null {
  return row?.slide ? (JSON.parse(row.slide) as PublicSlide) : null;
}

/**
 * The canvas with its video's moment on the server's clock: the owner's
 * report says where the video was as it was sent, and a screen whose clock
 * is wrong still follows, since every canvas event carries the server's time.
 */
function stampVideo(canvas: Canvas, now: number): Canvas {
  const video = canvas.slide?.video;
  return video ? { ...canvas, slide: { ...canvas.slide!, video: { ...video, at: now } } } : canvas;
}

/** The canvas a session's paired screens draw (spec 04 §5); from an owner that reports none (an older build), the public slide's. */
function canvasOf(row: Row | undefined): Canvas | null {
  if (row?.canvas) return JSON.parse(row.canvas) as Canvas;
  const slide = slideOf(row);
  return slide ? canvasOfPublicSlide(slide) : null;
}
