// The import from 1.x (docs/import-from-1x.md): the rows of an export zip written into an organisation beside what it
// has, and its users brought along, on each server adapter.
import { describe, expect, it } from 'vitest';
import { LEGACY_TABLES, sha256HexBytes, type LegacyRows } from '@gp/core';
import { api, setRole } from './harness.ts';
import { put, webp } from './media-fixtures.ts';
import { adapters, syncFixture } from './sync-fixture.ts';

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
const songItem = { id: 'it-1', presentation_id: 'pres-1', type: 'song', title: 'Bred dina vida vingar', source_id: 'song-1', sort: 0, arrangement_id: null, content: null, overlay_id: null };
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
    const image = { id: 'img', file_name: 'a.webp', content_type: 'image/webp', full_hash: 'a'.repeat(64), thumb_hash: 'b'.repeat(64), width: 10, height: 10, created_at: 1, deleted_at: null };

    expect(await send(rows({ images: [image] }))).toEqual({ status: 400, body: { error: 'missing-media', detail: `images img: no file ${'a'.repeat(64)}` } });
  });

  it('takes a picture whose blobs were uploaded first', async () => {
    const full = webp('full');
    const thumb = webp('thumb');
    const [fullHash, thumbHash] = [await sha256HexBytes(full), await sha256HexBytes(thumb)];
    await put(fx.h, fx.org, 'alice', fullHash, full);
    await put(fx.h, fx.org, 'alice', thumbHash, thumb);
    const image = { id: 'img', file_name: 'a.webp', content_type: 'image/webp', full_hash: fullHash, thumb_hash: thumbHash, width: 10, height: 10, created_at: 1, deleted_at: null };

    expect((await send(rows({ images: [image] }))).status).toBe(200);
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

    it('creates a user with their role, and says so', async () => {
      const r = await importUsers([anna]);
      const listed = await api<{ email: string; role: string }[]>(fx.h, 'GET', '/api/users', { user: 'alice', org: fx.org });

      expect(r.body).toEqual({ created: 1, member: 0, kept: 0, limit: 0 });
      expect(listed.body.find((u) => u.email === anna.email)?.role).toBe('admin');
    });

    it('makes a user who has an account in another organisation a member here', async () => {
      const elsewhere = { ...anna, email: `bo-${crypto.randomUUID()}@example.com`, google: [] };
      await importUsers([elsewhere]);
      const other = `org-${crypto.randomUUID()}`;
      await setRole(fx.h, 'alice', other, 'admin');

      const r = await api<Record<string, number>>(fx.h, 'POST', '/api/import/users', { user: 'alice', org: other, body: [elsewhere] });

      expect(r.body).toMatchObject({ member: 1 });
    });

    it('leaves a member here as they are', async () => {
      const once = { ...anna, email: `cy-${crypto.randomUUID()}@example.com`, google: [] };
      await importUsers([once]);

      expect((await importUsers([once])).body).toMatchObject({ kept: 1 });
    });

    it('refuses a user', async () => {
      expect((await api(fx.h, 'POST', '/api/import/users', { user: 'bob', org: fx.org, body: [anna] })).status).toBe(403);
    });
  });
});
