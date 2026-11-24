import { describe, expect, it } from 'vitest';
import { CLASSIC } from '@gp/core';
import { clampArea, joinColor, splitColor, withBackground, withText } from '../src/pages/theme-editor/themeModel.ts';

describe('the theme editor’s colours', () => {
  it('reads an rgba colour as its hex and opacity', () => {
    expect(splitColor('rgba(255, 255, 255, 0.4)')).toEqual({ hex: '#ffffff', alpha: 40 });
  });

  it('reads a short hex as a long one, opaque', () => {
    expect(splitColor('#0Af')).toEqual({ hex: '#00aaff', alpha: 100 });
  });

  it('writes an opaque colour as hex and a see-through one as rgba', () => {
    expect([joinColor('#102030', 100), joinColor('#102030', 55)]).toEqual(['#102030', 'rgba(16, 32, 48, 0.55)']);
  });
});

describe('the theme editor’s changes', () => {
  it('keeps a box dragged past the stage’s edge on it', () => {
    expect(clampArea({ x: 1900, y: -50, w: 400, h: 200.4 })).toEqual({ x: 1520, y: 0, w: 400, h: 200 });
  });

  it('changes one kind’s text and leaves the other kind as it was', () => {
    const d = withText(CLASSIC.definition, 'song', 'main', { uppercase: true });

    expect([d.song.main.uppercase, d.bible.main.uppercase]).toEqual([true, false]);
  });

  it('changes the media background apart from the songs’', () => {
    const d = withBackground(CLASSIC.definition, 'media', { color: '#222222' });

    expect([d.media.color, d.song.background.color]).toEqual(['#222222', '#000000']);
  });
});
