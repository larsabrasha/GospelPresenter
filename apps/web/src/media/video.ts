import { whileHolding } from '../newBuild.ts';
import { useState } from 'react';
import {
  fitWithin,
  IMAGE_VARIANTS,
  MEDIA_LIMITS,
  probeVideo,
  Sha256,
  VIDEO_LIMITS,
  VIDEO_TYPES,
  videoMime,
  videoTypeFromName,
  type RangeReader,
  type VideoCodec,
  type VideoType,
} from '@gp/core';
import { api, authHeaders } from '../auth/api.ts';
import type { VideoImport } from '../db/protocol.ts';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { render } from './process.ts';
import { serverUrl } from '../server.ts';
import { reportClientError } from '../clientErrors.ts';
import { decodedFrame } from './videoFrame.ts';

// Importing a video (TODO.md "Video, and which files a device fetches"): MP4
// or MOV with H.264 or HEVC, kept as it is. The page reads the codec from the
// file, loads it once in a <video> for its length, size and a still from its
// start, hashes it a slice at a time, and uploads it in parts that go on where
// they were cut off. The video is never kept on the device: only its still is,
// as a picture's blobs are. See docs/media-and-files.md, "Video".

/** The files the video import takes. */
export const VIDEO_ACCEPT = [...VIDEO_TYPES, '.mp4', '.m4v', '.mov'].join(',');

export type VideoProblem = 'type' | 'size' | 'name' | 'codec' | 'decode' | 'other';

export class VideoRefused extends Error {
  constructor(
    readonly problem: VideoProblem,
    /** The codec the file has, when it is one not taken. */
    readonly codec?: string,
  ) {
    super(problem);
  }
}

/** The checks that need no reading: the type the browser reports, else the extension; the size; the name. */
export function checkPickedVideo(file: Pick<File, 'type' | 'size' | 'name'>): VideoType {
  const type = VIDEO_TYPES.find((x) => x === file.type) ?? (file.type === '' || file.type === 'application/octet-stream' ? videoTypeFromName(file.name) : null);
  if (!type) throw new VideoRefused('type');
  if (file.size === 0 || file.size > VIDEO_LIMITS.bytes) throw new VideoRefused('size');
  if (file.name.length > MEDIA_LIMITS.fileName) throw new VideoRefused('name');
  return type;
}

/** Reads ranges of a picked file from disk: the file is never read whole into memory. */
const fileReader =
  (file: Blob): RangeReader =>
  async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());

/** The SHA-256 of a file, a part at a time; `progress` gets the share done, 0 to 1. */
export async function hashFile(file: Blob, progress: (done: number) => void = () => {}): Promise<string> {
  const hash = new Sha256();
  const read = fileReader(file);
  for (let at = 0; at < file.size; at += VIDEO_LIMITS.partBytes) {
    hash.update(await read(at, VIDEO_LIMITS.partBytes));
    progress(Math.min(1, (at + VIDEO_LIMITS.partBytes) / file.size));
  }
  return hash.hex();
}

/** Whether this device can play a video: `canPlayType` with the codec named (HEVC is missing on Linux and in older browsers). */
export function canPlayVideo(type: VideoType, codec: VideoCodec): boolean {
  return typeof document !== 'undefined' && document.createElement('video').canPlayType(videoMime(type, codec)) !== '';
}

/** "H.264" or "HEVC", as a user knows them. */
export const codecName = (codec: string) => (codec === 'h264' ? 'H.264' : codec === 'hevc' ? 'HEVC' : codec);

/**
 * When the still is taken (Lars, 2026-10-31): a bit into the video, as the first frame is often black or a
 * fade: at 1 s or a tenth of the length, whichever is earlier; never at or past the end of a very short clip.
 */
export function stillTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, duration / 10, duration - 0.05));
}

type VideoStill = Pick<VideoImport, 'duration' | 'width' | 'height' | 'stillType' | 'still' | 'thumb'>;

/**
 * The video's length, its size, and a still from a bit into it (`stillTime`) in a picture's two sizes, encoded as a
 * picture is (WebP, or JPEG where the canvas cannot encode WebP): decoded from the file (`decodedFrame`), else from a
 * <video>. A device that can do neither is refused.
 */
