import { z } from 'zod';
import { customPageSchema, type CustomPage } from './custom-slides.ts';
import { OVERLAY_LIMITS } from './live.ts';
import { VIDEO_CODECS, VIDEO_TYPES } from './video.ts';

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
  /** The overlay's texts, if one is shown (spec 04 §6). Its pictures and shapes are not sent: a public output shows text only. */
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
 * A video on the outputs and where it is (TODO.md "Video on the outputs"):
 * which video, playing or not, and its position at a moment. A paired screen
 * streams it muted and works out where to be from these; the presenting
 * computer plays the sound. `at` is the server's clock once the hub has the
 * report (it stamps it on receipt), so a screen with a wrong clock still
 * follows: each canvas event carries the server's time as it is sent.
 */
export const liveVideoSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  type: z.enum(VIDEO_TYPES),
  codec: z.enum(VIDEO_CODECS),
  playing: z.boolean(),
  /** Seconds into the video at `at`. */
  position: z.number().min(0).max(24 * 3600),
  /** Milliseconds since the epoch. */
  at: z.number().int().min(0),
});
export type LiveVideo = z.infer<typeof liveVideoSchema>;

/**
 * What a paired screen draws (spec 04 §5: "same rendering as /live"): the
 * projector's canvas, so the slide, its theme and the overlay's page with its
 * pictures. A paired screen is bound to the session by an operator, like the
 * projector, so it gets what the projector draws; a public output gets the
 * PublicSlide only. The slide is cut to PUBLIC_SLIDE_LIMITS like the public
 * one, and a page to CANVAS_PAGE_MAX. `slide` null with an overlay: the overlay
 * on a black stage, as the projector draws it with nothing selected. The whole
 * canvas null: black.
 */
export const canvasSchema = z.object({
  /**
   * A video slide carries its video and where it is; its `image` is the still, for a screen that cannot play it. A
   * slideshow's slide carries its page, its pictures' blobs served at the screen's `/image/{hash}` while it is shown.
   */
  slide: publicSlideSchema
    .pick({ kind: true, text: true, verses: true, image: true, credits: true })
    .extend({ video: liveVideoSchema.nullable().optional(), custom: customPageSchema.optional() })
    .nullable(),
  themeId: z.string().max(100),
  /** The overlay switched on (docs/custom-slides.md): its page, drawn above the slide, its pictures served as a slideshow's. */
  overlay: customPageSchema.nullable(),
});
export type Canvas = z.infer<typeof canvasSchema>;

/**
 * How long a page on a canvas may be, as JSON: two of them (the slide's and the overlay's) and the slide's text, each
 * cut to its limit, fit in one report (LIVE_MESSAGE_MAX). A page is far smaller unless it is mostly long texts.
 */
export const CANVAS_PAGE_MAX = 20 * 1024;

/** A page cut to CANVAS_PAGE_MAX: the elements drawn last (on top) go first. */
function cutPage(page: CustomPage): CustomPage {
  let elements = page.elements;
  while (elements.length && JSON.stringify({ ...page, elements }).length > CANVAS_PAGE_MAX) elements = elements.slice(0, -1);
  return elements === page.elements ? page : { ...page, elements };
}

/** The canvas of `slide` (null: nothing selected) and the overlay's page, cut to what a report may carry; `video` where the slide is a video's. */
export function toCanvas(
  slide: (Pick<PublicSlide, 'kind' | 'text' | 'verses' | 'image' | 'credits'> & { custom?: CustomPage }) | null,
  themeId: string,
  overlay: CustomPage | null,
  video: LiveVideo | null = null,
): Canvas {
  const cut = slide && toPublicSlide(slide, themeId);
  return {
    slide: cut && { kind: cut.kind, text: cut.text, verses: cut.verses, image: cut.image, credits: cut.credits, ...(video ? { video } : {}), ...(slide.custom ? { custom: cutPage(slide.custom) } : {}) },
    themeId,
    overlay: overlay?.elements.length ? cutPage(overlay) : null,
  };
}

/**
 * The canvas a report without one stands for: an owner of an older build sends only the public slide, so its screens
 * draw that, without the overlay (its text alone is no page).
 */
