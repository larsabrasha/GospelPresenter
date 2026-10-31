// Videos against every server adapter (TODO.md "Video"): an upload in parts
// that goes on where it was cut off, the file's own signature and codec
// deciding what is kept, streaming with Range, the token a `<video src>`
// streams with, the library row, and a paired screen streaming what its
// canvas shows.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mediaKey, sha256HexBytes, VIDEO_LIMITS, type Canvas, type LiveVideo, type PublicSlide } from '@gp/core';
import { storeMediaBlob } from '@gp/sync/client';
import { parseRange, streamBytes } from '@gp/server';
import { diskStorage } from '../src/media-disk.ts';
import { api, device, serverDump, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';
import { Viewer } from './sse-viewer.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url)));

/** A playable MP4 of more than one part: the fixture with a `free` box after its moov, which players skip. */
function twoParts(): Uint8Array {
  const video = fixture('h264.mp4');
  const pad = VIDEO_LIMITS.partBytes + 1000;
  const out = new Uint8Array(video.length + pad);
  out.set(video);
  new DataView(out.buffer).setUint32(video.length, pad, false);
  out.set([0x66, 0x72, 0x65, 0x65], video.length + 4); // 'free'
  return out;
}

type Started = { done: boolean; partBytes: number; received: number };
type Finished = { done?: boolean; type?: string; codec?: string; error?: string; problem?: string; entry?: string };

const auth = (h: Harness, org: string, user: string) => ({ authorization: `Bearer ${tokenOf(h, org, user)}` });

function start(h: Harness, org: string, user: string, hash: string, size: number) {
  return api<Started & { error?: string }>(h, 'POST', `/api/media/${hash}/upload`, { user, org, body: { size } });
}

async function putPart(h: Harness, org: string, user: string, hash: string, part: number, bytes: Uint8Array) {
  const res = await fetch(`${h.url}/api/media/${hash}/upload/${part}`, { method: 'PUT', headers: auth(h, org, user), body: bytes as BodyInit });
  return { status: res.status, body: (await res.json()) as { received?: number; error?: string } };
}

const finish = (h: Harness, org: string, user: string, hash: string) => api<Finished>(h, 'POST', `/api/media/${hash}/upload/finish`, { user, org });

/** The whole upload, from where the server is: start, the parts left, finish. */
async function upload(h: Harness, org: string, user: string, bytes: Uint8Array): Promise<{ hash: string; status: number; body: Finished }> {
  const hash = await sha256HexBytes(bytes);
  const s = await start(h, org, user, hash, bytes.length);
  expect(s.status).toBe(200);
  for (let at = s.body.received; at < bytes.length; at += s.body.partBytes) {
    expect((await putPart(h, org, user, hash, at / s.body.partBytes + 1, bytes.subarray(at, at + s.body.partBytes))).status).toBe(200);
  }
  return { hash, ...(await finish(h, org, user, hash)) };
}

const get = (h: Harness, path: string, headers: Record<string, string> = {}) => fetch(h.url + path, { headers });

describe.each(adapters)('%s adapter: video uploads', (adapterName) => {
  let h: Harness;
  let org: string;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => h?.close());
  beforeEach(async () => {
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'user');
  });

  it('takes a small H.264 MP4 in one part and reads its type and codec from the file', async () => {
    const r = await upload(h, org, 'anna', fixture('h264.mp4'));

    expect([r.status, r.body]).toEqual([200, { done: true, type: 'video/mp4', codec: 'h264' }]);
    expect(await h.mediaKeys()).toContain(mediaKey(org, r.hash));
  });

  it('takes HEVC, and a MOV by its brand', async () => {
    const hevc = await upload(h, org, 'anna', fixture('hevc.mp4'));
    const mov = await upload(h, org, 'anna', fixture('h264.mov'));

    expect(hevc.body).toEqual({ done: true, type: 'video/mp4', codec: 'hevc' });
    expect(mov.body).toEqual({ done: true, type: 'video/quicktime', codec: 'h264' });
  });

  it('refuses another codec when it is finished, and keeps nothing of it', async () => {
    const r = await upload(h, org, 'anna', fixture('mpeg4.mp4'));

    expect([r.status, r.body]).toEqual([400, { error: 'invalid-video', problem: 'codec', entry: 'mp4v' }]);
    expect(await h.mediaKeys()).not.toContain(mediaKey(org, r.hash));
    expect((await start(h, org, 'anna', r.hash, fixture('mpeg4.mp4').length)).body).toMatchObject({ done: false, received: 0 });
  });

  it('refuses a first part that does not start like an MP4 or MOV, whatever the client claims', async () => {
    const text = new TextEncoder().encode('RIFF....AVI this is no video at all');
    const hash = await sha256HexBytes(text);
    await start(h, org, 'anna', hash, text.length);

    expect(await putPart(h, org, 'anna', hash, 1, text)).toEqual({ status: 400, body: { error: 'invalid-video', problem: 'container' } });
  });

  it('refuses a file whose bytes are not its hash', async () => {
    const bytes = fixture('h264.mp4');
    const wrong = 'f'.repeat(64);
    await start(h, org, 'anna', wrong, bytes.length);
    await putPart(h, org, 'anna', wrong, 1, bytes);

    expect(await finish(h, org, 'anna', wrong)).toEqual({ status: 400, body: { error: 'hash-mismatch' } });
    expect(await h.mediaKeys()).not.toContain(mediaKey(org, wrong));
  });

  it('refuses more than 2 GB before a byte is sent, and a caller who is not signed in', async () => {
    expect((await start(h, org, 'anna', 'a'.repeat(64), VIDEO_LIMITS.bytes + 1)).status).toBe(413);
    expect((await api(h, 'POST', `/api/media/${'a'.repeat(64)}/upload`, { body: { size: 10 } })).status).toBe(401);
  });

  it('goes on from the last part after a cut-off upload, known by the hash', async () => {
    const bytes = twoParts();
    const hash = await sha256HexBytes(bytes);
    const first = await start(h, org, 'anna', hash, bytes.length);
    await putPart(h, org, 'anna', hash, 1, bytes.subarray(0, first.body.partBytes));

    // The page was closed; the file is picked again, hashed again, and asks where the server is.
    const again = await start(h, org, 'anna', hash, bytes.length);
    await putPart(h, org, 'anna', hash, 2, bytes.subarray(again.body.received));

    expect(again.body).toEqual({ done: false, partBytes: VIDEO_LIMITS.partBytes, received: VIDEO_LIMITS.partBytes });
    expect((await finish(h, org, 'anna', hash)).body).toEqual({ done: true, type: 'video/mp4', codec: 'h264' });
  });

  it('answers a part sent again with where it stands, and refuses one out of order or not yet complete', async () => {
    const bytes = twoParts();
    const hash = await sha256HexBytes(bytes);
    const { body } = await start(h, org, 'anna', hash, bytes.length);
    const part1 = bytes.subarray(0, body.partBytes);

    expect((await putPart(h, org, 'anna', hash, 2, bytes.subarray(body.partBytes))).status).toBe(409);
    expect(await putPart(h, org, 'anna', hash, 1, part1)).toEqual({ status: 200, body: { received: body.partBytes } });
    expect(await putPart(h, org, 'anna', hash, 1, part1)).toEqual({ status: 200, body: { received: body.partBytes } });
    expect((await finish(h, org, 'anna', hash)).status).toBe(409);
  });

  it('says an upload of a video the server has is done at once', async () => {
    const bytes = fixture('h264.mp4');
    const { hash } = await upload(h, org, 'anna', bytes);

    expect((await start(h, org, 'anna', hash, bytes.length)).body).toEqual({ done: true, partBytes: VIDEO_LIMITS.partBytes, received: bytes.length });
  });
});

