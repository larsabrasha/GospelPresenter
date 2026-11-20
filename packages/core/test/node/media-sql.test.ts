// The SQL that names the pictures of slideshows, overlays and image items (media.ts): a row whose JSON does not read
// is passed over, never stops the query, so one broken slideshow cannot stop every file a device fetches.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ITEM_IMAGES_SQL, OVERLAY_PICTURES_SQL, SLIDESHOW_PICTURES_SQL } from '@gp/core';

const page = { backgroundPicture: { full: 'full-1', thumb: 'thumb-1' }, elements: [] };

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE custom_slides (id TEXT, pages TEXT);
          CREATE TABLE overlays (id TEXT, sort INTEGER, content TEXT);
          CREATE TABLE presentation_items (id TEXT, presentation_id TEXT, type TEXT, source_id TEXT, content TEXT);`);
  return d;
}

describe('the pictures pages name', () => {
  it("passes over a slideshow whose pages do not read and keeps the others'", () => {
    const d = db();
    d.prepare('INSERT INTO custom_slides VALUES (?, ?), (?, ?)').run('good', JSON.stringify([page]), 'bad', 'not json');

    const rows = d.prepare(SLIDESHOW_PICTURES_SQL).all();

    expect(rows).toEqual([{ full_hash: 'full-1', thumb_hash: 'thumb-1' }]);
  });

  it('passes over an overlay whose page does not read', () => {
    const d = db();
    d.prepare('INSERT INTO overlays VALUES (?, 0, ?), (?, 1, ?)').run('good', JSON.stringify(page), 'bad', 'not json');

    const rows = d.prepare(OVERLAY_PICTURES_SQL).all();

    expect(rows).toEqual([{ overlay_id: 'good', sort: 0, full_hash: 'full-1', thumb_hash: 'thumb-1' }]);
  });

  it('passes over an image item whose pictures do not read', () => {
    const d = db();
    d.prepare("INSERT INTO presentation_items VALUES ('i1', 'p', 'image', NULL, ?), ('i2', 'p', 'image', NULL, 'not json')").run(JSON.stringify({ images: ['img-1'] }));

    const rows = d.prepare(ITEM_IMAGES_SQL).all();

    expect(rows).toEqual([{ presentation_id: 'p', image_id: 'img-1' }]);
  });
});
