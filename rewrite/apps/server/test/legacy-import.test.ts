// The import from 1.x (docs/import-from-1x.md): the rows of an export zip written into an organisation beside what it
// has, and its users brought along, on each server adapter.
import { describe, expect, it } from 'vitest';
import { CLASSIC, DISPLAY_CODE, LEGACY_TABLES, sha256HexBytes, type LegacyRows } from '@gp/core';
import { api, setRole } from './harness.ts';
import { put, webp } from './media-fixtures.ts';
import { adapters, syncFixture } from './sync-fixture.ts';

/** A picture's columns of an edit, in a zip of today's format: none. */
const UNEDITED = { original_full_hash: null, original_thumb_hash: null, original_width: null, original_height: null, edit: null };

function rows(over: Partial<LegacyRows> = {}): LegacyRows {
  return { ...(Object.fromEntries(LEGACY_TABLES.map((t) => [t, []])) as unknown as LegacyRows), ...over };
}

const song = { id: 'song-1', name: 'Bred dina vida vingar', author: 'Lina Sandell', publisher: null, year: 1865, ccli: '123', deleted_at: null };
const part = { id: 'p-1', song_id: 'song-1', sort: 0, label_id: 'label:vers 1', content: 'Bred dina vida vingar' };
const label = { id: 'label:vers 1', text: 'Vers 1', color: '#ff0000', sort: 0 };
const presentation = {
  id: 'pres-1',
  name: 'Gudstjänst',
  event_date: '2026-11-08',
  deleted_at: null,
  theme_id: null,
  is_template: 0,
  weekday: null,
  time: '11:00',
  location: null,
  last_used_at: null,
  description: null,
  updated_at: 1,
};
const songItem = { id: 'it-1', presentation_id: 'pres-1', type: 'song', title: 'Bred dina vida vingar', source_id: 'song-1', sort: 0, arrangement_id: null, content: null, overlay_id: null, note: null };
const version = { id: 'v-1', song_id: 'song-1', user_id: '', created_at: 5, name: 'Gammal', data: '{}' };

