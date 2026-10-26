import { z } from 'zod';

// Slide themes (spec 05 "Themes", ADR 0001): data, validated with Zod (ADR
// 0007 decision 8). A theme styles each slide type: Song and BibleText have a
// background, main text and credits; Media has a background only.

const cssColor = z.string().min(1).max(60).regex(/^[#a-z0-9(),.%\s]+$/i, 'a CSS colour');

export const textStyleSchema = z.object({
  /** px on the 1920×1080 canvas. */
  fontSize: z.number().int().min(10).max(300),
  fontFamily: z.string().min(1).max(200).regex(/^[\w\s',-]+$/, 'a CSS font stack'),
  fontWeight: z.number().int().min(100).max(900),
  lineHeight: z.number().min(0.8).max(3),
  color: cssColor,
  align: z.enum(['left', 'center', 'right']),
  shadow: z.boolean(),
});

/**
 * A background image, named, never a URL (ADR 0001 (10)): a built-in asset
 * the app ships with. Images from the organisation's library come with the
 * media library.
 */
export const backgroundImageSchema = z.object({ kind: z.literal('builtIn'), asset: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/) });

export const backgroundSchema = z.object({
  color: cssColor,
  image: backgroundImageSchema.nullable(),
  fit: z.enum(['cover', 'contain']),
  /** Black over the image only, 0–100 %. */
  scrim: z.number().int().min(0).max(100),
});

export const slideStyleSchema = z.object({ background: backgroundSchema, main: textStyleSchema, credits: textStyleSchema });

export const themeDefinitionSchema = z.object({ song: slideStyleSchema, bible: slideStyleSchema, media: backgroundSchema });

export type TextStyle = z.infer<typeof textStyleSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type SlideStyle = z.infer<typeof slideStyleSchema>;
export type ThemeDefinition = z.infer<typeof themeDefinitionSchema>;
export type SlideKind = 'song' | 'bible' | 'media';

export interface Theme {
  /** A stable slug for a built-in theme: presentations point at it, so it is never reused. */
  id: string;
  sort: number;
  name: string;
  description: string;
  definition: ThemeDefinition;
}

export const FONT_STACKS = {
  tahoma: "'Tahoma', 'Geneva', Verdana, sans-serif",
  inter: "'Inter', sans-serif",
  lato: "'Lato', sans-serif",
  montserrat: "'Montserrat', sans-serif",
} as const;

/** The product baseline every built-in theme starts from (LIVE-R18): 75px, 1.4, white, centred. */
const MAIN: TextStyle = { fontSize: 75, fontFamily: FONT_STACKS.tahoma, fontWeight: 400, lineHeight: 1.4, color: '#ffffff', align: 'center', shadow: false };
const CREDITS: TextStyle = { ...MAIN, fontSize: 40, lineHeight: 1.2, color: 'rgba(255, 255, 255, 0.4)', align: 'left' };
const plain = (color: string): Background => ({ color, image: null, fit: 'cover', scrim: 0 });

const style = (background: Background, main: Partial<TextStyle>, credits: Partial<TextStyle> = {}): SlideStyle => ({
  background,
  main: { ...MAIN, ...main },
  credits: { ...CREDITS, ...credits },
});

/** The art of Aurora, shipped with the app (spec 05: generated in-house, so ours to redistribute). */
export const AURORA_BACKGROUND = 'aurora/background';

const midnight = plain('#0b1b3a');
const midnightCredits = { fontFamily: FONT_STACKS.inter, color: 'rgba(255, 255, 255, 0.45)' };
const daylight = plain('#faf7f2');
const daylightCredits = { fontFamily: FONT_STACKS.lato, color: 'rgba(20, 18, 16, 0.55)' };
const aurora: Background = { color: '#0d1024', image: { kind: 'builtIn', asset: AURORA_BACKGROUND }, fit: 'cover', scrim: 45 };
const auroraCredits = { fontFamily: FONT_STACKS.montserrat, color: 'rgba(255, 255, 255, 0.5)', shadow: true };

/** The four built-in themes (spec 05 "Built-in themes"), in their order. Classic is the fallback. */
export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'classic',
    sort: 0,
    name: 'Klassisk',
    description: 'Fet vit text på svart bakgrund med luftigt radavstånd. Utseendet vi rekommenderar.',
    definition: {
      song: style(plain('#000000'), { fontWeight: 700 }),
      bible: style(plain('#000000'), { align: 'left' }),
      media: plain('#000000'),
    },
  },
  {
    id: 'midnight',
    sort: 1,
    name: 'Midnatt',
    description: 'Djupblått i stället för svart, med en renare typografi. För ett mörkt rum.',
    definition: {
      song: style(midnight, { fontFamily: FONT_STACKS.inter, fontWeight: 600 }, midnightCredits),
      bible: style(midnight, { fontFamily: FONT_STACKS.inter, fontWeight: 500, align: 'left' }, midnightCredits),
      media: midnight,
    },
  },
  {
    id: 'daylight',
    sort: 2,
    name: 'Dagsljus',
    description: 'Mörk text på ljus bakgrund, för LED-vägg och ljusa lokaler.',
    definition: {
      song: style(daylight, { fontFamily: FONT_STACKS.lato, color: '#141210' }, daylightCredits),
      bible: style(daylight, { fontFamily: FONT_STACKS.lato, color: '#141210', align: 'left' }, daylightCredits),
      media: daylight,
    },
  },
  {
    id: 'aurora',
    sort: 3,
    name: 'Norrsken',
    description: 'En mjuk bakgrundsbild med dämpning som håller texten läsbar.',
    definition: {
      song: style(aurora, { fontFamily: FONT_STACKS.montserrat, fontWeight: 500, shadow: true }, auroraCredits),
      bible: style(aurora, { fontFamily: FONT_STACKS.montserrat, align: 'left', shadow: true }, auroraCredits),
      // A picture behind a picture never looks deliberate: media keeps the colour only.
      media: plain('#0d1024'),
    },
  },
];

export const DEFAULT_THEME_ID = 'classic';
export const CLASSIC: Theme = BUILT_IN_THEMES[0]!;

const byId = new Map(BUILT_IN_THEMES.map((t) => [t.id, t]));

/** Every theme an organisation can use, built-in first in their order (THEME-R3). Organisation themes come with the editor. */
export function listThemes(): Theme[] {
  return BUILT_IN_THEMES;
}

export function isKnownTheme(id: string): boolean {
  return byId.has(id);
}

/**
 * The theme a presentation shows (THEME-R1): its own, else the organisation's
 * default, else Classic. A theme id that is not known resolves to Classic,
 * not to the default; a slide is never unstyled (THEME-R9).
 */
export function resolveTheme(presentationThemeId: string | null | undefined, orgDefaultThemeId: string | null | undefined): Theme {
  const id = presentationThemeId ?? orgDefaultThemeId ?? DEFAULT_THEME_ID;
  return byId.get(id) ?? CLASSIC;
}

/** The style of a slide kind that carries text. */
export function slideStyle(theme: Theme, kind: 'song' | 'bible'): SlideStyle {
  return theme.definition[kind];
}

export function backgroundOf(theme: Theme, kind: SlideKind): Background {
  return kind === 'media' ? theme.definition.media : theme.definition[kind].background;
}

// ------------------------------------------------------------------ CSS

/** CSS properties, camel-cased as React's `style` takes them. */
export type Css = Record<string, string | number>;

export const TEXT_SHADOW = '0 0.06em 0.18em rgba(0, 0, 0, 0.65)';

export function textStyleCss(s: TextStyle): Css {
  return {
    fontFamily: s.fontFamily,
    fontSize: `${s.fontSize}px`,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    color: s.color,
    textAlign: s.align,
    ...(s.shadow ? { textShadow: TEXT_SHADOW } : {}),
  };
}

/**
 * The canvas background (THEME-R9): the colour, and over it the image with
 * the scrim as a gradient layer on top. `imageUrl` resolves a built-in asset
 * to where this app serves it; quotes and backslashes in it are escaped.
 */
export function backgroundCss(bg: Background, imageUrl: (asset: string) => string | null): Css {
  const css: Css = { backgroundColor: bg.color };
  const url = bg.image ? imageUrl(bg.image.asset) : null;
  if (!url) return css;
  const escaped = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const scrim = Math.min(100, Math.max(0, bg.scrim)) / 100;
  const layer = `url('${escaped}')`;
  return {
    ...css,
    backgroundImage: scrim > 0 ? `linear-gradient(rgba(0, 0, 0, ${scrim}), rgba(0, 0, 0, ${scrim})), ${layer}` : layer,
    backgroundSize: bg.fit,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

// ------------------------------------------------------------------ the canvas (LIVE-R17)

export const CANVAS = { width: 1920, height: 1080, padX: 80, padTop: 80, padBottom: 144, creditsBottom: 32 } as const;

/** Room for the main text: the canvas minus its padding. */
export const TEXT_BOX = { width: CANVAS.width - 2 * CANVAS.padX, height: CANVAS.height - CANVAS.padTop - CANVAS.padBottom } as const;
