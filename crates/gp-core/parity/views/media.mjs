// The libraries against 2.0's reads (listImages, listAudios, listVideos, listCustomSlides, getCustomSlide,
// listOverlays and getOverlay at 238d481b): on the demo data with more in each library (fixture.mjs).
import { getCustomSlide, getOverlay, listAudios, listCustomSlides, listImages, listOverlays, listVideos } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

export default async function check(_, file) {
  const db = fixture(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const same = async (view, args, want) => {
    compared++;
    const got = await viewRust(db, view, args);
    if (canon(want) !== canon(got)) differ.push(`${view} ${JSON.stringify(args)}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  await same('imagesView', {}, await listImages(d));
  await same('audiosView', {}, await listAudios(d));
  await same('videosView', {}, await listVideos(d));
  await same('customSlidesView', {}, await listCustomSlides(d));
  await same('overlaysView', {}, await listOverlays(d));
  for (const id of [...db.prepare('SELECT id FROM custom_slides').all().map((r) => r.id), 'no-such']) await same('customSlideView', { id }, await getCustomSlide(d, id));
  for (const id of [...db.prepare('SELECT id FROM overlays').all().map((r) => r.id), 'no-such']) await same('overlayRowView', { id }, await getOverlay(d, id));
  return { compared, differ, notes: ['pictures, sounds, videos, slideshows and overlays, each by id'] };
}