export function canvasOfPublicSlide(slide: PublicSlide): Canvas {
  const { kind, text, verses, image, credits, themeId } = slide;
  return { slide: { kind, text, verses, image, credits }, themeId, overlay: null };
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

/** The session's video for a controller (TODO.md "Video"): the video item the presenting computer plays, and where. */
export const liveVideoStateSchema = z.object({
  itemId: id,
  playing: z.boolean(),
  position: z.number().min(0).max(24 * 3600),
  duration: z.number().min(0).max(24 * 3600).nullable(),
});
export type LiveVideoState = z.infer<typeof liveVideoStateSchema>;

/** What a controller asks the presenting computer to do with its video, relayed like an audio command. */
export const videoCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), itemId: id }),
  z.object({ action: z.literal('pause'), itemId: id }),
  z.object({ action: z.literal('seek'), itemId: id, position: z.number().min(0).max(24 * 3600) }),
]);
export type VideoCommand = z.infer<typeof videoCommandSchema>;

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
  /** The outputs this session sends to: public ones and screens (LIVE-R23: one session per output). */
  outputs: z.array(id).max(50).default([]),
  /** Outputs another session sends to, which this one takes over ("Ta över"). */
  takeOver: z.array(id).max(50).default([]),
  /** What the public outputs show; only sent while there are outputs. */
  slide: publicSlideSchema.nullable().default(null),
  /** What the paired screens draw, the projector's canvas; only sent while there are outputs. Absent from an older owner. */
  canvas: canvasSchema.nullable().default(null),
  /** The audio item it plays, if any. */
  audio: liveAudioSchema.nullable().default(null),
  /** The video item it plays, if any. Absent from an older owner. */
  video: liveVideoStateSchema.nullable().default(null),
});
export type LiveOwnState = z.infer<typeof liveOwnStateSchema>;

export const liveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('own'), state: liveOwnStateSchema }),
  /** The owner stops; or anyone ends a session whose owner is gone (LIVE-R50). */
  z.object({ type: z.literal('end'), sessionId: id }),
  z.object({ type: z.literal('set'), sessionId: id, change: liveChangeSchema }),
  /** A controller's audio command, relayed to the owner like `set` (spec 04 §1b). */
  z.object({ type: z.literal('audio'), sessionId: id, command: audioCommandSchema }),
  /** A controller's video command (play, pause, seek), relayed to the owner like `audio`. */
  z.object({ type: z.literal('video'), sessionId: id, command: videoCommandSchema }),
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
  /** Its video, as the owner last reported it. */
  video?: LiveVideoState | null;
}

/** A temporary screen paired with this organisation (spec 04 §5): numbered for its name, "Tillfällig skärm (n)". */
export interface LiveScreen {
  id: string;
  n: number;
}

export type LiveServerMessage =
  /**
   * `online`: the outputs with a page open on them, so a saved screen can be
   * switched on only while it is (LIVE-A21). `screens`: the temporary screens
   * paired with the organisation, each for one session.
   */
  | { type: 'sessions'; sessions: LiveSessionInfo[]; online: string[]; screens: LiveScreen[] }
  /** To the owner only: a controller's command, to apply if it still makes sense (LIVE-R49). */
  | { type: 'command'; sessionId: string; change: LiveChange }
  /** To the owner only: a controller's audio command. */
  | { type: 'audio-command'; sessionId: string; command: AudioCommand }
  /** To the owner only: a controller's video command. */
  | { type: 'video-command'; sessionId: string; command: VideoCommand }
  /** To the owner only: saved or temporary screens let go after SCREEN_IDLE_MS without a slide change (LIVE-R43); switch them off. */
  | { type: 'released'; sessionId: string; outputs: string[] }
  | { type: 'error'; error: 'invalid-message' | 'not-owner' | 'not-found' | 'remote-off' | 'owner-offline' | 'forbidden' | 'output-taken' };

/** A session whose owner has been gone this long is ended (LIVE-R50's reaper). */
export const ABANDONED_SESSION_MS = 2 * 60 * 60 * 1000;
/** A session whose owner has not reported for this long is ended, owner online or not (LIVE-R42). */
export const SESSION_IDLE_MS = 4 * 60 * 60 * 1000;
/** A screen whose session has not changed slide for this long is let go (LIVE-R43). */
export const SCREEN_IDLE_MS = 4 * 60 * 60 * 1000;
/**
 * The largest message the server reads: room for the largest valid report,
 * even if every character of its slide needs a six-character JSON escape (a
 * test builds that report and checks it fits).
 */
export const LIVE_MESSAGE_MAX = 192 * 1024;

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
  /**
   * To a paired screen only, in place of `slide` and `idle` while it is bound:
   * the projector's canvas (spec 04 §5), null for black. `idle`: not bound.
   * `now` is the server's clock as it sent this, for a video's `at`.
   */
  | { type: 'canvas'; canvas: Canvas | null; now?: number }
  | { type: 'idle' }
  | { type: 'full' }
  /** To a temporary screen: it is no longer paired, and shows a new code (spec 04 §5). */
  | { type: 'unpaired' };
