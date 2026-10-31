import { canvasOfPublicSlide, type Canvas, type LiveOwnState, type LiveSessionInfo, type LiveVideoState, type PublicSlide } from '@gp/core';

// The live hub's server-only tables (spec 04), and how a session's row reads.

export interface LiveStore {
  query(sql: string, params?: unknown[]): Record<string, unknown>[];
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS live_sessions (
     id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, presentation_id TEXT NOT NULL,
     presentation_name TEXT NOT NULL, device_name TEXT NOT NULL, remote INTEGER NOT NULL,
     pointer TEXT NOT NULL, owner_seen_at INTEGER NOT NULL, slide TEXT, audio TEXT, canvas TEXT, video TEXT)`,
  // Which session an output sends from: at most one (LIVE-R23); `active_at`, its session's last slide change since it was bound (LIVE-R43).
  `CREATE TABLE IF NOT EXISTS live_bindings (display_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, active_at INTEGER NOT NULL)`,
  // Temporary screens paired with the organisation (spec 04 §5), each for the session that paired it.
  `CREATE TABLE IF NOT EXISTS live_screens (id TEXT PRIMARY KEY NOT NULL, n INTEGER NOT NULL, session_id TEXT NOT NULL)`,
  // Saved screens let go for idling (LIVE-R43): not bound to that session again until its owner has switched them off.
  `CREATE TABLE IF NOT EXISTS live_released (display_id TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY (display_id, session_id))`,
];

/** Makes the tables; a table made before audio, the canvas or video is simply made again, as sessions are short-lived. */
export function prepareLiveTables(store: LiveStore): void {
  for (const d of DDL) store.query(d);
  if (!(store.query(`SELECT 1 FROM pragma_table_info('live_sessions') WHERE name = 'video'`).length)) {
    store.query('DROP TABLE live_sessions');
    store.query(DDL[0]!);
  }
  if (!store.query(`SELECT 1 FROM pragma_table_info('live_bindings') WHERE name = 'active_at'`).length) {
    store.query('DROP TABLE live_bindings');
    store.query(DDL[1]!);
  }
}

/** A session as `live_sessions` holds it. */
export interface SessionRow {
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
  video: string | null;
  canvas: string | null;
}

/** The public slide a session shows (LIVE-R32); null without a session, or black. */
export function slideOf(row: SessionRow | undefined): PublicSlide | null {
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
export function canvasOf(row: SessionRow | undefined): Canvas | null {
  if (row?.canvas) return JSON.parse(row.canvas) as Canvas;
  const slide = slideOf(row);
  return slide ? canvasOfPublicSlide(slide) : null;
}

/** Writes the owner's report as the session's row; `slide` is the report's slide as JSON, as the caller compares it. */
export function saveSession(store: LiveStore, ownerUserId: string, state: LiveOwnState, slide: string | null, now: number): void {
  store.query(
    `INSERT INTO live_sessions (id, owner_user_id, presentation_id, presentation_name, device_name, remote, pointer, owner_seen_at, slide, audio, canvas, video)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET presentation_id = excluded.presentation_id, presentation_name = excluded.presentation_name,
       device_name = excluded.device_name, remote = excluded.remote, pointer = excluded.pointer, owner_seen_at = excluded.owner_seen_at,
       slide = excluded.slide, audio = excluded.audio, canvas = excluded.canvas, video = excluded.video`,
    [
      state.sessionId,
      ownerUserId,
      state.presentationId,
      state.presentationName,
      state.deviceName,
      state.remote ? 1 : 0,
      JSON.stringify(state.pointer),
      now,
      slide,
      state.audio ? JSON.stringify(state.audio) : null,
      state.canvas ? JSON.stringify(stampVideo(state.canvas, now)) : null,
      state.video ? JSON.stringify(state.video) : null,
    ],
  );
}

/** A session as the operators' windows list it. */
export function sessionInfoOf(r: SessionRow, outputs: LiveSessionInfo['outputs'], remote: boolean, ownerOnline: boolean): LiveSessionInfo {
  return {
    id: r.id,
    presentationId: r.presentation_id,
    presentationName: r.presentation_name,
    deviceName: r.device_name,
    remote,
    ownerOnline,
    pointer: JSON.parse(r.pointer) as LiveSessionInfo['pointer'],
    outputs,
    audio: r.audio ? (JSON.parse(r.audio) as LiveSessionInfo['audio']) : null,
    video: r.video ? (JSON.parse(r.video) as LiveVideoState) : null,
  };
}
