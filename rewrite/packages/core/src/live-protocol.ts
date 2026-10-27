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
}

export type LiveServerMessage =
  | { type: 'sessions'; sessions: LiveSessionInfo[] }
  /** To the owner only: a controller's command, to apply if it still makes sense (LIVE-R49). */
  | { type: 'command'; sessionId: string; change: LiveChange }
  | { type: 'error'; error: 'invalid-message' | 'not-owner' | 'not-found' | 'remote-off' | 'owner-offline' | 'forbidden' };

/** A session whose owner has been gone this long is ended (LIVE-R50's reaper). */
export const ABANDONED_SESSION_MS = 2 * 60 * 60 * 1000;
/** The largest message the server reads. */
export const LIVE_MESSAGE_MAX = 4096;

/** Reconnect delays (LIVE-R51): 0, 2, 5, 10 s, then every 30 s, forever. */
export function liveReconnectDelay(attempt: number): number {
  return [0, 2000, 5000, 10_000][attempt] ?? 30_000;
}
