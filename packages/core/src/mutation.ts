// What the shells share about mutations, now that the mutators are the Rust core's (crates/gp-core): who calls, a
// refusal, the limits the pages show, the settings' keys, and what the server and the pages read of a mutator's rows.
import { z } from 'zod';
import type { Role } from './permissions.ts';
import { readStoredJson } from './stored-json.ts';

export interface MutatorCtx {
  userId: string;
  role: Role;
  /**
   * The server's clock when it runs a push; absent on clients. Only used to
   * keep a client's clock from purging the trash early (`purgeExpiredTrash`).
   */
  now?: number;
}

/** Thrown for an expected refusal; the server records `code` and moves on. */
export class MutationError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

/** Limits of spec 02 and 03 (SONG-R7–R9, PRES-R10). Trashed rows do not count. */
export const LIMITS = { songs: 5000, partsPerSong: 50, arrangementsPerSong: 10, itemsPerPresentation: 100 } as const;

/**
 * The fields a person types, as the mutators check them: whether one may be left blank, and its most characters. A
 * name (a presentation's, an item's) is required and trimmed; spec 03's `EventLocation` ≤ 100 and `EventDescription`
 * ≤ 5000 (PRES-R9).
 */
export const FIELD_RULES = {
  name: { required: true, max: 200 },
  itemNote: { required: false, max: 200 },
  location: { required: false, max: 100 },
  description: { required: false, max: 5000 },
} as const;

/** The most verses one Bible item holds. */
export const MAX_VERSES_PER_ITEM = 500;

/** The organisation setting that names its default theme. */
export const DEFAULT_THEME_SETTING = 'defaultThemeId';

export const REMOTE_CONTROL_SETTING = 'remoteControl';

/**
 * Remote control for the whole organisation (TODO.md "Remote control for the
 * whole organisation"): never, the presenter's own toggle (LIVE-R39), or always.
 */
const remoteControlPolicySchema = z.enum(['never', 'presenter', 'always']);
export type RemoteControlPolicy = z.output<typeof remoteControlPolicySchema>;

/** The policy a stored value stands for; no row, or a value this build does not know, is the presenter's choice. */
export function remoteControlPolicy(value: string | null | undefined): RemoteControlPolicy {
  const parsed = remoteControlPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : 'presenter';
}

/** Whether a session may be driven: the policy first, the window's toggle only when the policy leaves it to the presenter. */
export function remoteControlAllowed(policy: RemoteControlPolicy, toggle: boolean): boolean {
  return policy === 'always' || (policy === 'presenter' && toggle);
}

/** The pushes after which the live hub tells everyone again whether each session may be driven. */
export const REMOTE_CONTROL_MUTATORS: readonly string[] = ['setRemoteControl'];

/** The pushes after which the server looks its outputs up again. */
export const DISPLAY_MUTATORS: readonly string[] = ['createDisplay', 'newDisplayCode', 'deleteDisplay'];

/** How a picture is edited: straightened, turned, flipped and cropped (a fraction of it). */
export interface ImageEdit {
  straighten: number;
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  crop: { x: number; y: number; w: number; h: number };
}

export const CCLI_COLLECTION_SETTING = 'ccliCollection';

/** An entry's id: one per song, day and presentation (SONG-R50), so the same showing again adds nothing. */
export const ccliEntryId = (songId: string, date: string, presentationId: string) => `${songId}|${date}|${presentationId}`;

/** At most this many versions per song; the oldest go (SONG-R21). */
export const SONG_VERSION_LIMIT = 50;

/** A person's changes within this long of the newest version add none (SONG-R20). */
export const SONG_VERSION_WINDOW_MS = 30 * 60 * 1000;

const snapshotSchema = z.object({
  name: z.string(),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  year: z.number().nullable(),
  ccli: z.string().nullable(),
  parts: z.array(z.object({ id: z.string(), labelId: z.string().nullable(), labelText: z.string().nullable(), labelColor: z.string().nullable(), content: z.string() })),
  arrangements: z.array(z.object({ id: z.string(), name: z.string().nullable(), partIds: z.array(z.string()) })),
});

/** What a version keeps: the song's fields, its parts in order with their labels, and its arrangements in order. */
export type SongSnapshot = z.infer<typeof snapshotSchema>;

export function parseSongSnapshot(data: string): SongSnapshot {
  return snapshotSchema.parse(readStoredJson(data));
}