describe.each(adapters)('%s adapter: streaming a video', (adapterName) => {
  let h: Harness;
  let org: string;
  let hash: string;
  const bytes = fixture('h264.mp4');

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => h?.close());
  beforeEach(async () => {
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'user');
    ({ hash } = await upload(h, org, 'anna', bytes));
  });

  const playUrl = async (who = org) => (await api<{ url: string; expiresAt: number }>(h, 'POST', `/api/media/${hash}/play`, { user: 'anna', org: who })).body;

  it('serves a range as 206 with its Content-Range, never kept by a cache', async () => {
    const res = await get(h, `/api/media/${hash}`, { ...auth(h, org, 'anna'), range: 'bytes=100-199' });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${bytes.length}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(100, 200));
  });

  it('serves the whole file without a range, and 416 for one past the end', async () => {
    const whole = await get(h, `/api/media/${hash}`, auth(h, org, 'anna'));
    const past = await get(h, `/api/media/${hash}`, { ...auth(h, org, 'anna'), range: `bytes=${bytes.length}-` });

    expect([whole.status, (await whole.arrayBuffer()).byteLength]).toEqual([200, bytes.length]);
    expect([past.status, past.headers.get('content-range')]).toEqual([416, `bytes */${bytes.length}`]);
  });

  it('streams to a token in the URL with no session header, as a <video src> does', async () => {
    const { url, expiresAt } = await playUrl();

    const res = await get(h, url, { range: 'bytes=0-15' });

    expect(url).toMatch(new RegExp(`^/api/play/gppl_[A-Za-z0-9_-]{43}/${hash}$`));
    expect(expiresAt).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000);
    expect([res.status, res.headers.get('cache-control')]).toEqual([206, 'no-store']);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(0, 16));
  });

  it('refuses a token for another video, a made-up token, and a token for a blob that is no video', async () => {
    const { url } = await playUrl();
    const token = url.split('/')[3]!;
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const imageHash = await sha256HexBytes(image);
    await fetch(`${h.url}/api/media/${imageHash}`, { method: 'PUT', headers: auth(h, org, 'anna'), body: image });

    expect((await get(h, `/api/play/${token}/${'e'.repeat(64)}`)).status).toBe(404);
    expect((await get(h, `/api/play/gppl_${'A'.repeat(43)}/${hash}`)).status).toBe(404);
    expect((await api(h, 'POST', `/api/media/${imageHash}/play`, { user: 'anna', org })).status).toBe(404);
  });

  it('stops streaming to a token once its session signs out', async () => {
    const { url } = await playUrl();

    await api(h, 'POST', '/api/auth/signout', { user: 'anna', org });

    expect((await get(h, url, { range: 'bytes=0-15' })).status).toBe(404);
  });

  it("gives no token for another organisation's video", async () => {
    const other = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', other, 'user');

    expect((await api(h, 'POST', `/api/media/${hash}/play`, { user: 'anna', org: other })).status).toBe(404);
  });
});

