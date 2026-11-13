import { BUILT_IN_THEMES, CANVAS, type Background, type Slide, type TextStyle, type ThemeDefinition } from '@gp/core';

// What the theme editor changes (docs/themes.md): a slide kind's background, its main text's and its credits' look
// and box. Pure functions of a definition, so Ångra keeps whole definitions.

export type EditedKind = 'song' | 'bible' | 'media';
export type TextRole = 'main' | 'credits';

/** The slides the editor shows a theme on, one per kind: a song part, a Bible reading (Bibel 1917), a picture's stage. */
export const SAMPLES: Record<EditedKind, Slide> = {
  song: { key: 'sample-song', kind: 'song', image: null, text: 'Amazing grace\nhow sweet the sound\nthat saved a wretch like me', verses: null, label: null, credits: 'John Newton · 1779' },
  bible: {
    key: 'sample-bible',
    kind: 'bible',
    image: null,
    text: '',
    verses: [{ n: 16, t: 'Ty så älskade Gud världen, att han utgav sin enfödde Son, på det att var och en som tror på honom skall icke förgås, utan hava evigt liv.' }],
    label: null,
    credits: 'Johannes 3:16 · Bibel 1917',
  },
  media: { key: 'sample-media', kind: 'media', image: null, text: '', verses: null, label: null, credits: null },
};

export function backgroundIn(d: ThemeDefinition, kind: EditedKind): Background {
  return kind === 'media' ? d.media : d[kind].background;
}

export function withBackground(d: ThemeDefinition, kind: EditedKind, patch: Partial<Background>): ThemeDefinition {
  if (kind === 'media') return { ...d, media: { ...d.media, ...patch } };
  return { ...d, [kind]: { ...d[kind], background: { ...d[kind].background, ...patch } } };
}

export function withText(d: ThemeDefinition, kind: 'song' | 'bible', role: TextRole, patch: Partial<TextStyle>): ThemeDefinition {
  return { ...d, [kind]: { ...d[kind], [role]: { ...d[kind][role], ...patch } } };
}

/** A box kept on the stage and within the schema's bounds, in whole pixels. */
export function clampArea(a: TextStyle['area']): TextStyle['area'] {
  const w = Math.round(Math.min(CANVAS.width, Math.max(40, a.w)));
  const h = Math.round(Math.min(CANVAS.height, Math.max(40, a.h)));
  return { x: Math.round(Math.min(CANVAS.width - 40, Math.max(0, Math.min(a.x, CANVAS.width - w)))), y: Math.round(Math.min(CANVAS.height - 40, Math.max(0, Math.min(a.y, CANVAS.height - h)))), w, h };
}

/** Where a role's box is in the dark theme: Återställ puts it back there. */
export const defaultArea = (kind: 'song' | 'bible', role: TextRole): TextStyle['area'] => BUILT_IN_THEMES[0]!.definition[kind][role].area;

/** A CSS colour as the editor shows it: `#rrggbb`, and how opaque it is, 0–100. */
export function splitColor(css: string): { hex: string; alpha: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return { hex: `#${h.toLowerCase()}`, alpha: 100 };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css.trim());
  if (!rgb) return { hex: '#ffffff', alpha: 100 };
  const part = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0');
  return { hex: `#${part(rgb[1]!)}${part(rgb[2]!)}${part(rgb[3]!)}`, alpha: Math.round(Math.min(1, Number(rgb[4] ?? 1)) * 100) };
}

/** `hex` at `alpha` %: the hex itself when opaque, else `rgba(…)`. */
export function joinColor(hex: string, alpha: number): string {
  if (alpha >= 100) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, alpha) / 100})`;
}