async function videoStill(file: Blob): Promise<VideoStill> {
  const decoded = await decodedFrame(file, stillTime).catch((e: unknown) => {
    reportClientError(new Error(`video frame not decoded: ${e instanceof Error ? e.message : String(e)}, ${Math.round(file.size / 1e6)} MB`));
    return null;
  });
  if (decoded) return encodeStill(decoded.frame, decoded.width, decoded.height, decoded.duration);
  return playedStill(file);
}

/** The still in a picture's two sizes, from a frame `width` × `height` of a video `duration` seconds long. */
async function encodeStill(frame: CanvasImageSource, width: number, height: number, duration: number): Promise<VideoStill> {
  const full = fitWithin(width, height, IMAGE_VARIANTS.full.width, IMAGE_VARIANTS.full.height);
  const thumb = fitWithin(width, height, IMAGE_VARIANTS.thumb.width, IMAGE_VARIANTS.thumb.height);
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  let stillBlob = await render(frame, full, type, IMAGE_VARIANTS.full.quality);
  if (stillBlob.type !== type) {
    type = 'image/jpeg';
    stillBlob = await render(frame, full, type, IMAGE_VARIANTS.full.quality);
  }
  const thumbBlob = await render(frame, thumb, type, IMAGE_VARIANTS.thumb.quality);
  return {
    duration: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
    width,
    height,
    stillType: type,
    still: new Uint8Array(await stillBlob.arrayBuffer()),
    thumb: new Uint8Array(await thumbBlob.arrayBuffer()),
  };
}

/** The still from one load of the file in a <video>, where it cannot be decoded without one. */
async function playedStill(file: Blob): Promise<VideoStill> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // On the page, out of sight: an iPhone (Safari 27.2, 2026-11-08) never began loading a video that was not, nor played
  // (networkState 0 after 30 s); the simulator did.
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(video);
  /** Whether it had to be played, muted, before it loaded (for the log). */
  let kicked = false;
  /**
   * A refusal because this device could not decode the video, written to the server's log with why (which step, the
   * MediaError, how far it loaded) and the file's size, never its name: the error text is the same for each.
   */
  const refused = (step: string) => {
    const e = video.error;
    reportClientError(
      new Error(
        `video not decoded at ${step}${kicked ? ' (played)' : ''}: error ${e ? `${e.code} ${e.message}` : 'none'}, readyState ${video.readyState}, networkState ${video.networkState}, ` +
          `${video.videoWidth}x${video.videoHeight}, duration ${video.duration}, ${Math.round(file.size / 1e6)} MB, ${file.type || 'no type'}`,
      ),
    );
    return new VideoRefused('decode');
  };
  try {
    // Its size and length first. iOS Safari seems to load no more than that of a video nobody plays, whatever `preload`
    // says, and waiting for a frame here (`loadeddata`) refused an H.264 video from an iPhone (2026-11-08).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(refused('metadata timeout')), 30_000);
      // Still nothing after a while: play it, muted, which iOS allows without a tap and which makes it load.
      const kick = setTimeout(() => {
        kicked = true;
        void video.play().catch(() => undefined);
      }, 3_000);
      const done = () => (clearTimeout(timer), clearTimeout(kick));
      video.addEventListener('loadedmetadata', () => (done(), resolve()), { once: true });
      video.addEventListener('error', () => (done(), reject(refused('metadata error'))), { once: true });
      video.src = url;
      video.load();
    });
    video.pause();
    // No picture: a track it cannot decode, or none at all.
    if (!video.videoWidth || !video.videoHeight) throw refused('no size');
    await frameAt(video, stillTime(video.duration), refused);
    await drawable(video);
    return await encodeStill(video, video.videoWidth, video.videoHeight, video.duration);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * Has `video` decode the frame at `at` seconds: a seek makes every browser load and decode one, iOS Safari too (never
 * to 0 itself, where a video already is and no `seeked` comes). A frame that does not come in 15 s is asked for by
 * playing, muted, for a moment; after that the still is whatever the video shows. A video that fails to decode is refused.
 */
