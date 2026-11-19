// Original, a song's parts in their own order beside its arrangements (Lars, 2026-11-19; spec 02, SONG-R58): no
// arrangement of its own but `original`, an id no arrangement has. A song's first arrangement leaves the items that
// showed its parts showing them, and an item may be given Original whatever the song's first arrangement is.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import { runMutation, type Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };
type Slide = { key: string };
type Choice = { id: string; text?: string; name?: string | null };
type Groups = { groups: { id: string; actions: { id: string; choices?: Choice[]; chosen?: string }[] }[] };

/** A presentation `p1` with the song S (parts V1, C, V2) as the item `i1`, naming no arrangement. */
async function sunday() {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, rows);
  const mutate = (name: string, args: unknown) => runMutation({ core, rows }, name, args, admin).then(() => 'ok', (e: { code?: string }) => e.code);
  await mutate('createSong', { id: 'S', name: 'Psalm' });
  for (const id of ['V1', 'C', 'V2']) await mutate('addSongPart', { id, songId: 'S', labelText: null, content: id });
  await mutate('createPresentation', { id: 'p1', name: 'Söndag' });
  await mutate('addSongToPresentation', { itemId: 'i1', presentationId: 'p1', songId: 'S' });
  const named = (itemId = 'i1') => (db.prepare('SELECT arrangement_id FROM presentation_items WHERE id = ?').get(itemId) as { arrangement_id: string | null }).arrangement_id;
  const slides = async (itemId = 'i1') => {
    const item = { id: itemId, type: 'song', title: 'Psalm', sourceId: 'S', arrangementId: named(itemId), content: null };
    const view = await core.view<Record<string, { slides: Slide[] }>>('itemSlidesView', { items: [item] }, async (sql, params) => rows(sql, params));
    return view[itemId]!.slides.map((s) => s.key);
  };
  return { mutate, named, slides };
}

describe('Original beside the arrangements', () => {
  it("keeps an item that named no arrangement on the song's parts when the song's first arrangement is made", async () => {
    const { mutate, named, slides } = await sunday();

    await mutate('createArrangement', { id: 'A', songId: 'S', partIds: ['C'] });

    expect([named(), await slides()]).toEqual(['original', ['V1', 'C', 'V2']]);
  });

  it('leaves an item added after the first arrangement on the first arrangement', async () => {
    const { mutate, named, slides } = await sunday();
    await mutate('createArrangement', { id: 'A', songId: 'S', partIds: ['C'] });

    await mutate('addSongToPresentation', { itemId: 'i2', presentationId: 'p1', songId: 'S' });
    await mutate('createArrangement', { id: 'B', songId: 'S', partIds: ['V2'] });

    expect([named('i2'), await slides('i2')]).toEqual([null, ['C']]);
  });

  it('gives an item Original when it is added or changed to it', async () => {
    const { mutate, named, slides } = await sunday();
    await mutate('createArrangement', { id: 'A', songId: 'S', partIds: ['C'] });
    await mutate('addSongToPresentation', { itemId: 'i2', presentationId: 'p1', songId: 'S', arrangementId: 'A' });

    const said = [await mutate('addSongToPresentation', { itemId: 'i3', presentationId: 'p1', songId: 'S', arrangementId: 'original' }), await mutate('setItemArrangement', { itemId: 'i2', arrangementId: 'original' })];

    expect([said, named('i3'), named('i2'), await slides('i2')]).toEqual([['ok', 'ok'], 'original', 'original', ['V1', 'C', 'V2']]);
  });

  it('shows a part added later in Original', async () => {
    const { mutate, slides } = await sunday();
    await mutate('createArrangement', { id: 'A', songId: 'S', partIds: ['C'] });

    await mutate('addSongPart', { id: 'V3', songId: 'S', labelText: null, content: 'V3' });

    expect(await slides()).toEqual(['V1', 'C', 'V2', 'V3']);
  });
});

describe("Original in an item's menu", () => {
  const menu = (arrangementId: string | null, arrangements: { id: string; name: string | null }[]) =>
    nodeRustCore().pure<Groups>('itemActionsView', { item: { id: 'i1', type: 'song', sourceId: 'S', arrangementId, overlayId: null }, song: { deletedAt: null }, arrangements, overlays: [], shownId: null });
  const arrangement = (m: Groups) => m.groups.flatMap((g) => g.actions).find((a) => a.id === 'arrangement');

  it('offers Original first beside a song with one arrangement, the arrangement chosen when the item names none', () => {
    const offered = arrangement(menu(null, [{ id: 'A', name: null }]));

    expect([offered?.choices, offered?.chosen]).toEqual([[{ id: 'original', text: 'song.original' }, { id: 'A', name: null, n: 1 }], 'A']);
  });

  it('offers no arrangements for a song that has only its parts', () => {
    expect(arrangement(menu(null, []))).toBeUndefined();
  });
});
