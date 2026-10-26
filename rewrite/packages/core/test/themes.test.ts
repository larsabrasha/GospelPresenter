import { describe, expect, it } from 'vitest';
import {
  backgroundCss,
  BUILT_IN_THEMES,
  CLASSIC,
  can,
  isKnownTheme,
  listThemes,
  resolveTheme,
  TEXT_BOX,
  textStyleCss,
  themeDefinitionSchema,
  type TextStyle,
} from '../src/index.ts';

describe('built-in themes (spec 05, ADR 0001)', () => {
  it('THEME-A1: four, in order, with Swedish names; ids unique; Classic exists', () => {
    expect(listThemes().map((t) => t.name)).toEqual(['Klassisk', 'Midnatt', 'Dagsljus', 'Norrsken']);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(4);
    expect(isKnownTheme('classic')).toBe(true);
    for (const t of BUILT_IN_THEMES) expect(themeDefinitionSchema.safeParse(t.definition).success, t.id).toBe(true);
  });

  it('THEME-A9: Classic is bold 75px Tahoma centred white on black for songs, regular and left for Bible text, credits 40px white 40 %', () => {
    const { song, bible } = CLASSIC.definition;
    expect(song.main).toMatchObject({ fontSize: 75, fontWeight: 700, align: 'center', color: '#ffffff' });
    expect(song.main.fontFamily).toMatch(/^'Tahoma'/);
    expect(song.background.color).toBe('#000000');
    expect(bible.main).toMatchObject({ fontSize: 75, fontWeight: 400, align: 'left' });
    expect(song.credits).toMatchObject({ fontSize: 40, lineHeight: 1.2, color: 'rgba(255, 255, 255, 0.4)', align: 'left' });
  });

  it('THEME-R8: every main text is 75px / 1.4, and no line box is taller than Classic’s', () => {
    const box = (s: TextStyle) => s.fontSize * s.lineHeight;
    for (const t of BUILT_IN_THEMES) {
      for (const kind of ['song', 'bible'] as const) {
        const main = t.definition[kind].main;
        expect([main.fontSize, main.lineHeight], `${t.id} ${kind}`).toEqual([75, 1.4]);
        expect(box(main)).toBeLessThanOrEqual(box(CLASSIC.definition[kind].main));
      }
    }
  });

  it('THEME-R8: a 250-character Bible slide and a 7-line song part fit the canvas (a wide-face estimate)', () => {
    for (const t of BUILT_IN_THEMES) {
      const bible = t.definition.bible.main;
      // Generous average glyph width for a wide face such as Montserrat: 0.62 em.
      const perLine = Math.floor(TEXT_BOX.width / (bible.fontSize * 0.62));
      const lines = Math.ceil(250 / perLine) + 1; // one extra for word wrap
      expect(lines * bible.fontSize * bible.lineHeight, t.id).toBeLessThanOrEqual(TEXT_BOX.height);
      const song = t.definition.song.main;
      expect(7 * song.fontSize * song.lineHeight, t.id).toBeLessThanOrEqual(TEXT_BOX.height);
    }
  });
});

describe('resolution (THEME-R1, THEME-A5, THEME-A7)', () => {
  it('the presentation’s own, else the organisation default, else Classic', () => {
    expect(resolveTheme('aurora', 'midnight').id).toBe('aurora');
    expect(resolveTheme(null, 'midnight').id).toBe('midnight');
    expect(resolveTheme(null, null).id).toBe('classic');
  });

  it('an unknown theme is Classic, not the default', () => {
    expect(resolveTheme('deleted-theme', 'midnight').id).toBe('classic');
    expect(resolveTheme(null, 'deleted-theme').id).toBe('classic');
  });

  it('everyone sees themes; only admins set the default (ADR 0001 (19)); only admins import Bibles (D24)', () => {
    expect(can('user', 'ViewThemes')).toBe(true);
    expect(can('user', 'ManageThemes')).toBe(false);
    expect(can('user', 'ViewBibles')).toBe(true);
    expect(can('user', 'ManageBibles')).toBe(false);
    expect(can('admin', 'ManageBibles')).toBe(true);
  });
});

describe('CSS (THEME-R9)', () => {
  it('text styles map to CSS; the shadow only when on', () => {
    const aurora = BUILT_IN_THEMES.find((t) => t.id === 'aurora')!.definition.song.main;
    expect(textStyleCss(aurora)).toEqual({
      fontFamily: "'Montserrat', sans-serif",
      fontSize: '75px',
      fontWeight: 500,
      lineHeight: 1.4,
      color: '#ffffff',
      textAlign: 'center',
      textShadow: '0 0.06em 0.18em rgba(0, 0, 0, 0.65)',
    });
    expect(textStyleCss(CLASSIC.definition.song.main)).not.toHaveProperty('textShadow');
  });

  it('a background is its colour; an image goes under a scrim layer, centred, not repeated', () => {
    const aurora = BUILT_IN_THEMES.find((t) => t.id === 'aurora')!.definition;
    expect(backgroundCss(CLASSIC.definition.song.background, () => 'x')).toEqual({ backgroundColor: '#000000' });
    expect(backgroundCss(aurora.song.background, (asset) => `/assets/${asset}.webp`)).toEqual({
      backgroundColor: '#0d1024',
      backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url('/assets/aurora/background.webp')",
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
    // Media keeps the colour only.
    expect(aurora.media.image).toBeNull();
  });

  it('quotes and backslashes in an image URL are escaped; no scrim, no gradient; an unknown asset is colour only', () => {
    const bg = { color: '#000', image: { kind: 'builtIn' as const, asset: 'a/b' }, fit: 'contain' as const, scrim: 0 };
    expect(backgroundCss(bg, () => "x')\\y").backgroundImage).toBe("url('x\\')\\\\y')");
    expect(backgroundCss(bg, () => 'u').backgroundSize).toBe('contain');
    expect(backgroundCss(bg, () => null)).toEqual({ backgroundColor: '#000' });
  });
});