describe.each(adapters)('%s adapter: the import from 1.x', (adapterName) => {
  const fx = syncFixture(adapterName);
  const send = (body: unknown, user = 'alice') => api<{ error?: string; detail?: string }>(fx.h, 'POST', '/api/import/legacy', { user, org: fx.org, body });

  it('writes the rows into an empty organisation, and a device pulls them', async () => {
    const r = await send(rows({ labels: [label], songs: [song], song_parts: [part], presentations: [presentation], presentation_items: [songItem] }));
    await fx.bob.client.pull();
    const dump = await fx.bob.client.dump();

    expect(r.status).toBe(200);
    expect(dump.songs).toEqual([song]);
    expect(dump.song_parts).toEqual([part]);
    expect(dump.presentation_items).toEqual([songItem]);
  });

  it('keeps the colour of a label the organisation has already', async () => {
    await send(rows({ labels: [{ ...label, color: '#123456' }] }));

    await send(rows({ labels: [{ ...label, color: '#abcdef' }] }));

    expect((await fx.server()).tables.labels.find((l) => l.id === label.id)?.color).toBe('#123456');
  });

  it('makes the importing admin the author of the old song versions', async () => {
    await send(rows({ songs: [song], song_versions: [version] }));

    expect((await fx.server()).tables.song_versions.map((v) => v.user_id)).toEqual(['alice']);
  });

  it('adds to an organisation that has songs, keeping them', async () => {
    await fx.seed();
    const before = (await fx.server()).tables.songs.map((s) => s.id);

    const r = await send(rows({ songs: [song] }));

    expect(r.status).toBe(200);
    expect((await fx.server()).tables.songs.map((s) => s.id).toSorted()).toEqual([...before, song.id].toSorted());
  });

  it('keeps a row changed since an earlier import when the zip is imported again', async () => {
    await send(rows({ songs: [song] }));

    const r = await send(rows({ songs: [{ ...song, name: 'Ett annat namn' }] }));

    expect(r.status).toBe(200);
    expect((await fx.server()).tables.songs.map((s) => s.name)).toEqual([song.name]);
  });

  it('refuses a picture whose blobs were not uploaded', async () => {
    const image = { id: 'img', file_name: 'a.webp', content_type: 'image/webp', full_hash: 'a'.repeat(64), thumb_hash: 'b'.repeat(64), width: 10, height: 10, created_at: 1, deleted_at: null, ...UNEDITED };

    expect(await send(rows({ images: [image] }))).toEqual({ status: 400, body: { error: 'missing-media', detail: `images img: no file ${'a'.repeat(64)}` } });
  });

  it('takes a picture whose blobs were uploaded first', async () => {
    const full = webp('full');
    const thumb = webp('thumb');
    const [fullHash, thumbHash] = [await sha256HexBytes(full), await sha256HexBytes(thumb)];
    await put(fx.h, fx.org, 'alice', fullHash, full);
    await put(fx.h, fx.org, 'alice', thumbHash, thumb);
    const image = { id: 'img', file_name: 'a.webp', content_type: 'image/webp', full_hash: fullHash, thumb_hash: thumbHash, width: 10, height: 10, created_at: 1, deleted_at: null, ...UNEDITED };

    expect((await send(rows({ images: [image] }))).status).toBe(200);
  });

  it("takes an own theme, a song's link and a video's row of 2.0's export, a theme's picture refused unless uploaded", async () => {
    const theme = { id: 'theme-own', name: 'Egen', definition: JSON.stringify(CLASSIC.definition), sort: 0, updated_at: 1 };
    const link = { id: 'mat-1', song_id: 'song-1', kind: 'link', title: 'Noter', url: 'https://example.com/noter', hash: null, content_type: null, size: null, sort: 0, created_at: 1 };
    const pictured = { ...CLASSIC.definition, media: { ...CLASSIC.definition.media, image: { kind: 'picture' as const, full: 'c'.repeat(64), thumb: 'd'.repeat(64) } } };

    const r = await send(rows({ themes: [theme], songs: [song], song_materials: [link] }));
    const refused = await send(rows({ themes: [{ ...theme, id: 'theme-pic', definition: JSON.stringify(pictured) }] }));

    expect([r.status, (await fx.server()).tables.themes.map((t) => t.id), (await fx.server()).tables.song_materials.map((m) => m.id), refused.body]).toEqual([
      200,
      ['theme-own'],
      ['mat-1'],
      { error: 'missing-media', detail: `themes theme-pic: no file ${'c'.repeat(64)}` },
    ]);
  });

  it('refuses a video whose file was not uploaded, and names it', async () => {
    const video = { id: 'vid', file_name: 'Dop.mp4', content_type: 'video/mp4', codec: 'h264', hash: 'e'.repeat(64), size: 10, duration: 1000, width: 16, height: 9, still_hash: 'f'.repeat(64), thumb_hash: 'f'.repeat(64), created_at: 1, deleted_at: null };

    expect(await send(rows({ videos: [video] }))).toEqual({ status: 400, body: { error: 'missing-media', detail: `videos vid: no file ${'e'.repeat(64)}` } });
  });

  it('refuses a row that does not name its table’s columns, and names it', async () => {
    const { year: _, ...withoutYear } = song;

    expect(await send(rows({ songs: [withoutYear] }))).toEqual({ status: 400, body: { error: 'invalid-rows', detail: 'songs song-1: no year' } });
  });

  it('refuses a row the database refuses, writing none of the others', async () => {
    const r = await send(rows({ songs: [song], song_parts: [{ ...part, content: null }] }));

    expect([r.status, r.body.error]).toEqual([400, 'write-failed']);
    expect((await fx.server()).tables.songs).toEqual([]);
  });

  it('refuses a user', async () => {
    expect((await send(rows({ songs: [song] }), 'bob')).status).toBe(403);
  });

  it('registers an imported public output’s code, so its page finds it', async () => {
    await send(rows({ displays: [{ id: 'd-1', name: 'Mobilerna', code: 'hjkmnpq', kind: 'public', created_at: 1 }] }));

    expect((await api(fx.h, 'GET', '/api/watch/hjkmnpq/exists')).status).toBe(200);
  });

  it('gives an output a new code when its code is not one 2.0 uses', async () => {
    const r = await send(rows({ displays: [{ id: 'd-1', name: 'Scenen', code: 'scene', kind: 'screen', created_at: 1 }] }));
    const [display] = (await fx.server()).tables.displays;

    expect(r.status).toBe(200);
    expect(String(display!.code)).toMatch(DISPLAY_CODE);
  });

  it('gives an output a new code when another output here has its code', async () => {
    await send(rows({ displays: [{ id: 'd-1', name: 'Gamla', code: 'hjkmnpq', kind: 'screen', created_at: 1 }] }));

    await send(rows({ displays: [{ id: 'd-2', name: 'Nya', code: 'hjkmnpq', kind: 'screen', created_at: 1 }] }));
    const codes = (await fx.server()).tables.displays.map((d) => d.code);

    expect(new Set(codes).size).toBe(2);
  });

  it('gives an output a new code when another organisation holds its code', async () => {
    const other = `org-${crypto.randomUUID()}`;
    await setRole(fx.h, 'alice', other, 'admin');
    const code = 'mnpqrst';
    await api(fx.h, 'POST', '/api/import/legacy', { user: 'alice', org: other, body: rows({ displays: [{ id: 'd-0', name: 'Deras', code, kind: 'public', created_at: 1 }] }) });

    await send(rows({ displays: [{ id: 'd-1', name: 'Våra', code, kind: 'public', created_at: 1 }] }));
    const [mine] = (await fx.server()).tables.displays;

    expect(mine!.code).not.toBe(code);
    expect((await api(fx.h, 'GET', `/api/watch/${String(mine!.code)}/exists`)).status).toBe(200);
  });

  describe('users', () => {
    const anna = { name: 'Anna', email: `anna-${crypto.randomUUID()}@example.com`, role: 'admin', google: [`sub-${crypto.randomUUID()}`] };
    const importUsers = (users: unknown) => api<Record<string, number>>(fx.h, 'POST', '/api/import/users', { user: 'alice', org: fx.org, body: users });

    it("invites each user with their role, as an admin's import: no account is made or linked", async () => {
      const r = await importUsers([anna]);
      const invited = await api<{ email: string; role: string }[]>(fx.h, 'GET', '/api/invitations', { user: 'alice', org: fx.org });
      const listed = await api<{ email: string }[]>(fx.h, 'GET', '/api/users', { user: 'alice', org: fx.org });

      expect(r.body).toEqual({ created: 0, member: 0, kept: 0, invited: 1, limit: 0 });
      expect(invited.body.find((u) => u.email === anna.email)?.role).toBe('admin');
      expect(listed.body.map((u) => u.email)).not.toContain(anna.email);
    });

    it("makes and links the accounts at once in a Superadmin's import, and a member elsewhere becomes one here", async () => {
      const bo = { ...anna, email: `bo-${crypto.randomUUID()}@example.com`, google: [] };
      const boss = `boss-${crypto.randomUUID()}`;
      await setRole(fx.h, boss, fx.org, 'superAdmin');
      const other = `org-${crypto.randomUUID()}`;
      await setRole(fx.h, boss, other, 'superAdmin');

      const here = await api<Record<string, number>>(fx.h, 'POST', '/api/import/users', { user: boss, org: fx.org, body: [bo] });
      const there = await api<Record<string, number>>(fx.h, 'POST', '/api/import/users', { user: boss, org: other, body: [bo] });

      expect([here.body, there.body]).toMatchObject([{ created: 1 }, { member: 1 }]);
    });

    it('leaves a member here as they are', async () => {
      const cy = { ...anna, email: `cy-${crypto.randomUUID()}@example.com`, google: [] };
      const boss = `boss-${crypto.randomUUID()}`;
      await setRole(fx.h, boss, fx.org, 'superAdmin');
      await api(fx.h, 'POST', '/api/import/users', { user: boss, org: fx.org, body: [cy] });

      expect((await importUsers([cy])).body).toMatchObject({ kept: 1 });
    });

    it('refuses a user', async () => {
      expect((await api(fx.h, 'POST', '/api/import/users', { user: 'bob', org: fx.org, body: [anna] })).status).toBe(403);
    });
  });
});
