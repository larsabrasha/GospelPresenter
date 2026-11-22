// The Linux app's media files against this server, in Docker (apps/linux/docker.sh shoot): a picture the web uploaded
// for a presentation, its thumbnail fetched once signed in and the full picture once the presentation is presented
// (media.rs over the core's `mediaPlanView`); a video item shown, its file fetched and played (player.rs over
// `playbackStepView`; its pictures looked at: playing, paused by Släck, playing on, paused by hand and staying paused). Each file the server's bytes. Only with
// GP_NATIVE_LINUX=1 and the app built; pictures in GP_NATIVE_LINUX_SHOTS, else a temporary folder.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeMediaBlob } from '@gp/sync/client';
import { device, setRole, startAdapter, type Device, type Harness } from './harness.ts';
import { imageArgs, put } from './media-fixtures.ts';
import { upload } from './video-fixtures.ts';

const docker = fileURLToPath(new URL('../../linux/docker.sh', import.meta.url));
const run = process.env.GP_NATIVE_LINUX === '1';
const file = (url: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(url, import.meta.url))));
// JPEGs that decode, so the pictures show them: the website's light screenshot the full picture, its dark one the
// thumbnail (a tile draws the full picture where it has it, else the thumbnail).
const jpeg = (name: string) => file(`fixtures/${name}`);
// Signed in and pulled; then the presentation opened (its row) and ▶ Starta, a moment for the full picture; then its
// first slide shown (a click on its tile) and a moment for the video; Släck (under the picture and its player's bar),
// the slide shown again, paused by hand, Släck and shown again. A 1440 × 900 window.
const SIGNED_IN = 'wait 25; shot pulled';
const PRESENTED = `${SIGNED_IN}; click 720 141; wait 4; click 1224 27; wait 8; shot presenting`;
const SHOWN = `${PRESENTED}; click 500 190; wait 4; shot playing; click 1250 328; wait 2; shot black; click 500 190; wait 2; shot again; `
  + 'click 1100 282; wait 1; shot paused; click 1250 328; wait 1; click 500 190; wait 2; shot still-paused';

describe.runIf(run)('the Linux app fetching and playing media files', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  /** Pictures uploaded and kept on the web device, as an import does: their hashes by name. */
  async function stored<K extends string>(alice: Device, org: string, files: Record<K, Uint8Array>) {
    const hashes = {} as Record<K, string>;
    for (const name of Object.keys(files) as K[]) {
      hashes[name] = await storeMediaBlob(alice.client, files[name], 'image/jpeg');
      expect((await put(h, org, 'alice', hashes[name], files[name])).status).toBe(204);
    }
    return hashes;
  }

  /**
   * A presentation P made on the web, its items added by `fill` (which gives each of `files` its hash); the app signed
   * in and `steps` carried out; then each file as the app holds it, null where it does not.
   */
  async function held<K extends string>(steps: string, files: Record<K, Uint8Array>, fill: (alice: Device, org: string) => Promise<Record<K, string>>) {
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    const alice = await device(h, org, 'alice', 'admin');
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Med media' });
    const hashes = await fill(alice, org);
    await alice.client.sync();
    const config = mkdtempSync(join(tmpdir(), 'gp-native-linux-media-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(config, 'shots');
    mkdirSync(shots, { recursive: true });
    const token = await setRole(h, 'bob', org, 'admin');
    const server = h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
    writeFileSync(join(config, 'session.json'), JSON.stringify({
      server, token, device: null, me: { userId: 'bob', name: 'Bob', role: 'admin', orgId: org, orgName: 'Församlingen' },
    }));
    await promisify(execFile)(docker, ['shoot', shots, process.env.GP_NATIVE_LINUX_STEPS ?? steps], { env: { ...process.env, GP_CONFIG: config }, maxBuffer: 16 << 20 });
    const at = (name: K) => join(config, 'media', hashes[name]);
    const out = Object.fromEntries((Object.keys(files) as K[]).map((name) => [name, existsSync(at(name)) ? new Uint8Array(readFileSync(at(name))) : null])) as Record<K, Uint8Array | null>;
    rmSync(config, { recursive: true, force: true });
    return out;
  }

  const picture = { full: jpeg('full.jpg'), thumb: jpeg('thumb.jpg') };
  async function withPicture(alice: Device, org: string) {
    const hashes = await stored(alice, org, picture);
    await alice.client.mutate('addImage', imageArgs('IMG', hashes.full, hashes.thumb));
    await alice.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG' });
    return hashes;
  }

  // 20 s, so it plays all through the steps.
  const video = { video: file('../../../packages/core/test/fixtures/h264-long.mp4') };
  async function withVideo(alice: Device, org: string) {
    const { still } = await stored(alice, org, { still: jpeg('thumb.jpg') });
    const uploaded = await upload(h, org, 'alice', video.video);
    // Known on the web device without its bytes, as the import records it.
    await alice.client.localWrite([{ sql: 'INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, NULL, ?)', params: [uploaded.hash, 'video/mp4', 1, Date.now()] }]);
    await alice.client.mutate('addVideo', {
      id: 'V', fileName: 'Dop.mp4', contentType: 'video/mp4', codec: 'h264', hash: uploaded.hash, size: video.video.length,
      duration: 20_000, width: 160, height: 90, stillHash: still, thumbHash: still, createdAt: 1,
    });
    await alice.client.mutate('addVideoToPresentation', { itemId: 'I1', presentationId: 'P', videoId: 'V' });
    return { video: uploaded.hash };
  }

  it("fetches a picture's thumbnail once signed in, not its full picture", async () => {
    const files = await held(SIGNED_IN, picture, withPicture);

    expect(files).toEqual({ thumb: picture.thumb, full: null });
  }, 300_000);

  it('fetches the full picture once its presentation is presented', async () => {
    const files = await held(PRESENTED, picture, withPicture);

    expect(files.full).toEqual(picture.full);
  }, 300_000);

  it('fetches a video once its item is shown', async () => {
    const files = await held(SHOWN, video, withVideo);

    expect(files.video).toEqual(video.video);
  }, 300_000);
});
