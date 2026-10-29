import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import {
  arrangedParts,
  assignableRoles,
  can,
  createUserRefusal,
  emailSchema,
  inviteRefusal,
  isCallbackScheme,
  removeUserRefusal,
  roleChangeRefusal,
  daysRemaining,
  DEFAULT_LABELS,
  highlight,
  labelDefaults,
  labelId,
  applyLiveChange,
  mutators,
  newer,
  orgDdl,
  orgMigrations,
  orgSchemaPlan,
  parsePartIds,
  parseSlidesContent,
  SCHEMA_BASELINE,
  SCHEMA_VERSION,
  slideDeckSlides,
  searchSongs,
  songCredits,
  songSlides,
  syncedTables,
  type Label,
  type LivePointer,
  type LivePointerChange,
  type Song,
  type SongArrangement,
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

  it('a new database gets the current DDL and its version', () => {
    expect(orgSchemaPlan(null, false)).toEqual([...orgDdl, `INSERT OR REPLACE INTO _schema (one, version) VALUES (1, ${SCHEMA_VERSION})`]);
  });

  it('a current database is left as it is', () => {
    expect(orgSchemaPlan(SCHEMA_VERSION, true)).toEqual([]);
  });

  it('a database from before the baseline is refused, with or without a version row', () => {
    expect(() => orgSchemaPlan(null, true)).toThrow(/made before this app's first/);
    expect(() => orgSchemaPlan(SCHEMA_BASELINE - 1, true)).toThrow(/made before this app's first/);
  });

  it('a database newer than the app is refused', () => {
    expect(() => orgSchemaPlan(SCHEMA_VERSION + 1, true)).toThrow(/newer than this app/);
  });

  it('every version above the baseline has its migration', () => {
    for (let v = SCHEMA_BASELINE + 1; v <= SCHEMA_VERSION; v++) expect(orgMigrations[v], `migration to ${v}`).toBeDefined();
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

describe('account policy (spec 01, D20, D21)', () => {
  const su = { id: 'su', role: 'superAdmin' as const };
  const ad = { id: 'ad', role: 'admin' as const };
  const us = { id: 'us', role: 'user' as const };

  it('only a SuperAdmin hands out or takes away SuperAdmin (PERM-R4, D20)', () => {
    expect(assignableRoles('admin')).toEqual(['user', 'admin']);
    expect(assignableRoles('superAdmin')).toEqual(['user', 'admin', 'superAdmin']);
    expect(createUserRefusal('admin', 'superAdmin')).toBe('super-admin-only');
    expect(createUserRefusal('user', 'user')).toBe('forbidden');
    expect(roleChangeRefusal(ad, su, 'user')).toBe('super-admin-only');
    expect(roleChangeRefusal(ad, us, 'superAdmin')).toBe('super-admin-only');
    expect(roleChangeRefusal(ad, us, 'admin')).toBeNull();
    expect(roleChangeRefusal(su, { id: 'su2', role: 'superAdmin' }, 'admin')).toBeNull();
  });

  it('nobody changes their own role or removes themselves (PERM-R5, R6), so a SuperAdmin always remains', () => {
    expect(roleChangeRefusal(su, su, 'admin')).toBe('own-role');
    expect(removeUserRefusal(su, su)).toBe('own-account');
    expect(removeUserRefusal(ad, su)).toBe('super-admin-only');
    expect(removeUserRefusal(us, ad)).toBe('forbidden');
    expect(removeUserRefusal(ad, us)).toBeNull();
  });

  it('an invite resets the linked Google account: an Admin may not make one for a SuperAdmin (D21)', () => {
    expect(inviteRefusal(ad, su)).toBe('super-admin-only');
    expect(inviteRefusal(us, us)).toBe('forbidden');
    expect(inviteRefusal(ad, ad)).toBeNull();
    expect(inviteRefusal(su, ad)).toBeNull();
  });

  it('emails are trimmed and lower-cased', () => {
    expect(emailSchema.parse('  Anna@Kyrkan.SE ')).toBe('anna@kyrkan.se');
    expect(emailSchema.safeParse('bo@').success).toBe(false);
    expect(emailSchema.safeParse('bo@x').success).toBe(false);
  });

  it('AUTH-R10: callback schemes are compared exactly and case-sensitively', () => {
    for (const s of ['gospelpresenter', 'gospelpresenter-test', 'gospelpresenter-local']) expect(isCallbackScheme(s)).toBe(true);
    for (const s of ['GospelPresenter', 'gospelpresenter ', 'evil', 'gospelpresenter-local:', '', 'https', null, undefined]) {
      expect(isCallbackScheme(s), String(s)).toBe(false);
    }
  });

  it('an unknown role has no permissions', () => {
    expect(can('constructor' as never, 'ViewSongs')).toBe(false);
    expect(can('admin', 'ViewUsers')).toBe(true);
    expect(can('admin', 'AssignSuperAdminRole')).toBe(false);
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

describe('arrangements (SONG-R18, R19)', () => {
  const song: Song = { id: 'S', name: 'Song', author: null, publisher: null, year: null, ccli: null, deletedAt: null };
  const parts: SongPart[] = ['V1', 'C', 'V2'].map((id, sort) => ({ id, songId: 'S', sort, labelId: null, content: id }));
  const arr = (id: string, sort: number, ids: string[], songId = 'S'): SongArrangement => ({ id, songId, name: null, partIds: JSON.stringify(ids), sort });
  const order = (a: SongArrangement[], item: string | null = null) => arrangedParts(song, parts, a, item).map((p) => p.id);

  it('no arrangement: all parts in part order', () => {
    expect(order([])).toEqual(['V1', 'C', 'V2']);
  });

  it("the item's arrangement wins, else the song's first (by sort), with repeats kept and deleted parts skipped", () => {
    const arrangements = [arr('B', 1, ['V2']), arr('A', 0, ['V1', 'C', 'V2', 'C', 'GONE']), arr('X', 0, ['V1'], 'other')];
    expect(order(arrangements)).toEqual(['V1', 'C', 'V2', 'C']);
    expect(order(arrangements, 'B')).toEqual(['V2']);
  });

  it("an arrangement id that is not one of the song's shows all parts", () => {
    expect(order([arr('A', 0, ['C'])], 'DELETED')).toEqual(['V1', 'C', 'V2']);
    expect(order([arr('X', 0, ['V1'], 'other')], 'X')).toEqual(['V1', 'C', 'V2']);
  });

  it('a repeated part gets a slide key of its own', () => {
    const slides = songSlides(song, parts, new Map(), [arr('A', 0, ['C', 'V1', 'C'])]);
    expect(slides.map((s) => s.key)).toEqual(['C', 'V1', 'C#1']);
  });

  it('part ids that are not a JSON list of strings read as empty', () => {
    expect(parsePartIds('nonsense')).toEqual([]);
    expect(parsePartIds('{"a":1}')).toEqual([]);
    expect(parsePartIds('["a",2,"b"]')).toEqual(['a', 'b']);
  });
});

describe('search (SONG-R30–R33)', () => {
  const lib = [
    { name: 'Det är saligt', author: 'Lina Sandell', firstPart: 'Det är saligt att vandra', lyrics: 'Det är saligt att vandra\ni evighet' },
    { name: 'Högst av allt', author: null, firstPart: 'Du är högst', lyrics: 'Du är högst' },
    { name: 'Majestät', author: null, firstPart: 'Majestät', lyrics: 'Majestät\nvi böjer knä' },
    { name: 'Vi vill se Gud', author: null, firstPart: 'Vi vill se', lyrics: 'Vi vill se' },
  ];
  const names = (q: string) => searchSongs(lib, q).map((s) => s.name);

  it('SONG-A19', () => {
    expect(names('hogst av allt')[0]).toBe('Högst av allt');
    expect(names('vighet')).toEqual([]);
    expect(names('evig')).toEqual(['Det är saligt']);
    expect(names('kna')).toEqual(['Majestät']);
    expect(names('vi vill se')[0]).toBe('Vi vill se Gud');
    expect(names('gud xyz')).toEqual([]);
  });

  it('a blank query is the whole library in its order; the author is searched', () => {
    expect(names('  ')).toEqual(lib.map((s) => s.name));
    expect(names('sandell')).toEqual(['Det är saligt']);
  });

  it('a title hit outranks a lyrics hit, and ties keep library order', () => {
    expect(names('majestät')).toEqual(['Majestät']);
    expect(names('du')).toEqual(['Högst av allt']);
    expect(names('vi')).toEqual(['Vi vill se Gud', 'Majestät']);
  });

  it('decomposed (macOS) text matches composed queries', () => {
    expect(searchSongs([{ ...lib[1]!, name: 'Högst av allt'.normalize('NFD') }], 'högst')).toHaveLength(1);
  });

  it('highlights the word prefixes that matched, accents or not', () => {
    expect(highlight('Högst av allt', 'hog al')).toEqual([
      { text: 'Hög', hit: true },
      { text: 'st av ', hit: false },
      { text: 'al', hit: true },
      { text: 'lt', hit: false },
    ]);
    expect(highlight('evighet', 'vig')).toEqual([{ text: 'evighet', hit: false }]);
  });
});

describe('trash', () => {
  it('days remaining are 30 minus whole days, never below 0 (SONG-R26)', () => {
    const day = 86_400_000;
    expect(daysRemaining(0, 0)).toBe(30);
    expect(daysRemaining(0, day - 1)).toBe(30);
    expect(daysRemaining(0, day)).toBe(29);
    expect(daysRemaining(0, 30 * day)).toBe(0);
    expect(daysRemaining(0, 45 * day)).toBe(0);
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

  it('arrangement names are trimmed, blank is no name, at most 100 (SONG-R16, R9)', () => {
    expect(mutators.createArrangement.args.parse({ id: 'A', songId: 'S', name: '  Kort ', partIds: [] }).name).toBe('Kort');
    expect(mutators.updateArrangement.args.parse({ id: 'A', name: '   ' }).name).toBeNull();
    expect(mutators.updateArrangement.args.safeParse({ id: 'A', name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('item titles are trimmed and never blank; dates are ISO dates or null', () => {
    expect(mutators.renameItem.args.parse({ itemId: 'I', title: ' Psalm ' }).title).toBe('Psalm');
    expect(mutators.renameItem.args.safeParse({ itemId: 'I', title: '  ' }).success).toBe(false);
    expect(mutators.updatePresentation.args.safeParse({ id: 'P', eventDate: '2026-11-01' }).success).toBe(true);
    expect(mutators.updatePresentation.args.safeParse({ id: 'P', eventDate: null }).success).toBe(true);
    expect(mutators.updatePresentation.args.safeParse({ id: 'P', eventDate: '1 nov' }).success).toBe(false);
  });
});

describe('live pointer', () => {
  // TODO.md "Overlays": A carries overlay O, B carries none, C carries O too. P is another overlay.
  const carried: Record<string, string | null> = { A: 'O', B: null, C: 'O' };
  const overlayOf = (itemId: string) => carried[itemId] ?? null;
  const at = (change: Partial<LivePointer>): LivePointer => ({ presentationId: 'P1', itemId: null, partIndex: 0, black: false, overlayId: null, rev: 1, ...change });
  const apply = (p: LivePointer, change: LivePointerChange) => applyLiveChange(p, change, overlayOf).overlayId;

  it("an item's overlay switches on when it goes live and off when it leaves", () => {
    expect(apply(at({}), { itemId: 'A', partIndex: 0 })).toBe('O');
    expect(apply(at({ itemId: 'A', overlayId: 'O' }), { partIndex: 1 })).toBe('O');
    expect(apply(at({ itemId: 'A', overlayId: 'O' }), { itemId: 'B', partIndex: 0 })).toBeNull();
    // Two items with the same overlay: it stays on.
    expect(apply(at({ itemId: 'A', overlayId: 'O' }), { itemId: 'C', partIndex: 0 })).toBe('O');
  });

  it('a manual off lasts until the item changes; back on the item, its overlay comes on again', () => {
    const off = applyLiveChange(at({ itemId: 'A', overlayId: 'O' }), { overlayId: null }, overlayOf);
    expect(off.overlayId).toBeNull();
    expect(apply({ ...off, rev: 2 }, { partIndex: 1 })).toBeNull();
    expect(apply(at({ itemId: 'B' }), { itemId: 'A', partIndex: 0 })).toBe('O');
  });

  it('a manual overlay stays when the item that carried another one is left, and the new item overrides it', () => {
    expect(apply(at({ itemId: 'A', overlayId: 'P' }), { itemId: 'B', partIndex: 0 })).toBe('P');
    expect(apply(at({ itemId: 'B', overlayId: 'P' }), { itemId: 'C', partIndex: 0 })).toBe('O');
  });

  it('Rensa and stopping switch the overlay off; showing one ends the black screen', () => {
    expect(applyLiveChange(at({ itemId: 'A', overlayId: 'O' }), { black: true }, overlayOf)).toMatchObject({ black: true, overlayId: null });
    // Back from black on the same item: the overlay stays off, as after a manual off.
    expect(apply(at({ itemId: 'A', black: true }), { partIndex: 1, black: false })).toBeNull();
    expect(apply(at({ itemId: 'A', overlayId: 'O' }), { presentationId: null, itemId: null })).toBeNull();
    expect(applyLiveChange(at({ itemId: 'B', black: true }), { overlayId: 'P' }, overlayOf)).toMatchObject({ black: false, overlayId: 'P' });
  });


  it('the higher revision wins, whatever order the messages arrive in', () => {
    const a = { presentationId: 'P', itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 1 };
    const b = { ...a, partIndex: 1, rev: 2 };
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
  });
});

describe('slide decks', () => {
  const page = (n: number) => ({ full: String(n).repeat(64).slice(0, 64), thumb: String(n + 1).repeat(64).slice(0, 64) });

  it('shows each page as a picture filling the stage, in order', () => {
    const slides = slideDeckSlides({ fileName: 'Predikan.pdf', pages: [page(1), page(3)] });

    expect(slides.map((s) => [s.key, s.kind, s.image, s.text])).toEqual([
      ['s0', 'media', page(1).full, ''],
      ['s1', 'media', page(3).full, ''],
    ]);
  });

  it('reads stored content back, and nothing from content that is not a deck', () => {
    const content = { fileName: 'Predikan.pdf', pages: [page(1)] };

    expect(parseSlidesContent(JSON.stringify(content))).toEqual(content);
    expect(parseSlidesContent('{"translation":"SFB","slides":[]}')).toBeNull();
    expect(parseSlidesContent('not json')).toBeNull();
    expect(parseSlidesContent(null)).toBeNull();
  });

  it('refuses an add of more than 100 pages or of none (PRES-R11)', () => {
    const args = (n: number) => ({ itemId: 'I', presentationId: 'P', fileName: 'x.pdf', pages: Array.from({ length: n }, () => page(1)) });

    expect(mutators.addSlides.args.safeParse(args(100)).success).toBe(true);
    expect(mutators.addSlides.args.safeParse(args(101)).success).toBe(false);
    expect(mutators.addSlides.args.safeParse(args(0)).success).toBe(false);
  });
});