describe.each(adapters)('%s adapter: the video library', (adapterName) => {
  let h: Harness;
  let org: string;
  let anna: Device;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await anna?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await anna?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'user');
    anna = await device(h, org, 'anna', 'user');
  });

  /** A still's two pictures, kept on the device and uploaded, as an import does. */
  async function still(seed: number) {
    const bytes = new Uint8Array(200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    bytes[100] = seed;
    const hash = await storeMediaBlob(anna.client, bytes, 'image/jpeg');
    expect((await fetch(`${h.url}/api/media/${hash}`, { method: 'PUT', headers: auth(h, org, 'anna'), body: bytes })).status).toBe(204);
    return hash;
  }

  const videoArgs = (id: string, hash: string, stillHash: string) => ({
    id,
    fileName: 'Dop.mp4',
    contentType: 'video/mp4' as const,
    codec: 'h264' as const,
    hash,
    size: fixture('h264.mp4').length,
    duration: 3000,
    width: 160,
    height: 90,
    stillHash,
    thumbHash: stillHash,
    createdAt: 1,
  });

  /** Records the uploaded video on the device without its bytes, as the import does. */
  const known = (hash: string) => anna.client.localWrite([{ sql: 'INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, NULL, ?)', params: [hash, 'video/mp4', 1, Date.now()] }]);

  it('syncs one row once the video and its still are on the server, and an item that shows it', async () => {
    const { hash } = await upload(h, org, 'anna', fixture('h264.mp4'));
    const stillHash = await still(1);
    await known(hash);

    await anna.client.mutate('addVideo', videoArgs('V1', hash, stillHash));
    await anna.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await anna.client.mutate('addVideoToPresentation', { itemId: 'I1', presentationId: 'P', videoId: 'V1' });
    await anna.client.sync();

    expect(anna.client.rejected).toEqual([]);
    const dump = await serverDump(h, org, 'anna');
    expect(dump.tables.videos).toMatchObject([{ id: 'V1', file_name: 'Dop.mp4', codec: 'h264', hash, still_hash: stillHash, duration: 3000 }]);
    expect(dump.tables.presentation_items).toMatchObject([{ id: 'I1', type: 'video', source_id: 'V1', title: 'Dop.mp4' }]);
  });

  it('refuses an add whose video was never uploaded (media-missing)', async () => {
    const stillHash = await still(2);
    const hash = 'c'.repeat(64);
    await known(hash);

    await anna.client.mutate('addVideo', videoArgs('V2', hash, stillHash));
    await anna.client.sync();

    expect(anna.client.rejected.map((r) => r.error)).toEqual(['media-missing']);
  });

  it('a purged video takes its blobs with it; a trashed one still streams', async () => {
    const { hash } = await upload(h, org, 'anna', fixture('h264.mp4'));
    const stillHash = await still(3);
    await known(hash);
    await anna.client.mutate('addVideo', videoArgs('V3', hash, stillHash));
    await anna.client.mutate('trashVideo', { id: 'V3', at: 2 });
    await anna.client.sync();
    const trashed = (await get(h, `/api/media/${hash}`, auth(h, org, 'anna'))).status;

    await anna.client.mutate('purgeVideo', { id: 'V3' });
    await anna.client.sync();

    expect(trashed).toBe(200);
    expect((await get(h, `/api/media/${hash}`, auth(h, org, 'anna'))).status).toBe(404);
    expect(await h.mediaKeys()).not.toContain(mediaKey(org, stillHash));
  });
});

