// Presenting's reads against 2.0's own (pages/Output.tsx, live/owner.ts, player.ts, audio.ts, ccli.ts, useOutputs.ts,
// LivePanel.tsx at 238d481b), for every item of every presentation and a slide past each item's last, with and
// without an overlay. On the demo data with themes, overlays, outputs and settings added (fixture.mjs).
import { ccliCollectionOn, getAudio, getOverlay, getPresentation, getSong, getVideo, itemsOf, listDisplays, orgRemoteControl, shownOverlay, themeOf } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon, tsSlides } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

/** 2.0's reads for a pointer, each as the web did it. */
async function reference(db, d, pid, itemId, partIndex, overlayId) {
  const presentation = await getPresentation(d, pid);
  const items = await itemsOf(d, pid);
  const item = items.find((i) => i.id === itemId);
  const slides = item ? (await tsSlides(db, pid)).slides.get(item.id) : null;
  const at = items.findIndex((i) => i.id === itemId);
  const videoOf = async (i) => (i?.type === 'video' ? await getVideo(d, i.sourceId) : null);
  const audioRow = db.prepare(`SELECT source_id FROM presentation_items WHERE id = ? AND type = 'audio'`).get(itemId ?? '');
  const song = item?.type === 'song' && (await ccliCollectionOn(d)) ? await getSong(d, item.sourceId) : null;
  return {
    overlayView: await shownOverlay(d, overlayId),
    liveSlideView: { name: presentation?.name ?? null, slide: slides?.slides[partIndex] ?? null, theme: await themeOf(d, presentation), overlay: await shownOverlay(d, overlayId) },
    itemOverlaysView: items.map((i) => [i.id, i.overlayId]),
    liveTargetsView: { item: itemId ? items.some((i) => i.id === itemId) : true, overlay: overlayId ? !!(await getOverlay(d, overlayId)) : true },
    livePlaybackView: { item: item ? { id: item.id, type: item.type } : null, video: await videoOf(item), nextVideo: at >= 0 ? await videoOf(items[at + 1]) : null },
    itemAudioView: audioRow ? await getAudio(d, audioRow.source_id) : null,
    ccliUseView: song?.ccli?.trim()
      ? { songId: song.id, songName: song.name, ccli: song.ccli, presentationId: pid, presentationName: presentation?.name ?? '' }
      : null,
  };
}

export default async function check(_, file) {
  const db = fixture(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const overlays = [null, 'ov-1', 'ov-2', 'ov-gone'];
  for (const { id: pid } of db.prepare('SELECT id FROM presentations').all()) {
    const items = db.prepare('SELECT id FROM presentation_items WHERE presentation_id = ?').all(pid).map((r) => r.id);
    for (const [k, itemId] of [...items, null, 'no-such'].entries()) {
      for (const partIndex of [0, 1, 40]) {
        const overlayId = overlays[(k + partIndex) % overlays.length];
        const want = await reference(db, d, pid, itemId, partIndex, overlayId);
        const args = { presentationId: pid, itemId, partIndex, overlayId, id: overlayId };
        for (const [view, w] of Object.entries(want)) {
          compared++;
          const got = canon(await viewRust(db, view, args));
          if (canon(w) !== got) differ.push(`${view} ${JSON.stringify(args)}: TS ${canon(w).slice(0, 300)} Rust ${got.slice(0, 300)}`);
        }
      }
    }
  }
  // The outputs as rows: the page orders them by its language, as listDisplays did.
  const byId = (xs) => xs.toSorted((a, b) => a.id.localeCompare(b.id));
  for (const [view, want] of [['displaysView', byId(await listDisplays(d))], ['remoteControlView', await orgRemoteControl(d)]]) {
    compared++;
    const got = await viewRust(db, view, {});
    if (canon(want) !== canon(Array.isArray(got) ? byId(got) : got)) differ.push(`${view}: TS ${canon(want)} Rust ${canon(got)}`);
  }
  return { compared, differ, notes: ['every item, a slide past the last, with and without an overlay; the outputs, the remote control policy'] };
}
