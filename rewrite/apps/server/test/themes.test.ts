// Themes of an organisation's own (docs/themes.md) against every server adapter: an admin makes, changes and deletes
// them; they sync as rows; a presentation and the default may name one; a picture of one must be uploaded first.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLASSIC, type ThemeDefinition } from '@gp/core';
import { storeMediaBlob } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { put, webp } from './media-fixtures.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const blue: ThemeDefinition = { ...CLASSIC.definition, song: { ...CLASSIC.definition.song, background: { ...CLASSIC.definition.song.background, color: '#123456' } } };

describe.each(adapters)('%s adapter: own themes', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device; // admin
  let bob: Device; // user
  const devices: Device[] = [];

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);

  afterAll(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    await h?.close();
  });

  beforeEach(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
    devices.push(alice, bob);
  });

  it('an admin’s new theme reaches every device as a row', async () => {
    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: blue, at: 1 });
    await alice.client.sync();

    await bob.client.sync();

    const [row] = (await bob.client.dump()).themes;
    expect([row?.name, JSON.parse(String(row?.definition)).song.background.color]).toEqual(['Söndag', '#123456']);
  });

  it('a user may not make a theme', async () => {
    await expect(bob.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: blue, at: 1 })).rejects.toThrow(/may not/);
  });

  it('nobody changes a built-in theme', async () => {
    await expect(alice.client.mutate('updateTheme', { id: 'classic', name: 'Mitt', at: 1 })).rejects.toThrow(/built-in/);
  });

  it('a presentation and the default may name an own theme', async () => {
    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: blue, at: 1 });
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Gudstjänst' });

    await alice.client.mutate('updatePresentation', { id: 'P', themeId: 'T' });
    await alice.client.mutate('setDefaultTheme', { themeId: 'T' });
    await alice.client.sync();

    const s = await serverDump(h, org, 'alice');
    expect([s.tables.presentations[0]?.theme_id, s.tables.org_settings[0]?.value]).toEqual(['T', 'T']);
  });

  it('deleting a theme makes its presentations and the default follow the dark theme again', async () => {
    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: blue, at: 1 });
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Gudstjänst' });
    await alice.client.mutate('updatePresentation', { id: 'P', themeId: 'T' });
    await alice.client.mutate('setDefaultTheme', { themeId: 'T' });

    await alice.client.mutate('deleteTheme', { id: 'T' });
    await alice.client.sync();

    const s = await serverDump(h, org, 'alice');
    expect([s.tables.themes, s.tables.presentations[0]?.theme_id, s.tables.org_settings]).toEqual([[], null, []]);
  });

  it('the last of two devices’ saves wins the definition', async () => {
    await setRole(h, 'dave', org, 'admin');
    const dave = await device(h, org, 'dave', 'admin');
    devices.push(dave);
    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: CLASSIC.definition, at: 1 });
    await alice.client.sync();
    await dave.client.sync();

    await dave.client.mutate('updateTheme', { id: 'T', definition: blue, at: 3 });
    await alice.client.mutate('updateTheme', { id: 'T', name: 'Kväll', at: 2 });
    await dave.client.sync();
    await alice.client.sync();

    const [row] = (await serverDump(h, org, 'alice')).tables.themes;
    expect([row?.name, JSON.parse(String(row?.definition)).song.background.color]).toEqual(['Kväll', '#123456']);
  });

  it('refuses a theme whose picture was not uploaded (media-missing)', async () => {
    const full = await storeMediaBlob(alice.client, webp('full'), 'image/webp');
    const thumb = await storeMediaBlob(alice.client, webp('thumb'), 'image/webp');
    const pictured: ThemeDefinition = { ...blue, media: { ...blue.media, image: { kind: 'picture', full, thumb } } };

    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: pictured, at: 1 });
    await alice.client.sync();

    expect(alice.client.rejected.map((r) => r.error)).toEqual(['media-missing']);
  });

  it('takes a theme whose picture was uploaded first', async () => {
    const [fullBytes, thumbBytes] = [webp('full'), webp('thumb')];
    const full = await storeMediaBlob(alice.client, fullBytes, 'image/webp');
    const thumb = await storeMediaBlob(alice.client, thumbBytes, 'image/webp');
    expect([(await put(h, org, 'alice', full, fullBytes)).status, (await put(h, org, 'alice', thumb, thumbBytes)).status]).toEqual([204, 204]);
    const pictured: ThemeDefinition = { ...blue, media: { ...blue.media, image: { kind: 'picture', full, thumb } } };

    await alice.client.mutate('createTheme', { id: 'T', name: 'Söndag', definition: pictured, at: 1 });
    await alice.client.sync();

    expect([alice.client.rejected, (await serverDump(h, org, 'alice')).tables.themes.length]).toEqual([[], 1]);
  });
});
