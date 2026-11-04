import { describe, expect, it } from 'vitest';
import { LEGACY_FORMAT, LEGACY_TABLES, legacyRowsProblem, upgradeLegacyRows, type CustomPage, type LegacyRows } from '@gp/core';

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

describe('a 1.x export of format 2', () => {
  it("makes a deck item's pages a deck of the item's id, which the item names", () => {
    const page = { full: 'a'.repeat(64), thumb: 'b'.repeat(64) };
    const item = { id: 'I1', presentation_id: 'P', type: 'slides', title: 'Predikan.pdf', source_id: 'I1', sort: 0, arrangement_id: null, content: JSON.stringify({ fileName: 'Predikan.pdf', pages: [page] }), overlay_id: null };
    const older = Object.fromEntries(Object.entries({ ...rowsWith([]), presentation_items: [item] }).filter(([t]) => t !== 'slide_decks')) as Omit<LegacyRows, 'slide_decks'>;

    const upgraded = upgradeLegacyRows(2, older);

    expect([legacyRowsProblem(upgraded), upgraded.slide_decks, upgraded.presentation_items[0]?.content]).toEqual([
      null,
      [{ id: 'I1', name: 'Predikan.pdf', pages: JSON.stringify([page]), created_at: 0, updated_at: 0, deleted_at: null }],
      null,
    ]);
  });
});
