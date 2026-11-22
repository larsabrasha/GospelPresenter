// The Linux app's media files against this server, in Docker (apps/linux/docker.sh shoot; media.rs over the core's
// `mediaPlanView`): a picture the web uploaded for a presentation, its thumbnail fetched once signed in and the full
// picture once the presentation is presented, each the server's bytes. Only with GP_NATIVE_LINUX=1 and the app built;
// pictures in GP_NATIVE_LINUX_SHOTS, else a temporary folder.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeMediaBlob } from '@gp/sync/client';
import { device, setRole, startAdapter, type Harness } from './harness.ts';
import { imageArgs, put } from './media-fixtures.ts';

const docker = fileURLToPath(new URL('../../linux/docker.sh', import.meta.url));
const run = process.env.GP_NATIVE_LINUX === '1';
// JPEGs that decode, so the pictures show them: the website's light screenshot the full picture, its dark one the
// thumbnail (a tile draws the full picture where it has it, else the thumbnail).
const jpeg = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))));
// Signed in and pulled; then the presentation opened (its row) and ▶ Starta, a moment for the full picture. A 1440 × 900
// window.
const SIGNED_IN = 'wait 25; shot pulled';
const PRESENTED = `${SIGNED_IN}; click 720 141; wait 4; click 1224 27; wait 8; shot presenting`;

describe.runIf(run)('the Linux app fetching media files', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  /** The app signed in, `steps` carried out; then the picture's two files as the app holds them, null where it does not. */
  async function held(steps: string) {
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    const alice = await device(h, org, 'alice', 'admin');
    const picture = { full: jpeg('full.jpg'), thumb: jpeg('thumb.jpg'), fullHash: '', thumbHash: '' };
    picture.fullHash = await storeMediaBlob(alice.client, picture.full, 'image/jpeg');
    picture.thumbHash = await storeMediaBlob(alice.client, picture.thumb, 'image/jpeg');
    for (const [hash, bytes] of [[picture.fullHash, picture.full], [picture.thumbHash, picture.thumb]] as const) {
      expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);
    }
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Med bild' });
    await alice.client.mutate('addImage', imageArgs('IMG', picture.fullHash, picture.thumbHash));
    await alice.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG' });
    await alice.client.sync();
    const config = mkdtempSync(join(tmpdir(), 'gp-native-linux-media-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(config, 'shots');
    mkdirSync(shots, { recursive: true });
    const token = await setRole(h, 'bob', org, 'admin');
    const server = h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
    writeFileSync(join(config, 'session.json'), JSON.stringify({
      server, token, device: null, me: { userId: 'bob', name: 'Bob', role: 'admin', orgId: org, orgName: 'Församlingen' },
    }));
    await promisify(execFile)(docker, ['shoot', shots, steps], { env: { ...process.env, GP_CONFIG: config }, maxBuffer: 16 << 20 });
    const file = (hash: string) => existsSync(join(config, 'media', hash)) ? new Uint8Array(readFileSync(join(config, 'media', hash))) : null;
    const files = { thumb: file(picture.thumbHash), full: file(picture.fullHash) };
    rmSync(config, { recursive: true, force: true });
    return { files, picture };
  }

  it("fetches a picture's thumbnail once signed in, not its full picture", async () => {
    const { files, picture } = await held(SIGNED_IN);

    expect(files).toEqual({ thumb: picture.thumb, full: null });
  }, 300_000);

  it('fetches the full picture once its presentation is presented', async () => {
    const { files, picture } = await held(PRESENTED);

    expect(files.full).toEqual(picture.full);
  }, 300_000);
});