async function frameAt(video: HTMLVideoElement, at: number, refused: (step: string) => VideoRefused): Promise<void> {
  const waitFor = (event: 'seeked' | 'timeupdate', ms: number) =>
    new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => (video.removeEventListener('error', failed), resolve(false)), ms);
      const failed = () => (clearTimeout(timer), reject(refused(`${event} error`)));
      video.addEventListener(event, () => (clearTimeout(timer), video.removeEventListener('error', failed), resolve(true)), { once: true });
      video.addEventListener('error', failed, { once: true });
    });
  const seeked = waitFor('seeked', 15_000);
  video.currentTime = Math.max(at, 0.001);
  if (await seeked) return;
  const played = waitFor('timeupdate', 5_000);
  await video.play().catch(() => undefined);
  await played;
  video.pause();
}

/**
 * Waits until `video` draws its frame, at most 5 s: in iOS Safari a frame drawn just after `seeked`, even after
 * `loadeddata`, can come out empty (seen in the simulator, 2026-11-08). A decoded frame is opaque, so an empty one is
 * told by its alpha.
 */
async function drawable(video: HTMLVideoElement): Promise<void> {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 8;
  const g = probe.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  for (let tries = 0; tries < 25; tries++) {
    g.clearRect(0, 0, 8, 8);
    g.drawImage(video, 0, 0, 8, 8);
    if (g.getImageData(0, 0, 8, 8).data.some((v, i) => i % 4 === 3 && v > 0)) return;
    await new Promise((r) => setTimeout(r, 200)); // not drawn yet: the next try a moment later
  }
}

/** Where an upload is: the share sent, 0 to 1, and whether it waits for the network. */
export interface UploadProgress {
  done: number;
  waiting: boolean;
}

/** How long an upload out of step with the server (another device sent the same part) waits before it asks again. */
const OUT_OF_STEP_MS = 250;

/** Waits after a failure: 1, 2, 5, 10 s, then every 30 s, for as long as the page is open. */
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

const json = async (res: Response) => (await res.json().catch(() => ({}))) as { done?: boolean; partBytes?: number; received?: number; error?: string; problem?: string; entry?: string; type?: VideoType; codec?: VideoCodec };

/**
 * Uploads a video in parts (`/api/media/{hash}/upload`). The server says what
 * it has, known by the hash, and the parts after that are sent, so a cut-off
 * upload goes on from its last part: a dropped network within the page by
 * itself, after a wait; a page that was closed when the same file is picked
 * again. A refusal (not a video, another codec, too large) throws.
 */