describe.each(adapters)('%s adapter: a video on the outputs', (adapterName) => {
  let h: Harness;
  let org: string;
  let anna: Device;
  let hash: string;
  let stillHash: string;
  /** The public output's code: a new one for each test, as a code stays with the organisation that took it first. */
  let code: string;
  const open: { close(): void }[] = [];
  const track = <T extends { close(): void }>(x: T) => (open.push(x), x);

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);
  afterAll(async () => {
    for (const x of open.splice(0)) x.close();
    await anna?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    for (const x of open.splice(0)) x.close();
    await anna?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    anna = await device(h, org, 'anna', 'admin');
    ({ hash } = await upload(h, org, 'anna', fixture('h264.mp4')));
    const bytes = new Uint8Array(200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    stillHash = await storeMediaBlob(anna.client, bytes, 'image/jpeg');
    await fetch(`${h.url}/api/media/${stillHash}`, { method: 'PUT', headers: auth(h, org, 'anna'), body: bytes });
    await anna.client.localWrite([{ sql: 'INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, NULL, ?)', params: [hash, 'video/mp4', 1, Date.now()] }]);
    await anna.client.mutate('addVideo', {
      id: 'V1', fileName: 'Dop.mp4', contentType: 'video/mp4', codec: 'h264', hash, size: 1, duration: 3000, width: 160, height: 90, stillHash, thumbHash: stillHash, createdAt: 1,
    });
    await anna.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await anna.client.mutate('addVideoToPresentation', { itemId: 'I1', presentationId: 'P', videoId: 'V1' });
    code = Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    await anna.client.mutate('createDisplay', { id: 'D1', name: 'Kyrkkaffet', code, kind: 'public' });
    await anna.client.sync();
    expect(anna.client.rejected).toEqual([]);
  });

  const playing = (position: number, video = hash): LiveVideo => ({ hash: video, type: 'video/mp4', codec: 'h264', playing: true, position, at: 0 });
  const videoCanvas = (video: LiveVideo): Canvas => ({ slide: { kind: 'media', text: '', verses: null, image: stillHash, credits: null, video }, themeId: 'classic', overlay: null });
  const still: () => PublicSlide = () => ({ kind: 'media', text: '', verses: null, image: stillHash, credits: null, themeId: 'classic', overlay: null });

  /** A temporary screen paired with S1, which `owner` presents. */
  async function pairedScreen(): Promise<string> {
    const { body } = await api<{ id: string; pin: string }>(h, 'POST', '/api/screen', { body: {} });
    expect((await api(h, 'POST', '/api/live/screens/claim', { user: 'anna', org, body: { pin: body.pin, sessionId: 'S1' } })).status).toBe(200);
    return body.id;
  }

  it("gives a screen the video's moment on the server's clock, and the server's time with it", async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen();
    const screen = track(await Viewer.open(h, id, undefined, 'screen'));
    const before = Date.now();

    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: still(), canvas: videoCanvas(playing(12.5)) }) });
    const e = (await screen.next((x) => x.type === 'canvas')) as { canvas: Canvas; now: number };

    expect(e.canvas.slide?.video).toMatchObject({ hash, playing: true, position: 12.5 });
    expect(e.canvas.slide!.video!.at).toBeGreaterThanOrEqual(before - 1000);
    expect(e.now).toBeGreaterThanOrEqual(e.canvas.slide!.video!.at);
  });

  it('streams the video on its canvas to a screen, and no other video', async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen();
    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: still(), canvas: videoCanvas(playing(0)) }) });
    await owner.sessions((s) => s[0]?.outputs.length === 1);

    const shown = await get(h, `/api/screen/${id}/video/${hash}`, { range: 'bytes=0-7' });
    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: still(), canvas: videoCanvas(playing(0, 'd'.repeat(64))), pointer: { itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 2 } }) });
    await owner.sessions((s) => s[0]?.pointer.rev === 2);

    expect(shown.status).toBe(206);
    expect((await get(h, `/api/screen/${id}/video/${hash}`)).status).toBe(404);
    expect((await get(h, `/api/screen/${id}/video/${'d'.repeat(64)}`)).status).toBe(404);
  });

  it('shows a public output the still, and never streams it the video', async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: still(), canvas: videoCanvas(playing(0)) }) });
    await owner.sessions((s) => s[0]?.outputs.length === 1);

    expect((await get(h, `/api/watch/${code}/image/${stillHash}`)).status).toBe(200);
    expect((await get(h, `/api/watch/${code}/video/${hash}`)).status).toBe(404);
  });
});

describe('a byte range', () => {
  it('reads a start and an end, an open end, and a suffix', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 });
    expect(parseRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange('bytes=-30', 100)).toEqual({ offset: 70, length: 30 });
    expect(parseRange('bytes=95-500', 100)).toEqual({ offset: 95, length: 5 });
  });

  it('serves the whole file for none, several, or a malformed one', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('lines=1-2', 100)).toBeNull();
  });

  it('cannot serve one that starts past the end', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});

describe('a folder as media storage', () => {
  it('writes an upload part by part at its offset, and reads a range of the result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-media-'));
    try {
      const disk = diskStorage(root);
      const key = mediaKey('org-1', 'a'.repeat(64));
      const id = await disk.startUpload(key);
      await disk.putPart(key, id, 2, 4, new Uint8Array([5, 6]));
      await disk.putPart(key, id, 1, 0, new Uint8Array([1, 2, 3, 4]));
      await disk.finishUpload(key, id, ['', '']);

      expect(await disk.get(key)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
      expect(await streamBytes((await disk.read(key, { offset: 2, length: 3 }))!)).toEqual(new Uint8Array([3, 4, 5]));
      expect(await disk.read(mediaKey('org-1', 'b'.repeat(64)))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
