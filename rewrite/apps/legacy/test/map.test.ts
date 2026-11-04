import { labelId, legacyOverlayPage, parseSongSnapshot } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { bibleSlideFromHtml } from '../src/bible-html.ts';
import { booksOf, mapOrg, mapUsers } from '../src/map.ts';
import { mapItems, mapPresentations } from '../src/map-presentations.ts';
import { mapArrangements, mapCcli, mapLabels, mapParts, mapVersions } from '../src/map-songs.ts';
import type { Media } from '../src/media.ts';
import type { OldData } from '../src/old-db.ts';

const at = (iso: string) => new Date(iso);

function oldData(over: Partial<OldData> = {}): OldData {
  return {
    org: { Id: 'org-1', Name: 'Testkyrkan' },
    users: [],
    logins: [],
    labels: [],
    songs: [],
    parts: [],
    arrangements: [],
    versions: [],
    ccli: [],
    presentations: [],
    items: [],
    itemParts: [],
    decks: [],
    bibles: [],
    images: [],
    audios: [],
    overlays: [],
    displays: [],
    settings: [],
    ...over,
  };
}

const noMedia = (): Media => ({ images: new Map(), audios: new Map(), overlayImages: new Map(), decks: new Map(), problems: [] });
const song = { Id: 's1', Name: 'Sång', Author: null, Publisher: 'P', Year: 1900, Ccli: '42', DeletedAt: null };
const presentation = {
  Id: 'pr1',
  Name: 'Söndag',
  UpdatedAt: at('2026-10-02T09:30:00Z'),
  IsTemplate: false,
  Description: null,
  DeletedAt: null,
  LastUsedAt: null,
  ScheduledDayOfWeek: null,
  ScheduledTime: null,
  EventDate: '2026-11-08',
  EventTime: '11:00:00',
  EventLocation: null,
  ThemeId: null,
};
const item = (over: Partial<OldData['items'][number]>) => ({ Id: 'i1', PresentationId: 'pr1', SourceId: null, Type: 0, Title: 'T', ArrangementId: null, SortOrder: 0, ...over });

describe('labels', () => {
  it('gives a label the id its text makes', () => {
    const data = oldData({ labels: [{ Id: 'old', Text: 'Vers 1', Color: '#f00', SortOrder: 3 }] });

    expect(mapLabels(data)).toEqual([{ id: labelId('Vers 1'), text: 'Vers 1', color: '#f00', sort: 0 }]);
  });

  it('makes one label of two whose texts compare equal, and points both parts at it', () => {
    const data = oldData({
      labels: [
        { Id: 'a', Text: 'Refräng', Color: '#0f0', SortOrder: 0 },
        { Id: 'b', Text: ' refräng ', Color: '#00f', SortOrder: 1 },
      ],
      songs: [song],
      parts: [
        { Id: 'p1', SongId: 's1', LabelId: 'a', Content: 'x', SortOrder: 0 },
        { Id: 'p2', SongId: 's1', LabelId: 'b', Content: 'y', SortOrder: 1 },
      ],
    });

    expect(mapLabels(data)).toHaveLength(1);
    expect(mapParts(data).map((p) => p.label_id)).toEqual([labelId('Refräng'), labelId('Refräng')]);
  });
});