export async function uploadVideo(file: Blob, hash: string, progress: (p: UploadProgress) => void = () => {}, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ type: VideoType; codec: VideoCodec }> {
  const base = serverUrl(`/api/media/${hash}/upload`);
  const read = fileReader(file);
  let failures = 0;
  const failed = async (done: number) => {
    progress({ done, waiting: true });
    await sleep(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]!);
  };
  const refused = (body: Awaited<ReturnType<typeof json>>, status: number) => {
    if (status === 413) return new VideoRefused('size');
    if (body.error === 'invalid-video') return body.problem === 'codec' ? new VideoRefused('codec', body.entry) : new VideoRefused('type');
    return new VideoRefused('other');
  };
  let done = 0;
  for (;;) {
    try {
      const started = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ size: file.size }) });
      const s = await json(started);
      if (started.status >= 500) throw new Error('server');
      if (!started.ok) throw refused(s, started.status);
      if (!s.done) {
        const partBytes = s.partBytes!;
        let received = s.received!;
        while (received < file.size) {
          done = received / file.size;
          progress({ done, waiting: false });
          const part = received / partBytes + 1;
          const res = await fetch(`${base}/${part}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...authHeaders() }, body: (await read(received, partBytes)) as BodyInit });
          const r = await json(res);
          if (res.status >= 500) throw new Error('server');
          if (res.status === 409 || res.status === 404) break; // out of step with the server: ask again where it is
          if (!res.ok) throw refused(r, res.status);
          received = r.received!;
          failures = 0;
        }
        if (received < file.size) {
          await sleep(OUT_OF_STEP_MS); // never a tight loop, whatever the server answers
          continue;
        }
      }
      progress({ done: 1, waiting: false });
      const finished = await fetch(`${base}/finish`, { method: 'POST', headers: authHeaders() });
      const f = await json(finished);
      if (finished.status >= 500) throw new Error('server');
      if (finished.status === 409 || finished.status === 404) {
        await sleep(OUT_OF_STEP_MS);
        continue;
      }
      if (!finished.ok) throw refused(f, finished.status);
      // Known already (another device uploaded the same video): the type is the server's, the codec read here.
      return { type: f.type ?? 'video/mp4', codec: f.codec ?? 'h264' };
    } catch (e) {
      if (e instanceof VideoRefused) throw e;
      await failed(done); // the network or the server: wait, then ask where it is and go on
    }
  }
}

/** A video kept whole on this device (`db/videoFiles.ts`), as a file: what a <video src> plays offline. Null when it is not here. */
async function keptVideoFile(hash: string): Promise<File | null> {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    return await (await dir.getFileHandle(hash)).getFile();
  } catch {
    return null;
  }
}

/** Object URLs of videos kept on this device: a file's URL reads from the disk, so it holds no copy in memory. */
const keptUrls = new Map<string, string>();

/** URLs a <video src> streams from, by hash, until a few minutes before their token runs out. */
const playUrls = new Map<string, { url: string; expiresAt: number }>();

/**
 * A URL that plays the video: the file kept on this device when the presentation is kept offline here,
 * else a stream from the server (`/api/play/{token}/{hash}`: a <video src> cannot send the session's
 * header). Null when it cannot be had.
 */
export async function playUrl(hash: string): Promise<string | null> {
  const local = keptUrls.get(hash);
  if (local) return local;
  const file = await keptVideoFile(hash);
  if (file) {
    const url = URL.createObjectURL(file);
    keptUrls.set(hash, url);
    return url;
  }
  const known = playUrls.get(hash);
  if (known && known.expiresAt - Date.now() > 10 * 60_000) return known.url;
  try {
    const r = await api<{ url: string; expiresAt: number }>('POST', `/api/media/${hash}/play`);
    if (r.status !== 200) return null;
    const played = { ...r.body, url: serverUrl(r.body.url) };
    playUrls.set(hash, played);
    return played.url;
  } catch {
    return null;
  }
}

/** Where an import is, for the line beside the import button. */
export type VideoImportState = { name: string; phase: 'reading' | 'uploading' | 'waiting'; percent: number } | null;

/** Why a file was refused, as the import lists it. */
function videoFailure(name: string, e: unknown): string {
  if (!(e instanceof VideoRefused)) return t('videos.failedOther', { name });
  const key = { type: 'videos.failedType', size: 'videos.failedSize', name: 'videos.failedName', codec: 'videos.failedCodec', decode: 'videos.failedDecode', other: 'videos.failedOther' } as const;
  return t(key[e.problem], { name, codec: e.codec ?? '?' });
}

/** Reads, checks and uploads one file, then records it in the library. */
async function importVideo(file: File, add: (v: VideoImport) => Promise<void>, state: (s: VideoImportState) => void): Promise<string> {
  checkPickedVideo(file);
  const probe = await probeVideo(fileReader(file), file.size);
  if (!probe.ok) throw probe.problem === 'codec' ? new VideoRefused('codec', probe.entry) : new VideoRefused('type');
  state({ name: file.name, phase: 'reading', percent: 0 });
  const still = await videoStill(file);
  const hash = await hashFile(file, (done) => state({ name: file.name, phase: 'reading', percent: Math.floor(done * 100) }));
  const uploaded = await uploadVideo(file, hash, (p) => state({ name: file.name, phase: p.waiting ? 'waiting' : 'uploading', percent: Math.floor(p.done * 100) }));
  const id = newId();
  await add({ id, fileName: file.name, contentType: uploaded.type, codec: probe.codec, hash, size: file.size, ...still });
  return id;
}

/** The import behind the Video tab's button and drop: one file at a time, its progress, and why each refused one was. */
export function useVideoImport() {
  const db = useDb();
  const [state, setState] = useState<VideoImportState>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The newer build waits while files go up (newBuild.ts).
  const run = (files: File[]): Promise<string[]> => whileHolding(() => runFiles(files));
  const runFiles = async (files: File[]): Promise<string[]> => {
    if (!files.length || busy) return [];
    setBusy(true);
    setFailures([]);
    const failed: string[] = [];
    const added: string[] = [];
    try {
      for (const file of files) {
        try {
          added.push(await importVideo(file, (v) => db.addVideo(v), setState));
        } catch (e) {
          failed.push(videoFailure(file.name, e));
        }
      }
    } finally {
      setState(null);
      setBusy(false);
      setFailures(failed);
    }
    return added;
  };
  return { run, state, failures, busy };
}
