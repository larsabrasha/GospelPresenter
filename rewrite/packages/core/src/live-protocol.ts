import { z } from 'zod';

// Remote control (spec 04 §2, ADR 0004 as carried over by ADR 0007 decision 4).
// The window that presents owns its session and drives its own outputs from
// local state; only the selection travels. Over one WebSocket per window
// (`/api/live/socket`), the owner reports its whole state, and a controller
// sends absolute commands that the server forwards to the owner. The owner's
// next report settles what is showing. Losing the owner freezes the session.

const id = z.string().min(1).max(100);

/** The selection a controller asks for: absolute, never "next". */
export const liveChangeSchema = z.object({
  itemId: id.nullable(),
  partIndex: z.number().int().min(0).max(10_000),
  black: z.boolean(),
});
export type LiveChange = z.infer<typeof liveChangeSchema>;

/**
 * What a public output shows (spec 04 §6): the slide as data, never HTML
 * (D25), with the theme by id. The owner builds it from its own copy, so
 * viewers see exactly what its projector shows. Null: the waiting screen
 * (LIVE-R14: black, or nothing selected).
 */
export const publicSlideSchema = z.object({
  kind: z.enum(['song', 'bible', 'media']),
  text: z.string().max(5000),
  verses: z.array(z.object({ n: z.number().int().nullable(), t: z.string().max(2000) })).max(500).nullable(),
  /** A media slide's picture: the hash of its `full` blob, served at `/api/watch/{code}/image/{hash}` while it is live. */
  image: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  credits: z.string().max(500).nullable(),
  themeId: z.string().max(100),
});
export type PublicSlide = z.infer<typeof publicSlideSchema>;

/** What the owner reports, whole, on connect, on every reconnect and on every change (LIVE-R47). */
export const liveOwnStateSchema = z.object({
  sessionId: id,
  presentationId: id,
  presentationName: z.string().max(200),
  /** The presenting device, as controllers see it in a picker. */
  deviceName: z.string().max(100),
  /** "Tillåt fjärrstyrning" (LIVE-R38, R39). */
  remote: z.boolean(),
  pointer: liveChangeSchema.extend({ rev: z.number().int().min(0) }),
  /** The public outputs this session sends to (LIVE-R23: one session per output). */
  outputs: z.array(id).max(50).default([]),
  /** Outputs another session sends to, which this one takes over ("Ta över"). */
  takeOver: z.array(id).max(50).default([]),
  /** What the outputs show; only sent while there are outputs. */
  slide: publicSlideSchema.nullable().default(null),
});
export type LiveOwnState = z.infer<typeof liveOwnStateSchema>;

export const liveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('own'), state: liveOwnStateSchema }),
  /** The owner stops; or anyone ends a session whose owner is gone (LIVE-R50). */
  z.object({ type: z.literal('end'), sessionId: id }),
  z.object({ type: z.literal('set'), sessionId: id, change: liveChangeSchema }),
]);
export type LiveClientMessage = z.infer<typeof liveClientMessageSchema>;

/** A session as every member of the organisation sees it. */
export interface LiveSessionInfo {
  id: string;
  presentationId: string;
  presentationName: string;
  deviceName: string;
  remote: boolean;
  /** False while the owner is disconnected: the session is frozen and cannot be driven. */
  ownerOnline: boolean;
  /** What the owner last reported. */
  pointer: LiveOwnState['pointer'];
  /** The public outputs it sends to, and how many are watching each. */
  outputs: { id: string; viewers: number }[];
}

export type LiveServerMessage =
  | { type: 'sessions'; sessions: LiveSessionInfo[] }
  /** To the owner only: a controller's command, to apply if it still makes sense (LIVE-R49). */
  | { type: 'command'; sessionId: string; change: LiveChange }
  | { type: 'error'; error: 'invalid-message' | 'not-owner' | 'not-found' | 'remote-off' | 'owner-offline' | 'forbidden' | 'output-taken' };

/** A session whose owner has been gone this long is ended (LIVE-R50's reaper). */
export const ABANDONED_SESSION_MS = 2 * 60 * 60 * 1000;
/** The largest message the server reads. */
export const LIVE_MESSAGE_MAX = 4096;

/** Reconnect delays (LIVE-R51): 0, 2, 5, 10 s, then every 30 s, forever. */
export function liveReconnectDelay(attempt: number): number {
  return [0, 2000, 5000, 10_000][attempt] ?? 30_000;
}

/** How many may watch one public output at once (LIVE-R36). */
export const MAX_VIEWERS = 500;

/** What a public output's stream sends (LIVE-R35): the newest state only, never a backlog. */
export type WatchEvent =
  | { type: 'meta'; orgName: string; outputName: string }
  | { type: 'slide'; slide: PublicSlide }
  | { type: 'idle' }
  | { type: 'full' };
