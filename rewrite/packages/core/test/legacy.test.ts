import { describe, expect, it } from 'vitest';
import { LEGACY_FORMAT, LEGACY_TABLES, legacyRowsProblem, pdfPages, upgradeLegacyRows, type CustomPage, type LegacyRows } from '@gp/core';

const rowsWith = (overlays: LegacyRows['overlays']) => ({ ...(Object.fromEntries(LEGACY_TABLES.map((t) => [t, []])) as unknown as LegacyRows), overlays });

describe('a 1.x export of format 1', () => {
  it("makes an overlay's text and picture a page the server takes, the picture under the text", () => {
    const image = { id: 'ov-image', file_name: 'Kollekt.webp', content_type: 'image/webp', full_hash: 'f'.repeat(64), thumb_hash: 't'.repeat(64), width: 800, height: 600, created_at: 1, deleted_at: null };
    const rows = { ...rowsWith([{ id: 'ov', title: 'Kollekt', content: 'Swish\n123', image_id: 'ov-image', sort: 0 }]), images: [image] };

    const upgraded = upgradeLegacyRows(1, rows);

    const page = JSON.parse(String(upgraded.overlays[0]!.content)) as CustomPage;
    expect([legacyRowsProblem(upgraded), page.elements.map((e) => (e.kind === 'text' ? e.text : e.kind === 'image' ? e.picture.full : e.kind))]).toEqual([null, ['f'.repeat(64), 'Swish\n123']]);
  });

  it('leaves the rows of the current format as they are', () => {
    const rows = rowsWith([]);

    expect(upgradeLegacyRows(LEGACY_FORMAT, rows)).toEqual(rows);
  });
});

describe('a 1.x export of format 5', () => {
  it('gives its items no comment, so they fit the table', () => {
    const item = { id: 'I1', presentation_id: 'P', type: 'song', title: 'Sång', source_id: 'S', sort: 0, arrangement_id: null, content: null, overlay_id: null };

    const upgraded = upgradeLegacyRows(5, { ...rowsWith([]), presentation_items: [item] });

    expect([legacyRowsProblem(upgraded), upgraded.presentation_items]).toEqual([null, [{ ...item, note: null }]]);
  });
});

const page = { full: 'a'.repeat(64), thumb: 'b'.repeat(64) };
const slideshow = { id: 'I1', name: 'Predikan.pdf', pages: JSON.stringify(pdfPages([page])), created_at: 0, updated_at: 0, deleted_at: null };
const deckItem = (content: string | null) => ({ id: 'I1', presentation_id: 'P', type: 'slides', title: 'Predikan.pdf', source_id: 'I1', sort: 0, arrangement_id: null, content, overlay_id: null });
/** The rows of a zip before format 4, with these items and decks. */
const older = (items: LegacyRows['presentation_items'], decks?: LegacyRows['custom_slides']) => {
  const rows: Record<string, unknown> = Object.fromEntries(Object.entries({ ...rowsWith([]), presentation_items: items }).filter(([t]) => t !== 'custom_slides'));
  return (decks ? { ...rows, slide_decks: decks } : rows) as Omit<LegacyRows, 'custom_slides'>;
};

describe('a 1.x export of format 2', () => {
  it("makes a deck item's pages a slideshow of the item's id, of PDF pages, which the item names", () => {
    const upgraded = upgradeLegacyRows(2, older([deckItem(JSON.stringify({ fileName: 'Predikan.pdf', pages: [page] }))]));

    expect([legacyRowsProblem(upgraded), upgraded.custom_slides, upgraded.presentation_items.map((i) => [i.type, i.source_id, i.content])]).toEqual([null, [slideshow], [['custom', 'I1', null]]]);
  });
});

describe('a 1.x export of format 3', () => {
  it('makes each deck a slideshow of PDF pages, and its item a slideshow item', () => {
    const upgraded = upgradeLegacyRows(3, older([deckItem(null)], [{ id: 'I1', name: 'Predikan.pdf', pages: JSON.stringify([page]), created_at: 0, updated_at: 0, deleted_at: null }]));

    expect([legacyRowsProblem(upgraded), upgraded.custom_slides, upgraded.presentation_items.map((i) => i.type)]).toEqual([null, [slideshow], ['custom']]);
  });
});

describe('a 1.x export of format 4', () => {
  it("makes an overlay's picture of Bilder the page's own, and a slideshow's page the current shape", () => {
    const image = { id: 'IMG', file_name: 'Kollekt.webp', content_type: 'image/webp', full_hash: 'f'.repeat(64), thumb_hash: 't'.repeat(64), width: 800, height: 600, created_at: 1, deleted_at: null };
    const element = { id: 'image', kind: 'image', x: 0, y: 0, w: 1920, h: 1080, imageId: 'IMG', fit: 'contain' };
    const content = JSON.stringify({ background: null, backgroundImageId: null, elements: [element] });
    const deck = { id: 'D', name: 'Predikan.pdf', pages: JSON.stringify([{ background: '#000000', backgroundImageId: null, backgroundPage: page, elements: [] }]), created_at: 0, updated_at: 0, deleted_at: null };
    const rows = { ...rowsWith([{ id: 'ov', title: 'Kollekt', content, image_id: null, sort: 0, updated_at: 1 }]), images: [image], custom_slides: [deck] };

    const upgraded = upgradeLegacyRows(4, rows);

    const overlay = JSON.parse(String(upgraded.overlays[0]!.content)) as CustomPage;
    expect([legacyRowsProblem(upgraded), overlay.elements[0]?.kind === 'image' && overlay.elements[0].picture]).toEqual([null, { full: 'f'.repeat(64), thumb: 't'.repeat(64) }]);
  });
});

describe('a 1.x export of any format', () => {
  it("leaves out the song parts 1.x kept of an empty ProPresenter slide's RTF header, and the arrangements' names of them", () => {
    const part = (id: string, content: string) => ({ id, song_id: 'S', sort: 0, label_id: null, content });
    const rows = {
      ...rowsWith([]),
      song_parts: [part('P1', ';;\n\\*;;'), part('P2', 'Blomma\nsten')],
      song_arrangements: [{ id: 'A', song_id: 'S', name: null, part_ids: '["P1","P2"]', sort: 0 }],
    };

    const upgraded = upgradeLegacyRows(LEGACY_FORMAT, rows);

    expect([upgraded.song_parts.map((p) => p.id), upgraded.song_arrangements.map((a) => a.part_ids)]).toEqual([['P2'], ['["P2"]']]);
  });
});
