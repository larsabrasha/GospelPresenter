import { customPageBlobs, ITEM_IMAGES_SQL, OVERLAY_PICTURES_SQL, SLIDE_PAGES_SQL, type CustomPage, type LiveOwnState } from '@gp/core';
import { canvasOf, slideOf, type LiveStore, type SessionRow } from './live-tables.ts';

// What an output's viewers may fetch (LIVE-R32, MEDIA-R10): only what its session shows, and only if it belongs to the
// presentation the session presents. The owner's report alone is not enough: a changed client could otherwise name
// any picture of the library and make it public through the output.

/**
 * A picture: the one on screen, of an item in the presentation, or a page of a slide deck in it. A paired screen may
 * also show a picture its canvas draws on a page (docs/custom-slides.md): a slideshow's, of one the presentation
 * shows, or the overlay's, of the overlay the session's pointer has switched on (LIVE-R34). A public output never
 * gets those but a PDF's page, which is the slide's picture.
 */
export function mayShowImage(store: LiveStore, row: SessionRow, hash: string, screen: boolean): boolean {
  const shown = screen ? canvasOf(row) : null;
  const slideImage = screen ? shown?.slide?.image : slideOf(row)?.image;
  if (
    (slideImage === hash || draws(shown?.slide?.custom, hash)) &&
    store.query(
      `SELECT 1 FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id
       WHERE p.presentation_id = ? AND i.full_hash = ?
       UNION ALL
       SELECT 1 FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ? AND s.full_hash = ?
       UNION ALL
       SELECT 1 FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id = ? AND v.still_hash = ?`,
      [row.presentation_id, hash, row.presentation_id, hash, row.presentation_id, hash],
    ).length > 0
  ) {
    return true;
  }
  if (!draws(shown?.overlay, hash)) return false;
  const overlayId = (JSON.parse(row.pointer) as LiveOwnState['pointer']).overlayId;
  return !!overlayId && store.query(`SELECT 1 FROM (${OVERLAY_PICTURES_SQL}) o WHERE o.overlay_id = ? AND o.full_hash = ?`, [overlayId, hash]).length > 0;
}

/** Whether a page on the canvas draws `hash`, by the canvas's own word. */
const draws = (page: CustomPage | null | undefined, hash: string) => !!page && customPageBlobs([page]).includes(hash);

/**
 * A video a paired screen streams (TODO.md "Video on the outputs"): the one on its canvas, of an item in the
 * presentation. A public output never streams one; it shows the still.
 */
export function mayShowVideo(store: LiveStore, row: SessionRow, hash: string): boolean {
  if (canvasOf(row)?.slide?.video?.hash !== hash) return false;
  return store.query(`SELECT 1 FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id = ? AND v.hash = ?`, [row.presentation_id, hash]).length > 0;
}