describe('songs', () => {
  it('numbers a song’s parts from 0 in their old order', () => {
    const data = oldData({
      songs: [song],
      parts: [
        { Id: 'p1', SongId: 's1', LabelId: null, Content: 'a', SortOrder: 3 },
        { Id: 'p2', SongId: 's1', LabelId: null, Content: 'b', SortOrder: 7 },
      ],
    });

    expect(mapParts(data).map((p) => [p.id, p.sort])).toEqual([
      ['p1', 0],
      ['p2', 1],
    ]);
  });

  it('drops part ids an arrangement names that the song no longer has', () => {
    const data = oldData({
      songs: [song],
      parts: [{ Id: 'p1', SongId: 's1', LabelId: null, Content: 'a', SortOrder: 0 }],
      arrangements: [{ Id: 'a1', SongId: 's1', Name: null, PartIdsJson: '["p1","gone","p1"]' }],
    });

    expect(mapArrangements(data)[0]!.part_ids).toBe('["p1","p1"]');
  });

  it('keeps a version’s parts and takes the fields it lacks from the song', () => {
    const data = oldData({
      songs: [song],
      parts: [{ Id: 'p1', SongId: 's1', LabelId: null, Content: 'ny', SortOrder: 0 }],
      arrangements: [{ Id: 'a1', SongId: 's1', Name: 'Kort', PartIdsJson: '["p1"]' }],
      versions: [
        { Id: 'v1', SongId: 's1', CreatedAt: at('2026-09-01T08:00:00Z'), Name: 'Gammal', Author: 'A', PartsJson: '[{"Id":"p1","LabelId":null,"LabelText":"Vers 1","LabelColor":"#f00","Content":"gammal"}]' },
      ],
    });

    const [row] = mapVersions(data);
    const snapshot = parseSongSnapshot(String(row!.data));

    expect(row!.created_at).toBe(Date.parse('2026-09-01T08:00:00Z'));
    expect(snapshot).toEqual({
      name: 'Gammal',
      author: 'A',
      publisher: 'P',
      year: 1900,
      ccli: '42',
      parts: [{ id: 'p1', labelId: labelId('Vers 1'), labelText: 'Vers 1', labelColor: '#f00', content: 'gammal' }],
      arrangements: [{ id: 'a1', name: 'Kort', partIds: ['p1'] }],
    });
  });

  it('makes one CCLI entry of a song shown twice the same day, reported if either was', () => {
    const entry = { SongId: 's1', SongName: 'Sång', CcliNumber: '42', PresentationId: 'pr1', PresentationName: 'Söndag', Date: '2026-10-04', Reported: false, ReportedAt: null };
    const data = oldData({
      ccli: [
        { ...entry, CreatedAt: at('2026-10-04T10:00:00Z') },
        { ...entry, CreatedAt: at('2026-10-04T10:05:00Z'), Reported: true, ReportedAt: at('2026-10-10T12:00:00Z') },
      ],
    });

    const rows = mapCcli(data);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.reported_at).toBe(Date.parse('2026-10-10T12:00:00Z'));
  });
});

describe('presentations', () => {
  it('takes a template’s weekly slot and drops a theme 2.0 does not have', () => {
    const data = oldData({ presentations: [{ ...presentation, IsTemplate: true, ScheduledDayOfWeek: 0, ScheduledTime: '10:30:00', ThemeId: 'custom' }] });

    const [row] = mapPresentations(data);

    expect(row).toMatchObject({ is_template: 1, weekday: 0, time: '10:30', event_date: null, theme_id: null });
  });

  it('leaves out a song item whose song is gone, and numbers the rest from 0', () => {
    const data = oldData({
      songs: [song],
      presentations: [presentation],
      items: [item({ Id: 'gone', SourceId: 'purged', SortOrder: 3 }), item({ Id: 'kept', SourceId: 's1', SortOrder: 5 })],
    });

    const { rows, skipped } = mapItems(data, noMedia());

    expect(rows.map((r) => [r.id, r.sort])).toEqual([['kept', 0]]);
    expect(skipped).toEqual([{ presentationId: 'pr1', title: 'T', reason: 'no-song' }]);
  });

  it('keeps an item’s arrangement only when it is one of the song’s', () => {
    const data = oldData({
      songs: [song],
      arrangements: [{ Id: 'other', SongId: 's2', Name: null, PartIdsJson: '[]' }],
      presentations: [presentation],
      items: [item({ SourceId: 's1', ArrangementId: 'other' })],
    });

    expect(mapItems(data, noMedia()).rows[0]!.arrangement_id).toBeNull();
  });

  it('copies a Bible item’s slides onto it as data', () => {
    const data = oldData({
      presentations: [presentation],
      items: [item({ Type: 1 })],
      itemParts: [{ PresentationItemId: 'i1', Content: '<div class="text-left"><sup class="opacity-40">16</sup> Ty så</div>', SortOrder: 0 }],
    });

    const [row] = mapItems(data, noMedia()).rows;

    expect(JSON.parse(String(row!.content))).toEqual({ translation: '', slides: [[{ n: 16, t: 'Ty så' }]] });
  });

  it('gives a slide deck the pages its item shows, in the item’s order', () => {
    const media = noMedia();
    media.decks.set(
      'd1',
      new Map([
        [0, { full: 'f0', thumb: 't0' }],
        [1, { full: 'f1', thumb: 't1' }],
      ]),
    );
    const data = oldData({
      presentations: [presentation],
      decks: [{ Id: 'd1', FileName: 'Predikan.pdf' }],
      items: [item({ Type: 4, SourceId: 'd1' })],
      itemParts: [
        { PresentationItemId: 'i1', Content: '1', SortOrder: 0 },
        { PresentationItemId: 'i1', Content: '0', SortOrder: 1 },
      ],
    });

    const [row] = mapItems(data, media).rows;

    expect(JSON.parse(String(row!.content))).toEqual({
      fileName: 'Predikan.pdf',
      pages: [
        { full: 'f1', thumb: 't1' },
        { full: 'f0', thumb: 't0' },
      ],
    });
  });
});

