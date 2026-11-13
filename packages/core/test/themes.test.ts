import { describe, expect, it } from 'vitest';
import {
  backgroundCss,
  BUILT_IN_THEMES,
  CLASSIC,
  can,
  isBuiltInTheme,
  listThemes,
  resolveTheme,
  TEXT_BOX,
  textAreaCss,
  textStyleCss,
  themeBlobs,
  themeOfRow,
  themeDefinitionSchema,
  type TextStyle,
} from '../src/index.ts';

describe('built-in themes (spec 05, ADR 0001)', () => {
  it('THEME-A1: two, dark then light, with Swedish names; ids unique; Classic, the dark one, exists', () => {
    expect(listThemes().map((t) => [t.id, t.name])).toEqual([
      ['classic', 'Mörkt'],
      ['light', 'Ljust'],
    ]);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(2);
    expect(isBuiltInTheme('classic')).toBe(true);
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

  it('the light theme is the dark one with black text on white, credits black 40 %', () => {
    const light = BUILT_IN_THEMES.find((t) => t.id === 'light')!.definition;
    const asDark = (s: TextStyle) => ({ ...s, color: 'x' });
    for (const kind of ['song', 'bible'] as const) {
      expect(light[kind].background.color, kind).toBe('#ffffff');
      expect(light[kind].main.color, kind).toBe('#000000');
      expect(light[kind].credits.color, kind).toBe('rgba(0, 0, 0, 0.4)');
      expect(asDark(light[kind].main), kind).toEqual(asDark(CLASSIC.definition[kind].main));
      expect(asDark(light[kind].credits), kind).toEqual(asDark(CLASSIC.definition[kind].credits));
    }
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
    expect(resolveTheme('classic', 'light').id).toBe('classic');
    expect(resolveTheme(null, 'light').id).toBe('light');
    expect(resolveTheme(null, null).id).toBe('classic');
  });

  it('an unknown theme is Classic, not the default', () => {
    expect(resolveTheme('deleted-theme', 'light').id).toBe('classic');
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
    const shadowed: TextStyle = { ...CLASSIC.definition.song.main, fontFamily: "'Montserrat', sans-serif", fontWeight: 500, shadow: true };
    expect(textStyleCss(shadowed)).toEqual({
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
    const pictured = { color: '#0d1024', image: { kind: 'builtIn' as const, asset: 'art/background' }, fit: 'cover' as const, scrim: 45 };
    expect(backgroundCss(CLASSIC.definition.song.background, () => 'x')).toEqual({ backgroundColor: '#000000' });
    expect(backgroundCss(pictured, (asset) => `/assets/${asset}.webp`)).toEqual({
      backgroundColor: '#0d1024',
      backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url('/assets/art/background.webp')",
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
  });

  it('quotes and backslashes in an image URL are escaped; no scrim, no gradient; an unknown asset is colour only', () => {
    const bg = { color: '#000', image: { kind: 'builtIn' as const, asset: 'a/b' }, fit: 'contain' as const, scrim: 0 };
    expect(backgroundCss(bg, () => "x')\\y").backgroundImage).toBe("url('x\\')\\\\y')");
    expect(backgroundCss(bg, () => 'u').backgroundSize).toBe('contain');
    expect(backgroundCss(bg, () => null)).toEqual({ backgroundColor: '#000' });
  });
});

describe('own themes (docs/themes.md)', () => {
  const own = { id: 'own-1', sort: 5, name: 'Söndag', description: '', definition: CLASSIC.definition };

  it('lists the built-in ones first, then the own ones by when they were made', () => {
    const later = { ...own, id: 'own-2', sort: 9 };

    expect(listThemes([later, own]).map((t) => t.id)).toEqual(['classic', 'light', 'own-1', 'own-2']);
  });

  it('resolves a presentation’s own theme and an own default', () => {
    expect([resolveTheme('own-1', null, [own]).id, resolveTheme(null, 'own-1', [own]).id]).toEqual(['own-1', 'own-1']);
  });

  it('resolves a deleted own theme to the dark one', () => {
    expect(resolveTheme('own-1', null, []).id).toBe('classic');
  });

  it('reads a row whose definition does not parse as the dark theme, its name kept', () => {
    const theme = themeOfRow({ id: 'own-1', name: 'Trasig', sort: 1, definition: '{"song":1}' });

    expect([theme.name, theme.definition]).toEqual(['Trasig', CLASSIC.definition]);
  });

  it('names the blobs of its own background pictures', () => {
    const picture = { kind: 'picture' as const, full: 'a'.repeat(64), thumb: 'b'.repeat(64) };
    const d = { ...CLASSIC.definition, media: { ...CLASSIC.definition.media, image: picture } };

    expect(themeBlobs(d)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });
});

describe('text placement and effects (docs/themes.md)', () => {
  it('puts a text’s box where its area is, the text at its foot when placed at the bottom', () => {
    const s: TextStyle = { ...CLASSIC.definition.song.main, area: { x: 100, y: 700, w: 1720, h: 300 }, valign: 'bottom' };

    expect(textAreaCss(s)).toEqual({ left: '100px', top: '700px', width: '1720px', height: '300px', alignItems: 'flex-end' });
  });

  it('keeps the box of the canvas minus its padding in the built-in themes', () => {
    expect(CLASSIC.definition.song.main.area).toEqual({ x: 80, y: 80, w: TEXT_BOX.width, h: TEXT_BOX.height });
  });

  it('draws capitals and an outline under the letters only when asked', () => {
    const s: TextStyle = { ...CLASSIC.definition.song.main, uppercase: true, outline: 3, outlineColor: '#000000' };

    expect(textStyleCss(s)).toMatchObject({ textTransform: 'uppercase', WebkitTextStroke: '6px #000000', paintOrder: 'stroke fill' });
    expect(textStyleCss(CLASSIC.definition.song.main)).not.toHaveProperty('WebkitTextStroke');
  });
});
