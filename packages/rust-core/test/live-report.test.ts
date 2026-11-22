// What the outputs of a session show (`shownOnOutputsView`, crates/gp-core/src/live_report.rs) against the web's TS
// it replaced in apps/web/src/live/owner.ts (shownOnOutputs over toPublicSlide, toCanvas and customPageText, still in
// @gp/core for the outputs' own pages): the same answer for each kind of slide, overlay and theme.
import { customPageText, toCanvas, toPublicSlide, type CustomPage, type LiveVideo, type PublicSlide } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { nodeRustCore } from '../src/node.ts';

const classic = { id: 'classic', definition: { song: {}, bible: {}, media: {} } } as unknown as Theme;
const own = { id: 'own-1', definition: { song: { background: { color: '#123456' } }, bible: {}, media: {} } } as unknown as Theme;
const page = (texts: { text: string; x: number; y: number }[], pictures = 0): CustomPage =>
  ({
    background: '#000000',
    elements: [
      ...texts.map((t, i) => ({ id: `t${i}`, kind: 'text', text: t.text, x: t.x, y: t.y, w: 100, h: 50 })),
      ...Array.from({ length: pictures }, (_, i) => ({ id: `p${i}`, kind: 'image', x: 0, y: 0, w: 10, h: 10, picture: { full: 'a'.repeat(64), thumb: 'b'.repeat(64) } })),
    ],
  }) as unknown as CustomPage;

/** A slide as liveSlideView gives it: a video's or a slideshow's with what it carries. */
type Slide = Pick<PublicSlide, 'kind' | 'text' | 'verses' | 'image' | 'credits'> & { video?: Omit<LiveVideo, 'playing' | 'position' | 'at'>; custom?: CustomPage };
type Theme = { id: string; definition: never };
type Shown = { slide: Slide | null; overlay: CustomPage | null; theme: Theme };

/** The web's shownOnOutputs, as it stood. */
function web(pointer: { presentationId: string | null; black: boolean }, shown: Shown, video: LiveVideo | null, now: number) {
  if (!pointer.presentationId || pointer.black) return { slide: null, canvas: null };
  const { slide, overlay, theme } = shown;
  const overlayText = (overlay && customPageText(overlay)) || null;
  if (!slide && !overlay?.elements.length) return { slide: null, canvas: null };
  return {
    slide: slide || overlayText ? toPublicSlide(slide ?? { kind: 'song', text: '', verses: null, image: null, credits: null }, theme, overlayText) : null,
    canvas: toCanvas(slide, theme, overlay, slide?.video ? (video ?? { ...slide.video, playing: false, position: 0, at: now }) : null),
  };
}

const song: Slide = { kind: 'song', text: 'Härlig är jorden\nhärlig är Guds himmel', verses: null, image: null, credits: 'Text: B. S. Ingemann' };
const bible: Slide = { kind: 'bible', text: '', verses: [{ n: 16, t: 'För så älskade Gud världen'.repeat(300) }, { n: 17, t: 'x'.repeat(10) }], image: null, credits: 'Joh 3:16' };
const picture: Slide = { kind: 'media', text: '', verses: null, image: 'c'.repeat(64), credits: null };
const video: Slide = { ...picture, video: { hash: 'd'.repeat(64), type: 'video/mp4', codec: 'h264' } as Slide['video'] };
const custom: Slide = { ...picture, custom: page(Array.from({ length: 400 }, (_, i) => ({ text: `rad ${i} ${'å'.repeat(40)}`, x: i, y: i }))) };

const cases: [string, { presentationId: string | null; black: boolean }, Shown, LiveVideo | null][] = [
  ['a song', { presentationId: 'p', black: false }, { slide: song, overlay: null, theme: classic }, null],
  ['black', { presentationId: 'p', black: true }, { slide: song, overlay: null, theme: classic }, null],
  ['nothing presented', { presentationId: null, black: false }, { slide: song, overlay: null, theme: classic }, null],
  ['a long reading cut', { presentationId: 'p', black: false }, { slide: bible, overlay: null, theme: classic }, null],
  ['a picture in an own theme', { presentationId: 'p', black: false }, { slide: picture, overlay: null, theme: own }, null],
  ['an overlay alone', { presentationId: 'p', black: false }, { slide: null, overlay: page([{ text: ' Kollekt ', x: 1, y: 2 }, { text: 'Swish', x: 0, y: 1 }]), theme: classic }, null],
  ['an overlay of a picture alone', { presentationId: 'p', black: false }, { slide: null, overlay: page([], 1), theme: classic }, null],
  ['a song under an overlay', { presentationId: 'p', black: false }, { slide: song, overlay: page([{ text: 'Välkomna', x: 0, y: 0 }]), theme: classic }, null],
  ['a video not playing yet', { presentationId: 'p', black: false }, { slide: video, overlay: null, theme: classic }, null],
  ['a video playing', { presentationId: 'p', black: false }, { slide: video, overlay: null, theme: classic }, { hash: 'd'.repeat(64), type: 'video/mp4', codec: 'h264', playing: true, position: 12.5, at: 99 } as LiveVideo],
  ['a slideshow page cut to its limit', { presentationId: 'p', black: false }, { slide: custom, overlay: null, theme: classic }, null],
  ['nothing selected, no overlay', { presentationId: 'p', black: false }, { slide: null, overlay: null, theme: classic }, null],
];

describe('shownOnOutputsView', () => {
  for (const [name, pointer, shown, live] of cases) {
    it(`answers as the web did for ${name}`, () => {
      const out = nodeRustCore().pure('shownOnOutputsView', { pointer, shown, video: live, now: 1234 });

      expect(out).toEqual(JSON.parse(JSON.stringify(web(pointer, shown, live, 1234))));
    });
  }
});
