import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sha256, VIDEO_LIMITS } from '@gp/core';
import { expectedPosition, follow, SEEK_DRIFT_S } from '../src/live/video.ts';
import { checkPickedVideo, hashFile, uploadVideo, VideoRefused, type UploadProgress } from '../src/media/video.ts';
import { formatDuration } from '../src/pages/VideoTab.tsx';

// TODO.md "Video": following the presenting window's video, and the import's checks, hash and upload.

describe('following a video', () => {
  it('moves the position on by the time since the moment while it plays', () => {
    expect(expectedPosition({ playing: true, position: 10, at: 1000 }, 3500)).toBe(12.5);
  });

  it('keeps the position while it is paused, and never goes past the end', () => {
    expect(expectedPosition({ playing: false, position: 10, at: 1000 }, 9000)).toBe(10);
    expect(expectedPosition({ playing: true, position: 10, at: 0 }, 60_000, 30)).toBe(30);
  });

  it('plays at normal speed when within a few hundredths of where it should be', () => {
    expect(follow(5.02, 5, true)).toEqual({ seekTo: null, rate: 1 });
  });

  it('plays a little faster when behind, a little slower when ahead, at most 5 %', () => {
    expect(follow(5.1, 5, true).rate).toBeCloseTo(1.05);
    expect(follow(5, 5.06, true).rate).toBeCloseTo(0.97);
    expect(follow(5.25, 5, true)).toEqual({ seekTo: null, rate: 1.05 });
  });

  it('seeks when it has drifted more than a fraction of a second', () => {
    expect(follow(5 + SEEK_DRIFT_S + 0.01, 5, true)).toEqual({ seekTo: 5 + SEEK_DRIFT_S + 0.01, rate: 1 });
  });

  it('seeks a paused follower to where the video was paused', () => {
    expect(follow(8, 3, false)).toEqual({ seekTo: 8, rate: 1 });
  });
});

describe('picking a video', () => {
  it('takes MP4 and MOV by the type the browser reports, or by the extension', () => {
    expect(checkPickedVideo({ type: 'video/quicktime', size: 10, name: 'IMG_0001.MOV' })).toBe('video/quicktime');
    expect(checkPickedVideo({ type: '', size: 10, name: 'dop.mp4' })).toBe('video/mp4');
  });

  it('refuses WebM, a file over 2 GB, and a name over 200 characters', () => {
    const problem = (f: { type: string; size: number; name: string }) => {
      try {
        checkPickedVideo(f);
        return null;
      } catch (e) {
        return (e as VideoRefused).problem;
      }
    };
    expect(problem({ type: 'video/webm', size: 10, name: 'a.webm' })).toBe('type');
    expect(problem({ type: 'video/mp4', size: VIDEO_LIMITS.bytes + 1, name: 'a.mp4' })).toBe('size');
    expect(problem({ type: 'video/mp4', size: 10, name: `${'a'.repeat(200)}.mp4` })).toBe('name');
  });

  it('shows a length as minutes and seconds, or hours too', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});

describe('hashing a file in steps', () => {
  it('gives the hash of the whole file, reading a part at a time', async () => {
    const bytes = Uint8Array.from({ length: VIDEO_LIMITS.partBytes + 77 }, (_, i) => i & 0xff);
    const seen: number[] = [];

    const hash = await hashFile(new Blob([bytes]), (done) => seen.push(done));

    expect(hash).toBe(new Sha256().update(bytes).hex());
    expect(seen).toEqual([VIDEO_LIMITS.partBytes / bytes.length, 1]);
  });
});

/** A server that takes an upload in parts of four bytes, as `/api/media/{hash}/upload` does, and can drop the network once. */
function fakeServer(dropAtPart: number | null) {
  let parts: Uint8Array[] = [];
  let size = 0;
  let dropped = false;
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url, 'http://host').pathname;
    if (init.method === 'POST' && path.endsWith('/upload')) {
      size = (JSON.parse(String(init.body)) as { size: number }).size;
      return reply(200, { done: false, partBytes: 4, received: parts.length * 4 });
    }
    if (init.method === 'PUT') {
      const part = Number(path.split('/').at(-1));
      if (part === dropAtPart && !dropped) {
        dropped = true;
        throw new TypeError('Failed to fetch');
      }
      if (part !== parts.length + 1) return reply(409, { error: 'out-of-order', received: parts.length * 4 });
      parts = [...parts, new Uint8Array(init.body as Uint8Array)];
      return reply(200, { received: Math.min(size, parts.length * 4) });
    }
    return reply(200, { done: true, type: 'video/mp4', codec: 'hevc' });
  });
  return { fetch, whole: () => new Uint8Array(parts.flatMap((p) => [...p])) };
}

describe('uploading a video in parts', () => {
  afterEach(() => vi.unstubAllGlobals());
  const file = new Blob([Uint8Array.from({ length: 10 }, (_, i) => i + 1)]);

  it('sends every part in order and finishes with what the server read from the file', async () => {
    const server = fakeServer(null);
    vi.stubGlobal('fetch', server.fetch);

    const result = await uploadVideo(file, 'a'.repeat(64), () => {}, async () => {});

    expect(result).toEqual({ type: 'video/mp4', codec: 'hevc' });
    expect(server.whole()).toEqual(new Uint8Array(await file.arrayBuffer()));
  });

  it('waits when the network drops, then goes on from the last part the server has', async () => {
    const server = fakeServer(2);
    vi.stubGlobal('fetch', server.fetch);
    const progress: UploadProgress[] = [];

    await uploadVideo(file, 'a'.repeat(64), (p) => progress.push(p), async () => {});

    expect(progress.some((p) => p.waiting)).toBe(true);
    expect(server.whole()).toEqual(new Uint8Array(await file.arrayBuffer()));
    expect(server.fetch.mock.calls.filter(([, init]) => init.method === 'PUT').map(([url]) => url.split('/').at(-1))).toEqual(['1', '2', '2', '3']);
  });

  it('throws the reason when the server refuses the codec', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) =>
      init.method === 'POST' && String(_url).endsWith('/finish')
        ? new Response(JSON.stringify({ error: 'invalid-video', problem: 'codec', entry: 'mp4v' }), { status: 400 })
        : new Response(JSON.stringify({ done: true, partBytes: 4, received: 10 }), { status: 200 }),
    );

    await expect(uploadVideo(file, 'a'.repeat(64), () => {}, async () => {})).rejects.toMatchObject({ problem: 'codec', codec: 'mp4v' });
  });
});
