import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import {
  can,
  DEFAULT_LABELS,
  labelDefaults,
  labelId,
  mutators,
  newer,
  orgDdl,
  songCredits,
  songSlides,
  syncedTables,
  type Label,
  type Song,
  type SongPart,
} from '../src/index.ts';

describe('schema', () => {
  it('the hand-written DDL has the columns of every Drizzle table, in order', () => {
    for (const t of syncedTables) {
      const c = getTableConfig(t);
      const ddl = orgDdl.find((s) => s.includes(`EXISTS ${c.name} (`));
      expect(ddl, c.name).toBeDefined();
      const columns = [...ddl!.matchAll(/(?:\(|,)\s*([a-z_]+) (?:TEXT|INTEGER)/g)].map((m) => m[1]);
      expect(columns).toEqual(c.columns.map((col) => col.name));
    }
  });
});

describe('permissions (spec 01)', () => {
  it('users manage songs and presentations; only admins manage users and themes', () => {
    expect(can('user', 'ManageSongs')).toBe(true);
    expect(can('user', 'ManagePresentations')).toBe(true);
    expect(can('user', 'ManageUsers')).toBe(false);
    expect(can('user', 'ManageThemes')).toBe(false);
    expect(can('admin', 'ManageUsers')).toBe(true);
    expect(can('admin', 'ManageOrganizations')).toBe(false);
    expect(can('superAdmin', 'ManageOrganizations')).toBe(true);
  });
});

describe('labels', () => {
  it('ids ignore case and extra spaces', () => {
    expect(labelId('  Verse   1 ')).toBe(labelId('verse 1'));
  });

  it('a known label gets its default colour and order; an unknown one the grey default', () => {
    expect(DEFAULT_LABELS).toHaveLength(25);
    expect(labelDefaults('chorus')).toEqual({ color: '#c73448', sort: 7 });
    expect(labelDefaults('Hymn')).toEqual({ color: '#6b7280', sort: 25 });
  });
});

describe('slides', () => {
  const song: Song = { id: 'S', name: 'Song', author: 'A. Author', publisher: 'Pub', year: 1999, ccli: null, deletedAt: null };
  const part = (id: string, sort: number, label: string | null, content = id): SongPart => ({ id, songId: 'S', sort, labelId: label, content });

  it('credits drop missing pieces and are null when there are none', () => {
    expect(songCredits(song)).toBe('A. Author · © Pub · 1999');
    expect(songCredits({ author: null, publisher: 'Pub', year: null })).toBe('© Pub');
    expect(songCredits({ author: ' ', publisher: null, year: 0 })).toBeNull();
  });

  it('one slide per part, in part order, with the label', () => {
    const verse: Label = { id: 'label:verse', text: 'Verse', color: '#3478c7', sort: 0 };
    const slides = songSlides(song, [part('b', 1, null), part('a', 0, 'label:verse'), { ...part('x', 0, null), songId: 'other' }], new Map([[verse.id, verse]]));
    expect(slides.map((s) => [s.key, s.label?.text ?? null])).toEqual([
      ['a', 'Verse'],
      ['b', null],
    ]);
    expect(slides[0]!.credits).toBe('A. Author · © Pub · 1999');
  });
});

describe('mutator arguments', () => {
  it('names are trimmed and must not be blank; blank optional text becomes null', () => {
    expect(mutators.createSong.args.parse({ id: 'S', name: '  Hi  ', author: '  ' })).toEqual({ id: 'S', name: 'Hi', author: null });
    expect(mutators.createSong.args.safeParse({ id: 'S', name: '   ' }).success).toBe(false);
    expect(mutators.updateSong.args.safeParse({ id: 'S', year: 10000 }).success).toBe(false);
    expect(mutators.updateSong.args.safeParse({ id: 'S', ccli: 'x'.repeat(21) }).success).toBe(false);
    expect(mutators.addSongPart.args.safeParse({ id: 'P', songId: 'S', labelText: null, content: 'x'.repeat(5001) }).success).toBe(false);
  });
});

describe('live pointer', () => {
  it('the higher revision wins, whatever order the messages arrive in', () => {
    const a = { presentationId: 'P', itemId: 'I1', partIndex: 0, black: false, rev: 1 };
    const b = { ...a, partIndex: 1, rev: 2 };
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
  });
});
