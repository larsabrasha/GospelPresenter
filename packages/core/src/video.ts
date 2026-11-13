// Video files (TODO.md "Video, and which files a device fetches"): MP4 and MOV
// with H.264 or HEVC, kept as they are, never converted. What a file is comes
// from its own boxes (ISO/IEC 14496-12): the `ftyp` box at its start, and the
// codec of its video track in the `stsd` box inside `moov`, which may sit at
// either end of the file. Both the import and the server read them a range at
// a time (`RangeReader`), so neither holds a file of up to 2 GB in memory.

export const VIDEO_LIMITS = {
  /** The largest video (Lars, 2026-10-31: "at most 2 GB"). */
  bytes: 2 * 1024 * 1024 * 1024,
  /**
   * The size of every part of an upload but the last: R2's multipart upload wants parts of at
   * least 5 MiB, all but the last of one size, and a part is one request (100 MB at most on
   * Cloudflare's usual plans). A multiple of 64, so the server's running hash has no tail between parts.
   */
  partBytes: 8 * 1024 * 1024,
  /** The largest `moov` box read: its sample tables grow with the length, a few MB for hours. */
  moovBytes: 64 * 1024 * 1024,
  videos: 500,
} as const;

/** How long a token to stream a video lasts (`/api/play/{token}/{hash}`): a service and then some. */
export const PLAY_TOKEN_MS = 6 * 60 * 60 * 1000;

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export const VIDEO_CODECS = ['h264', 'hevc'] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

const VIDEO_EXTENSIONS: Record<string, VideoType> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime' };

/** The type a file name's extension says, or null. */
export function videoTypeFromName(fileName: string): VideoType | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (VIDEO_EXTENSIONS[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

const ascii = (bytes: Uint8Array, from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length));

/**
 * The container, by the file's first bytes: an `ftyp` box first, whose brand
 * `qt  ` is QuickTime and anything else an MP4. Null for anything else (a
 * QuickTime file from before `ftyp`, WebM, AVI).
 */
export function sniffVideoContainer(bytes: Uint8Array): VideoType | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null;
  return ascii(bytes, 8, 4) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

interface BoxHeader {
  type: string;
  /** The whole box, header included. */
  size: number;
  headerSize: number;
}

/** A box header at the start of `bytes`; null if it does not fit or makes no sense. `rest` is what is left of the parent from here. */
function boxHeader(bytes: Uint8Array, rest: number): BoxHeader | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(0, false);
  let headerSize = 8;
  if (size === 1) {
    if (bytes.length < 16) return null;
    size = view.getUint32(8, false) * 0x1_0000_0000 + view.getUint32(12, false);
    headerSize = 16;
  } else if (size === 0) size = rest; // to the end of the parent (or the file)
  if (size < headerSize || size > rest) return null;
  return { type: ascii(bytes, 4, 4), size, headerSize };
}

/** Where the file's `moov` box is, walking the top-level boxes a header at a time; null if there is none. */
export async function findMoov(read: RangeReader, fileSize: number): Promise<{ offset: number; size: number } | null> {
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const box = boxHeader(await read(offset, 16), fileSize - offset);
    if (!box) return null;
    if (box.type === 'moov') return { offset, size: box.size };
    offset += box.size;
  }
  return null;
}

/** The children of a box's payload, as [type, payload] pairs; stops at the first that makes no sense. */
function* children(payload: Uint8Array): Generator<[string, Uint8Array]> {
  let at = 0;
  while (at + 8 <= payload.length) {
    const box = boxHeader(payload.subarray(at), payload.length - at);
    if (!box) return;
    yield [box.type, payload.subarray(at + box.headerSize, at + box.size)];
    at += box.size;
  }
}

const child = (payload: Uint8Array, type: string) => {
  for (const [t, p] of children(payload)) if (t === type) return p;
  return null;
};

/**
 * The sample entry type of each video track in a `moov` box (`avc1`, `hvc1`,
 * …): trak › mdia, whose `hdlr` says `vide`, › minf › stbl › stsd › its first
 * entry.
 */
export function videoSampleEntries(moov: Uint8Array): string[] {
  const found: string[] = [];
  for (const [type, trak] of children(moov)) {
    if (type !== 'trak') continue;
    const mdia = child(trak, 'mdia');
    const hdlr = mdia && child(mdia, 'hdlr');
    // A full box: version and flags (4), pre_defined (4), then the handler type.
    if (!hdlr || hdlr.length < 12 || ascii(hdlr, 8, 4) !== 'vide') continue;
    const stbl = child(child(mdia, 'minf') ?? new Uint8Array(), 'stbl');
    const stsd = stbl && child(stbl, 'stsd');
    // A full box (4), the entry count (4), then the entries, each a box named by its format.
    const entry = stsd && stsd.length >= 16 ? boxHeader(stsd.subarray(8), stsd.length - 8) : null;
    if (entry) found.push(entry.type);
  }
  return found;
}

const CODECS: Record<string, VideoCodec> = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc' };

/** The codec of a sample entry type, or null for one not taken. */
export function codecOfEntry(entry: string): VideoCodec | null {
  return CODECS[entry] ?? null;
}

export type VideoProbe = { ok: true; type: VideoType; codec: VideoCodec } | { ok: false; problem: 'container' | 'codec'; entry?: string };

/**
 * What a video file is: MP4 or MOV, and the codec of its first video track,
 * H.264 or HEVC. Anything else is refused (the import hints at exporting as
 * MP4): another container, no video track, or another codec.
 */
export async function probeVideo(read: RangeReader, fileSize: number): Promise<VideoProbe> {
  const type = sniffVideoContainer(await read(0, 16));
  if (!type) return { ok: false, problem: 'container' };
  const moov = await findMoov(read, fileSize);
  if (!moov || moov.size > VIDEO_LIMITS.moovBytes) return { ok: false, problem: 'codec' };
  const box = await read(moov.offset, moov.size);
  const header = boxHeader(box, moov.size);
  const entry = header ? videoSampleEntries(box.subarray(header.headerSize))[0] : undefined;
  const codec = entry ? codecOfEntry(entry) : null;
  return codec ? { ok: true, type, codec } : { ok: false, problem: 'codec', ...(entry ? { entry } : {}) };
}

/** A string `canPlayType` and `MediaCapabilities` understand, for a codec in a container. */
export function videoMime(type: VideoType, codec: VideoCodec): string {
  // Main profile, level 4.0 for H.264; Main, level 4.0 for HEVC: what a phone or a camera records.
  return `${type === 'video/quicktime' ? 'video/mp4' : type}; codecs="${codec === 'h264' ? 'avc1.4D4028' : 'hvc1.1.6.L120.90'}"`;
}

/** The parts an upload of `size` bytes has: all VIDEO_LIMITS.partBytes but the last. */
export function partCount(size: number, partBytes: number = VIDEO_LIMITS.partBytes): number {
  return Math.max(1, Math.ceil(size / partBytes));
}
