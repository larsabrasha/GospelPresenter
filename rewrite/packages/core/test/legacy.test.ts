import { describe, expect, it } from 'vitest';
import { LEGACY_TABLES, legacyRowsProblem, upgradeLegacyRows, type CustomPage, type LegacyRows } from '@gp/core';

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

    expect(upgradeLegacyRows(2, rows)).toBe(rows);
  });
});
