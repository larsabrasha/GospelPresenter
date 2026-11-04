import { describe, expect, it } from 'vitest';
import { LEGACY_FORMAT, LEGACY_TABLES, legacyRowsProblem, pdfPages, upgradeLegacyRows, type CustomPage, type LegacyRows } from '@gp/core';

const rowsWith = (overlays: LegacyRows['overlays']) => ({ ...(Object.fromEntries(LEGACY_TABLES.map((t) => [t, []])) as unknown as LegacyRows), overlays });

describe('a 1.x export of format 1', () => {
  it("makes an overlay's text and picture a page the server takes, the picture under the text", () => {
    const rows = rowsWith([{ id: 'ov', title: 'Kollekt', content: 'Swish\n123', image_id: 'ov-image', sort: 0 }]);

    const upgraded = upgradeLegacyRows(1, rows);

    const page = JSON.parse(String(upgraded.overlays[0]!.content)) as CustomPage;
    expect([legacyRowsProblem(upgraded), page.elements.map((e) => (e.kind === 'text' ? e.text : e.kind === 'image' ? e.imageId : e.kind))]).toEqual([null, ['ov-image', 'Swish\n123']]);
  });

  it('leaves the rows of the current format as they are', () => {
    const rows = rowsWith([]);

    expect(upgradeLegacyRows(LEGACY_FORMAT, rows)).toEqual(rows);
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
