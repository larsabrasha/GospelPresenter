import type { Role } from '@gp/core';

/** Who is signed in, as the database worker needs it (see auth/session.ts). */
export interface Session {
  userId: string;
  orgId: string;
  /** The role the server last gave; drives optimistic checks only. The server checks again. */
  role: Role;
  /** The session's bearer token. */
  token: string;
  /** The paired-device token, on a desktop host's LAN. */
  device: string | null;
  /** 'memory' keeps the database in memory even where OPFS exists (development and tests). */
  storage?: 'memory';
  /** A desktop host's own window: it keeps every Bible text, whatever was chosen (docs/bibles-and-themes.md, "Bibles"). */
  keepsEveryBible?: true;
}

export interface DbStatus {
  /** 'opfs', or 'memory' with the reason OPFS was not available. */
  storage: string;
  /** The poke socket is open, so changes arrive within a second. */
  connected: boolean;
  pending: number;
  updateRequired: boolean;
  /** The server refused this device's credentials: sync has stopped and local edits wait (SYNC-A15). */
  authError: 'unauthenticated' | 'not-a-member' | 'device-not-paired' | null;
  /** Mutations the server refused, newest last. */
  rejected: { id: number; error: string }[];
}

export type DbCall =
  | { op: 'open'; session: Session }
  | { op: 'mutate'; name: string; args: unknown }
  | { op: 'query'; sql: string; params: unknown[] }
  | { op: 'status' }
  /** Adds a processed picture to the library (spec 05 "Media"): keep its blobs here, then `addImage`, uploaded before it is pushed. */
  | { op: 'addImage'; image: ImageImport }
  /** Adds an audio file to the library, as it was picked (MEDIA-R5): kept here, uploaded before `addAudio` is pushed. */
  | { op: 'addAudio'; audio: AudioImport }
  /** Imports a Bible zip (spec 05): parse and store here, then `importBible`, uploaded before it is pushed. */
  | { op: 'importBible'; data: Uint8Array }
  | { op: 'syncNow' }
  /**
   * A presentation is open on a page (editor, live, remote control): fetch
   * what it needs now (docs/media-and-files.md, "Which files a device keeps"); `audio` false
   * for a remote control, which never plays. `key` names the page, for `closeMedia`.
   */
  | { op: 'openMedia'; key: string; presentationId: string; audio: boolean }
  | { op: 'closeMedia'; key: string }
  /** Keeps a presentation's files on this device whatever its date ("Tillgänglig offline"), or stops. */
  | { op: 'setPinned'; presentationId: string; on: boolean }
  /** "Gör tillgänglig offline" (true: false if the text could not be downloaded) or "Ta bort den nedladdade kopian". */
  | { op: 'keepBible'; bibleId: string; on: boolean }
  /** A translation's text from the server, checked and not stored: for one this device does not keep. Null if it cannot be had. */
  | { op: 'fetchBibleText'; hash: string };

export type DbMessage =
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'changed' }
  | { type: 'status'; status: DbStatus };

export interface BibleImportResult {
  name: string;
  abbreviation: string;
  verses: number;
  /** A translation with this abbreviation was there already and has been replaced (BIBLE-R5). */
  replaced: boolean;
  /** The server could not be reached: the translation is here, and goes to the server once it can be. */
  queued: boolean;
}

/** A picture the page has fitted and re-encoded (`media/process.ts`), ready to be kept and synced. */
export interface ImageImport {
  id: string;
  fileName: string;
  contentType: 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  full: Uint8Array;
  thumb: Uint8Array;
}

export interface AudioImport {
  id: string;
  fileName: string;
  /** What its bytes say it is (`sniffAudio`), not what the browser guessed. */
  contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/mp4' | 'audio/webm' | 'audio/x-m4a';
  bytes: Uint8Array;
}
