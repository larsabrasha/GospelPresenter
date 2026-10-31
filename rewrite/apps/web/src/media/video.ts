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
export const fileReader =
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
 * One load of the file in a <video>: its length, its size, and a still from
 * its start in a picture's two sizes, encoded as a picture is (WebP, or JPEG
 * where the canvas cannot encode WebP). A device that cannot decode it is refused.
 */
export async function videoStill(file: Blob): Promise<Pick<VideoImport, 'duration' | 'width' | 'height' | 'stillType' | 'still' | 'thumb'>> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new VideoRefused('decode')), 30_000);
      video.addEventListener('loadeddata', () => (clearTimeout(timer), resolve()), { once: true });
      video.addEventListener('error', () => (clearTimeout(timer), reject(new VideoRefused('decode'))), { once: true });
      video.src = url;
    });
    // No picture: a track it cannot decode, or none at all.
    if (!video.videoWidth || !video.videoHeight) throw new VideoRefused('decode');
    const full = fitWithin(video.videoWidth, video.videoHeight, IMAGE_VARIANTS.full.width, IMAGE_VARIANTS.full.height);
    const thumb = fitWithin(video.videoWidth, video.videoHeight, IMAGE_VARIANTS.thumb.width, IMAGE_VARIANTS.thumb.height);
    let type: 'image/webp' | 'image/jpeg' = 'image/webp';
    let stillBlob = await render(video, full, type, IMAGE_VARIANTS.full.quality);
    if (stillBlob.type !== type) {
      type = 'image/jpeg';
      stillBlob = await render(video, full, type, IMAGE_VARIANTS.full.quality);
    }
    const thumbBlob = await render(video, thumb, type, IMAGE_VARIANTS.thumb.quality);
    return {
      duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      width: video.videoWidth,
      height: video.videoHeight,
      stillType: type,
      still: new Uint8Array(await stillBlob.arrayBuffer()),
      thumb: new Uint8Array(await thumbBlob.arrayBuffer()),
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
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
  const base = `/api/media/${hash}/upload`;
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

/** URLs a <video src> streams from, by hash, until a few minutes before their token runs out. */
const playUrls = new Map<string, { url: string; expiresAt: number }>();

/** A URL that streams the video (`/api/play/{token}/{hash}`): a <video src> cannot send the session's header. Null when it cannot be had. */
export async function playUrl(hash: string): Promise<string | null> {
  const known = playUrls.get(hash);
  if (known && known.expiresAt - Date.now() > 10 * 60_000) return known.url;
  try {
    const r = await api<{ url: string; expiresAt: number }>('POST', `/api/media/${hash}/play`);
    if (r.status !== 200) return null;
    playUrls.set(hash, r.body);
    return r.body.url;
  } catch {
    return null;
  }
}

/** Where an import is, for the line beside the import button. */
export type VideoImportState = { name: string; phase: 'reading' | 'uploading' | 'waiting'; percent: number } | null;

/** Why a file was refused, as the import lists it. */
export function videoFailure(name: string, e: unknown): string {
  if (!(e instanceof VideoRefused)) return t('videos.failedOther', { name });
  const key = { type: 'videos.failedType', size: 'videos.failedSize', name: 'videos.failedName', codec: 'videos.failedCodec', decode: 'videos.failedDecode', other: 'videos.failedOther' } as const;
  return t(key[e.problem], { name, codec: e.codec ?? '?' });
}

/** Reads, checks and uploads one file, then records it in the library. */
export async function importVideo(file: File, add: (v: VideoImport) => Promise<void>, state: (s: VideoImportState) => void): Promise<string> {
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
  const run = async (files: File[]): Promise<string[]> => {
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