describe('Bible slides', () => {
  it('reads verse numbers and decodes the text between them', () => {
    const html = '<div class="text-left"><sup class="opacity-40">16</sup> Ty så &amp; älskade <sup class="opacity-40">17</sup> Gud</div>';

    expect(bibleSlideFromHtml(html)).toEqual([
      { n: 16, t: 'Ty så & älskade' },
      { n: 17, t: 'Gud' },
    ]);
  });

  it('keeps text before the first verse number as a run without one', () => {
    expect(bibleSlideFromHtml('<div>slutet <sup>4</sup>&nbsp;början</div>')).toEqual([
      { n: null, t: 'slutet' },
      { n: 4, t: 'början' },
    ]);
  });

  it('reads plain text as one run', () => {
    expect(bibleSlideFromHtml('Herren är min herde')).toEqual([{ n: null, t: 'Herren är min herde' }]);
  });
});

describe('the rest', () => {
  it('groups a translation’s verses into books in canonical order', () => {
    const books = booksOf('[{"b":"JHN","c":3,"v":17,"t":"b"},{"b":"GEN","c":1,"v":1,"t":"g"},{"b":"JHN","c":3,"v":16,"t":"a"}]');

    expect(books).toEqual([
      { code: 'GEN', verses: [[1, 1, 'g']] },
      {
        code: 'JHN',
        verses: [
          [3, 16, 'a'],
          [3, 17, 'b'],
        ],
      },
    ]);
  });

  it('makes 1.x’s Admin and SuperAdmin admins, keeps Google subjects and lower-cases the e-mail', () => {
    const data = oldData({
      users: [
        { Id: 'u1', Name: '', Email: 'Anna@Example.com', Role: 'SuperAdmin' },
        { Id: 'u2', Name: 'Bo', Email: 'bo@example.com', Role: 'User' },
      ],
      logins: [
        { UserId: 'u1', Provider: 'google', ProviderSubjectId: 'sub-1' },
        { UserId: 'u2', Provider: 'mock', ProviderSubjectId: 'm' },
      ],
    });

    expect(mapUsers(data)).toEqual([
      { name: 'Anna@Example.com', email: 'anna@example.com', role: 'admin', google: ['sub-1'] },
      { name: 'Bo', email: 'bo@example.com', role: 'user', google: [] },
    ]);
  });

  it('makes an overlay’s own picture a library picture the overlay names', async () => {
    const media = noMedia();
    media.overlayImages.set('ov', { fullHash: 'f', thumbHash: 't', width: 800, height: 600, contentType: 'image/webp' });
    const data = oldData({ overlays: [{ Id: 'ov', Title: 'Kollekt', Content: null, HasImage: true, SortOrder: 7 }] });

    const { rows } = await mapOrg(data, media, 1000);

    expect(rows.overlays.map((o) => ({ ...o, content: JSON.parse(String(o.content)) as unknown }))).toEqual([
      { id: 'ov', title: 'Kollekt', content: legacyOverlayPage(null, 'ov-image'), image_id: null, sort: 0, updated_at: 1000 },
    ]);
    expect(rows.images).toEqual([{ id: 'ov-image', file_name: 'Kollekt.webp', content_type: 'image/webp', full_hash: 'f', thumb_hash: 't', width: 800, height: 600, created_at: 1000, deleted_at: null }]);
  });
});
