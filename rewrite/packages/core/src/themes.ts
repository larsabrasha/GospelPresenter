import { z } from 'zod';
import { MEDIA_HASH } from './media.ts';

// Slide themes (spec 05 "Themes", ADR 0001, docs/themes.md): data, validated with Zod (ADR 0007 decision 8). A theme
// styles each slide type: Song and BibleText have a background, main text and credits; Media has a background only.
// Two are built in (code); an organisation makes its own (the `themes` table), which go after them.

const cssColor = z.string().min(1).max(60).regex(/^[#a-z0-9(),.%\s]+$/i, 'a CSS colour');

/** Where a text sits on the 1920×1080 canvas, in stage pixels: its box, the text placed in it by `valign`. */
export const textAreaSchema = z.object({
  x: z.number().int().min(0).max(1880),
  y: z.number().int().min(0).max(1040),
  w: z.number().int().min(40).max(1920),
  h: z.number().int().min(40).max(1080),
});

export const textStyleSchema = z.object({
  /** px on the 1920×1080 canvas; the most the text gets: a text that does not fit is made smaller (docs/themes.md). */
  fontSize: z.number().int().min(10).max(300),
  fontFamily: z.string().min(1).max(200).regex(/^[\w\s',-]+$/, 'a CSS font stack'),
  fontWeight: z.number().int().min(100).max(900),
  lineHeight: z.number().min(0.8).max(3),
  color: cssColor,
  align: z.enum(['left', 'center', 'right']),
  shadow: z.boolean(),
  uppercase: z.boolean(),
  /** A line around each letter, in stage pixels, 0 for none (docs/themes.md). */
  outline: z.number().int().min(0).max(20),
  outlineColor: cssColor,
  area: textAreaSchema,
  valign: z.enum(['top', 'middle', 'bottom']),
});

const blobHash = z.string().regex(MEDIA_HASH);

/**
 * A background image, named, never a URL (ADR 0001 (10)): a built-in asset the app ships with, or a picture of the
 * theme's own, its blobs named as a slideshow's page names its pictures (taken from Bilder or the device, a copy).
 */
export const backgroundImageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtIn'), asset: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/) }),
  z.object({ kind: z.literal('picture'), full: blobHash, thumb: blobHash }),
]);
export type BackgroundImage = z.infer<typeof backgroundImageSchema>;

export const backgroundSchema = z.object({
  color: cssColor,
  image: backgroundImageSchema.nullable(),
  fit: z.enum(['cover', 'contain']),
  /** Black over the image only, 0–100 %. */
  scrim: z.number().int().min(0).max(100),
});

export const slideStyleSchema = z.object({ background: backgroundSchema, main: textStyleSchema, credits: textStyleSchema });

export const themeDefinitionSchema = z.object({ song: slideStyleSchema, bible: slideStyleSchema, media: backgroundSchema });

/** How many themes of its own an organisation may have, and how long a name is. */
export const THEME_LIMITS = { themes: 50, name: 100 } as const;

export type TextStyle = z.infer<typeof textStyleSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type SlideStyle = z.infer<typeof slideStyleSchema>;
export type ThemeDefinition = z.infer<typeof themeDefinitionSchema>;
export type SlideKind = 'song' | 'bible' | 'media';

export interface Theme {
  /** A stable slug for a built-in theme: presentations point at it, so it is never reused. An own theme's is a generated id. */
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

// ------------------------------------------------------------------ the canvas (LIVE-R17)

export const CANVAS = { width: 1920, height: 1080, padX: 80, padTop: 80, padBottom: 144, creditsBottom: 32 } as const;

/** Room for the main text: the canvas minus its padding. */
export const TEXT_BOX = { width: CANVAS.width - 2 * CANVAS.padX, height: CANVAS.height - CANVAS.padTop - CANVAS.padBottom } as const;

/** The product baseline every built-in theme starts from (LIVE-R18): 75px, 1.4, white, centred, in the canvas minus its padding. */
const MAIN: TextStyle = {
  fontSize: 75,
  fontFamily: FONT_STACKS.tahoma,
  fontWeight: 400,
  lineHeight: 1.4,
  color: '#ffffff',
  align: 'center',
  shadow: false,
  uppercase: false,
  outline: 0,
  outlineColor: '#000000',
  area: { x: CANVAS.padX, y: CANVAS.padTop, w: TEXT_BOX.width, h: TEXT_BOX.height },
  valign: 'middle',
};
/** Credits one line at the foot, as before themes had areas: their box ends `creditsBottom` above the canvas's edge. */
const CREDITS: TextStyle = {
  ...MAIN,
  fontSize: 40,
  lineHeight: 1.2,
  color: 'rgba(255, 255, 255, 0.4)',
  align: 'left',
  area: { x: CANVAS.padX, y: CANVAS.height - CANVAS.padBottom, w: TEXT_BOX.width, h: CANVAS.padBottom - CANVAS.creditsBottom },
  valign: 'bottom',
};
const plain = (color: string): Background => ({ color, image: null, fit: 'cover', scrim: 0 });

const style = (background: Background, main: Partial<TextStyle>, credits: Partial<TextStyle> = {}): SlideStyle => ({
  background,
  main: { ...MAIN, ...main },
  credits: { ...CREDITS, ...credits },
});

const LIGHT = plain('#ffffff');
const LIGHT_MAIN = { color: '#000000' };
const LIGHT_CREDITS = { color: 'rgba(0, 0, 0, 0.4)' };

/**
 * The two built-in themes (Lars, 2026-11-04: one dark and one light), in their order. The dark one is spec 05's
 * Classic and keeps its id, so it is still the fallback; the light one is the same with black on white.
 */
export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'classic',
    sort: 0,
    name: 'Mörkt',
    description: 'Fet vit text på svart bakgrund med luftigt radavstånd. Utseendet vi rekommenderar.',
    definition: {
      song: style(plain('#000000'), { fontWeight: 700 }),
      bible: style(plain('#000000'), { align: 'left' }),
      media: plain('#000000'),
    },
  },
  {
    id: 'light',
    sort: 1,
    name: 'Ljust',
    description: 'Som Mörkt, med svart text på vit bakgrund. För LED-vägg och ljusa lokaler.',
    definition: {
      song: style(LIGHT, { fontWeight: 700, ...LIGHT_MAIN }, LIGHT_CREDITS),
      bible: style(LIGHT, { align: 'left', ...LIGHT_MAIN }, LIGHT_CREDITS),
      media: plain('#000000'),
    },
  },
];

export const DEFAULT_THEME_ID = 'classic';
export const CLASSIC: Theme = BUILT_IN_THEMES[0]!;

const byId = new Map(BUILT_IN_THEMES.map((t) => [t.id, t]));

/** Every theme an organisation can use (THEME-R3): the built-in ones in their order, then its own, by `sort`. */
export function listThemes(own: readonly Theme[] = []): Theme[] {
  return [...BUILT_IN_THEMES, ...own.toSorted((a, b) => a.sort - b.sort)];
}

/** Whether `id` is a built-in theme's, which nobody changes or deletes; an own theme is known by its row (`requireTheme`). */
export function isBuiltInTheme(id: string): boolean {
  return byId.has(id);
}

/**
 * The theme a presentation shows (THEME-R1): its own, else the organisation's default, else Classic. `own` is the
 * organisation's own themes. A theme id that is not known (a deleted theme's) resolves to Classic, not to the
 * default; a slide is never unstyled (THEME-R9).
 */
export function resolveTheme(presentationThemeId: string | null | undefined, orgDefaultThemeId: string | null | undefined, own: readonly Theme[] = []): Theme {
  const id = presentationThemeId ?? orgDefaultThemeId ?? DEFAULT_THEME_ID;
  return byId.get(id) ?? own.find((t) => t.id === id) ?? CLASSIC;
}

/** A stored definition, or null where it does not read (a newer app's, or a broken row). */
export function parseThemeDefinition(json: string | null): ThemeDefinition | null {
  try {
    const parsed = themeDefinitionSchema.safeParse(JSON.parse(json ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** An own theme's row as a Theme: one whose definition does not read looks as Classic, its name kept. */
export function themeOfRow(row: { id: string; name: string; sort: number; definition: string }): Theme {
  return { id: row.id, sort: row.sort, name: row.name, description: '', definition: parseThemeDefinition(row.definition) ?? CLASSIC.definition };
}

/** The blobs a theme's pictures are: each own background picture's two. */
export function themeBlobs(d: ThemeDefinition): string[] {
  return [d.song.background, d.bible.background, d.media].flatMap((bg) => (bg.image?.kind === 'picture' ? [bg.image.full, bg.image.thumb] : []));
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

/** A text's look; where it sits is `textAreaCss`. An outline is drawn under the letters' fill, so it widens them outwards. */
export function textStyleCss(s: TextStyle): Css {
  return {
    fontFamily: s.fontFamily,
    fontSize: `${s.fontSize}px`,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    color: s.color,
    textAlign: s.align,
    ...(s.shadow ? { textShadow: TEXT_SHADOW } : {}),
    ...(s.uppercase ? { textTransform: 'uppercase' } : {}),
    ...(s.outline > 0 ? { WebkitTextStroke: `${s.outline * 2}px ${s.outlineColor}`, paintOrder: 'stroke fill' } : {}),
  };
}

const ALIGN_ITEMS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

/** Where a text's box is on the stage, and the text in it at its top, middle or foot. */
export function textAreaCss(s: TextStyle): Css {
  return { left: `${s.area.x}px`, top: `${s.area.y}px`, width: `${s.area.w}px`, height: `${s.area.h}px`, alignItems: ALIGN_ITEMS[s.valign] };
}

/**
 * The canvas background (THEME-R9): the colour, and over it a built-in image with the scrim as a gradient layer on
 * top. `imageUrl` resolves a built-in asset to where this app serves it; quotes and backslashes in it are escaped. A
 * picture of the theme's own is drawn as a layer of its own (its blob is fetched), so here it is the colour only.
 */
export function backgroundCss(bg: Background, imageUrl: (asset: string) => string | null): Css {
  const css: Css = { backgroundColor: bg.color };
  const url = bg.image?.kind === 'builtIn' ? imageUrl(bg.image.asset) : null;
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
