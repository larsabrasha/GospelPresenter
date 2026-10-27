import { z } from 'zod';
import { OVERLAY_LIMITS } from './live.ts';

// Remote control (spec 04 §2, ADR 0004 as carried over by ADR 0007 decision 4).
// The window that presents owns its session and drives its own outputs from
// local state; only the selection travels. Over one WebSocket per window
// (`/api/live/socket`), the owner reports its whole state, and a controller
// sends absolute commands that the server forwards to the owner. The owner's
// next report settles what is showing. Losing the owner freezes the session.

const id = z.string().min(1).max(100);

/**
 * The selection a controller asks for: absolute, never "next". `overlayId`
 * is there only when the controller toggles an overlay; without it, the
 * owner applies the item's own overlay (`applyLiveChange`).
 */
export const liveChangeSchema = z.object({
  itemId: id.nullable(),
  partIndex: z.number().int().min(0).max(10_000),
  black: z.boolean(),
  overlayId: id.nullable().optional(),
});
export type LiveChange = z.infer<typeof liveChangeSchema>;

/**
 * What a public output shows (spec 04 §6): the slide as data, never HTML
 * (D25), with the theme by id. The owner builds it from its own copy, so
 * viewers see exactly what its projector shows. Null: the waiting screen
 * (LIVE-R14: black, or nothing selected).
 */
/** What one public slide may hold; `toPublicSlide` keeps a slide within it, so a report is never refused for its size. */
export const PUBLIC_SLIDE_LIMITS = { text: 5000, segments: 100, credits: 500 } as const;

export const publicSlideSchema = z.object({
  kind: z.enum(['song', 'bible', 'media']),
  text: z.string().max(PUBLIC_SLIDE_LIMITS.text),
  verses: z
    .array(z.object({ n: z.number().int().nullable(), t: z.string().max(PUBLIC_SLIDE_LIMITS.text) }))
    .max(PUBLIC_SLIDE_LIMITS.segments)
    .refine((v) => v.reduce((n, seg) => n + seg.t.length, 0) <= PUBLIC_SLIDE_LIMITS.text, 'verses longer than a slide may be')
    .nullable(),
  /** A media slide's picture: the hash of its `full` blob, served at `/api/watch/{code}/image/{hash}` while it is live. */
  image: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  credits: z.string().max(PUBLIC_SLIDE_LIMITS.credits).nullable(),
  themeId: z.string().max(100),
  /** The overlay's text, if one is shown (spec 04 §6). Its picture is not sent: a public output shows text only. */
  overlay: z.string().max(OVERLAY_LIMITS.content).nullable().default(null),
});
export type PublicSlide = z.infer<typeof publicSlideSchema>;

/**
 * A slide as a public output gets it, cut to PUBLIC_SLIDE_LIMITS. A song part
 * is at most 5 000 characters already; a Bible slide of unusually long verses
 * is the case this guards against.
 */
export function toPublicSlide(slide: Pick<PublicSlide, 'kind' | 'text' | 'verses' | 'image' | 'credits'>, themeId: string, overlay: string | null = null): PublicSlide {
  let budget: number = PUBLIC_SLIDE_LIMITS.text;
  const verses = slide.verses
    ? slide.verses.slice(0, PUBLIC_SLIDE_LIMITS.segments).flatMap((seg) => {
        if (budget <= 0) return [];
        const t = seg.t.slice(0, budget);
        budget -= t.length;
        return [{ n: seg.n, t }];
      })
    : null;
  return {
    kind: slide.kind,
    text: slide.text.slice(0, PUBLIC_SLIDE_LIMITS.text),
    verses,
    image: slide.image,
    credits: slide.credits?.slice(0, PUBLIC_SLIDE_LIMITS.credits) ?? null,
    themeId,
    overlay: overlay?.slice(0, OVERLAY_LIMITS.content) ?? null,
  };
}

/**
 * The session's audio (spec 04 §1b): the audio item the presenting computer
 * plays, and where it is. Audio plays only there; controllers mirror it.
 */
export const liveAudioSchema = z.object({
  itemId: id,
  playing: z.boolean(),
  /** Seconds into the file when this was reported. */
  position: z.number().min(0).max(24 * 3600),
  duration: z.number().min(0).max(24 * 3600).nullable(),
  /** Fading out (Tona ut): five seconds, then it stops and rewinds. */
  fading: z.boolean(),
});
export type LiveAudio = z.infer<typeof liveAudioSchema>;

/** What a controller asks the presenting computer to do with its audio (spec 04 §1b). */
export const audioCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), itemId: id }),
  z.object({ action: z.literal('pause'), itemId: id }),
  z.object({ action: z.literal('seek'), itemId: id, position: z.number().min(0).max(24 * 3600) }),
  z.object({ action: z.literal('fade'), itemId: id }),
]);
export type AudioCommand = z.infer<typeof audioCommandSchema>;

/** What the owner reports, whole, on connect, on every reconnect and on every change (LIVE-R47). */
export const liveOwnStateSchema = z.object({
  sessionId: id,
  presentationId: id,
  presentationName: z.string().max(200),
  /** The presenting device, as controllers see it in a picker. */
  deviceName: z.string().max(100),
  /** "Tillåt fjärrstyrning" (LIVE-R38, R39). */
  remote: z.boolean(),
  pointer: liveChangeSchema.extend({ overlayId: id.nullable().default(null), rev: z.number().int().min(0) }),
  /** The public outputs this session sends to (LIVE-R23: one session per output). */
  outputs: z.array(id).max(50).default([]),
  /** Outputs another session sends to, which this one takes over ("Ta över"). */
  takeOver: z.array(id).max(50).default([]),
  /** What the outputs show; only sent while there are outputs. */
  slide: publicSlideSchema.nullable().default(null),
  /** The audio item it plays, if any. */
  audio: liveAudioSchema.nullable().default(null),
});
export type LiveOwnState = z.infer<typeof liveOwnStateSchema>;

export const liveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('own'), state: liveOwnStateSchema }),
  /** The owner stops; or anyone ends a session whose owner is gone (LIVE-R50). */
  z.object({ type: z.literal('end'), sessionId: id }),
  z.object({ type: z.literal('set'), sessionId: id, change: liveChangeSchema }),
  /** A controller's audio command, relayed to the owner like `set` (spec 04 §1b). */
  z.object({ type: z.literal('audio'), sessionId: id, command: audioCommandSchema }),
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
  /** Its audio, as the owner last reported it. */
  audio: LiveAudio | null;
}

export type LiveServerMessage =
  | { type: 'sessions'; sessions: LiveSessionInfo[] }
  /** To the owner only: a controller's command, to apply if it still makes sense (LIVE-R49). */
  | { type: 'command'; sessionId: string; change: LiveChange }
  /** To the owner only: a controller's audio command. */
  | { type: 'audio-command'; sessionId: string; command: AudioCommand }
  | { type: 'error'; error: 'invalid-message' | 'not-owner' | 'not-found' | 'remote-off' | 'owner-offline' | 'forbidden' | 'output-taken' };

/** A session whose owner has been gone this long is ended (LIVE-R50's reaper). */
export const ABANDONED_SESSION_MS = 2 * 60 * 60 * 1000;
/**
 * The largest message the server reads: room for the largest valid report,
 * even if every character of its slide needs a six-character JSON escape (a
 * test builds that report and checks it fits).
 */
export const LIVE_MESSAGE_MAX = 96 * 1024;

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
