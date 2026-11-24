import { describe, expect, it } from 'vitest';
import {
  accountRefusal,
  can,
  emailSchema,
  inviteRequest,
  isCallbackScheme,
  removeUserRefusal,
  roleChangeRefusal,
  updateUserRequest,
  daysRemaining,
  DEFAULT_LABELS,
  labelId,
  newer,
  parsePartIds,
  pdfPages,
  prepareSong,
  rankSongs,
} from '../src/index.ts';
import { searchMarks } from '../src/core.ts';

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

describe('account policy (spec 01, docs/accounts-and-roles.md)', () => {
  const su = { id: 'su', role: 'superAdmin' as const };
  const ad = { id: 'ad', role: 'admin' as const };
  const us = { id: 'us', role: 'user' as const };

  it('a membership is a User or an Admin; Superadmin is no role to give', () => {
    expect(inviteRequest.safeParse({ email: 'a@x.se', role: 'superAdmin' }).success).toBe(false);
    expect(inviteRequest.parse({ email: ' A@X.se ', role: 'admin', language: 'de' })).toEqual({ email: 'a@x.se', role: 'admin', language: 'sv' });
  });

  it('nobody changes their own role or removes themselves (PERM-R5, R6)', () => {
    expect(roleChangeRefusal(ad, ad, 'user', 2)).toBe('own-role');
    expect(removeUserRefusal(ad, ad, 2)).toBe('own-account');
    expect(removeUserRefusal(us, ad, 2)).toBe('forbidden');
    expect(removeUserRefusal(ad, us, 1)).toBeNull();
    expect(roleChangeRefusal(ad, us, 'admin', 1)).toBeNull();
  });

  it("a Superadmin's membership is removed only by a Superadmin: an Admin would delete their account", () => {
    const target = { id: 'su2', role: 'admin' as const, superAdmin: true };

    expect([removeUserRefusal(ad, target, 2), removeUserRefusal(su, target, 2)]).toEqual(['super-admin-only', null]);
  });

  it('the last Admin stays one: never made a User, never removed', () => {
    expect(roleChangeRefusal(su, ad, 'user', 1)).toBe('last-admin');
    expect(removeUserRefusal(su, ad, 1)).toBe('last-admin');
    expect(roleChangeRefusal(ad, { id: 'ad2', role: 'admin' }, 'user', 2)).toBeNull();
    expect(roleChangeRefusal(su, ad, 'admin', 1)).toBeNull();
  });

  it("someone else's account is a Superadmin's; on a desktop host an Admin's too for one only the host has, unless a Superadmin", () => {
    expect(accountRefusal(su, { hostOnly: false, superAdmin: true })).toBeNull();
    expect(accountRefusal(ad, { hostOnly: false, superAdmin: false })).toBe('super-admin-only');
    expect(accountRefusal(ad, { hostOnly: true, superAdmin: false })).toBeNull();
    expect(accountRefusal(ad, { hostOnly: true, superAdmin: true })).toBe('super-admin-only');
    expect(accountRefusal(us, { hostOnly: true, superAdmin: false })).toBe('forbidden');
  });

  it('a user update needs at least one field; a null e-mail clears it', () => {
    expect(updateUserRequest.safeParse({}).success).toBe(false);
    expect(updateUserRequest.parse({ email: null })).toEqual({ email: null });
    expect(updateUserRequest.parse({ name: ' Bo ', email: 'Bo@X.se' })).toEqual({ name: 'Bo', email: 'bo@x.se' });
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
    expect(can('admin', 'ManageOrganizations')).toBe(false);
  });
});

describe('labels', () => {
  it('ids ignore case and extra spaces', () => {
    expect(labelId('  Verse   1 ')).toBe(labelId('verse 1'));
  });

  it('has 25 defaults', () => {
    expect(DEFAULT_LABELS).toHaveLength(25);
  });
});

// A song's slides, credits and arrangements are the Rust core's, tested in packages/rust-core/test/song-slides.test.ts.
describe('arrangements (SONG-R18, R19)', () => {
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
  const search = <T extends (typeof lib)[number]>(songs: T[], q: string) => rankSongs(songs, prepareSong, q);
  const names = (q: string) => search(lib, q).map((s) => s.name);

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

  it('a phrase that runs over a line break in the lyrics ranks as a phrase', () => {
    // Both have every word in the first part; only one has them as the phrase, over its line break.
    const songs = [
      { name: 'Annan', author: null, firstPart: 'Ett ord i sänder\nett ögonblick', lyrics: 'Ett ord i sänder\nett ögonblick' },
      { name: 'Blott en dag', author: null, firstPart: 'Blott en dag, ett\nögonblick i sänder', lyrics: 'Blott en dag, ett\nögonblick i sänder' },
    ];

    const hits = rankSongs(songs, prepareSong, 'ett ögonblick i sänder').map((s) => s.name);

    expect(hits).toEqual(['Blott en dag', 'Annan']);
  });

  it('decomposed (macOS) text matches composed queries', () => {
    expect(search([{ ...lib[1]!, name: 'Högst av allt'.normalize('NFD') }], 'högst')).toHaveLength(1);
  });

  it('highlights the word prefixes that matched, accents or not', () => {
    expect(searchMarks('Högst av allt', 'hog al')).toEqual([
      { text: 'Hög', hit: true },
      { text: 'st av ', hit: false },
      { text: 'al', hit: true },
      { text: 'lt', hit: false },
    ]);
    expect(searchMarks('evighet', 'vig')).toEqual([{ text: 'evighet', hit: false }]);
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


// The pointer's overlay rules and one presentation at a time are the Rust core's (packages/rust-core/test/live-state.test.ts).
describe('live pointer', () => {
  it('the higher revision wins, whatever order the messages arrive in', () => {
    const a = { presentationId: 'P', itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 1 };
    const b = { ...a, partIndex: 1, rev: 2 };
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
  });
});

describe('PDFs', () => {
  const page = (n: number) => ({ full: String(n).repeat(64).slice(0, 64), thumb: String(n + 1).repeat(64).slice(0, 64) });

  it("makes each page a slideshow's page with the PDF's page as its picture on black, in order", () => {
    const pages = pdfPages([page(1), page(3)]);

    expect(pages.map((p) => [p.background, p.backgroundPage, p.elements])).toEqual([
      ['#000000', page(1), []],
      ['#000000', page(3), []],
    ]);
  });
});
