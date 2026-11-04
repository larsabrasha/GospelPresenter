import { z } from 'zod';
import { MEDIA_HASH } from './media.ts';
import { CANVAS } from './themes.ts';

// A slideshow's page (Bildspel, docs/custom-slides.md): texts, pictures and shapes placed freely on the 1920×1080
// stage, over a background. A colour that is null follows the presentation's theme (a text's, a line's) or is none
// (a shape's fill or outline, a page's background, which then is the theme's). A PDF's page, rendered at import, is
// a page's background picture (`backgroundPage`), so an imported PDF is a slideshow like any other. Every picture
// on a page is the slideshow's own, its blobs named on the page, as Keynote keeps its pictures: one taken from
// Bilder is a copy (the same blobs, as blobs are named by their content), so Bilder and slideshows are apart
// (Lars, 2026-11-04).

export const CUSTOM_LIMITS = { elements: 100, pages: 100, text: 2000, slides: 1000 } as const;

const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();
/** Room around the stage, so an element can be dragged partly off it. */
const reach = (size: number) => z.number().finite().min(-2 * size).max(3 * size);

const box = {
  id: z.string().min(1).max(40),
  x: reach(CANVAS.width),
  y: reach(CANVAS.height),
  /** A line's may be negative: it runs from (x, y) to (x + w, y + h). */
  w: reach(CANVAS.width),
  h: reach(CANVAS.height),
};

const textElement = z.object({
  ...box,
  kind: z.literal('text'),
  text: z.string().max(CUSTOM_LIMITS.text),
  /** In stage pixels. */
  size: z.number().int().min(10).max(400),
  bold: z.boolean(),
  italic: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  color,
});
const blobHash = z.string().regex(MEDIA_HASH);
/** A picture as a page keeps it: its `full` blob, fitting 1920×1080, and its `thumb`, as a library picture has them. */
const pictureSchema = z.object({ full: blobHash, thumb: blobHash });
export type Picture = z.infer<typeof pictureSchema>;

const imageElement = z.object({ ...box, kind: z.literal('image'), picture: pictureSchema, fit: z.enum(['contain', 'cover']) });
const shapeElement = z.object({
  ...box,
  kind: z.enum(['rect', 'ellipse']),
  fill: color,
  stroke: color,
  strokeWidth: z.number().min(0).max(100),
  /** A rectangle's corners; an ellipse has none. */
  radius: z.number().min(0).max(CANVAS.height / 2),
});
const lineElement = z.object({ ...box, kind: z.literal('line'), stroke: color, strokeWidth: z.number().min(1).max(100) });

const elementSchema = z.discriminatedUnion('kind', [textElement, imageElement, shapeElement, lineElement]);
export type CustomElement = z.infer<typeof elementSchema>;

export const customPageSchema = z.object({
  background: color,
  /** A picture filling the stage under the elements. */
  backgroundPicture: pictureSchema.nullable(),
  /** A PDF's page under the elements, fitted to the stage. */
  backgroundPage: pictureSchema.nullable(),
  elements: z.array(elementSchema).max(CUSTOM_LIMITS.elements),
});
export type CustomPage = z.infer<typeof customPageSchema>;

export const customPagesSchema = z.array(customPageSchema).min(1).max(CUSTOM_LIMITS.pages);

/** A page with nothing on it, its background the theme's. */
export const blankPage = (): CustomPage => ({ background: null, backgroundPicture: null, backgroundPage: null, elements: [] });

/** A PDF's pages as a slideshow's: each the picture of its page on black, with nothing on it yet. */
export const pdfPages = (pages: Picture[]): CustomPage[] => pages.map((p) => ({ ...blankPage(), background: '#000000', backgroundPage: { full: p.full, thumb: p.thumb } }));

/** A slide's pages as stored, or one blank page where they do not read. */
export function parseCustomPages(json: string | null): CustomPage[] {
  try {
    const parsed = customPagesSchema.safeParse(JSON.parse(json ?? ''));
    return parsed.success ? parsed.data : [blankPage()];
  } catch {
    return [blankPage()];
  }
}

/** An overlay's page as stored, or a blank one where it does not read. */
export function parseCustomPage(json: string | null): CustomPage {
  try {
    const parsed = customPageSchema.safeParse(JSON.parse(json ?? ''));
    return parsed.success ? parsed.data : blankPage();
  } catch {
    return blankPage();
  }
}

/** A page's texts as a public output shows them: top to bottom, then left to right, one to a line. */
export function customPageText(page: CustomPage): string {
  return page.elements
    .filter((e) => e.kind === 'text' && e.text.trim())
    .toSorted((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => (e.kind === 'text' ? e.text.trim() : ''))
    .join('\n');
}

/** Every picture `pages` draw: their backgrounds' and their elements'. */
export const customPagePictures = (pages: CustomPage[]): Picture[] =>
  pages.flatMap((p) => [
    ...(p.backgroundPicture ? [p.backgroundPicture] : []),
    ...(p.backgroundPage ? [p.backgroundPage] : []),
    ...p.elements.flatMap((e) => (e.kind === 'image' ? [e.picture] : [])),
  ]);

/** The blobs of every picture `pages` draw, both sizes: what a slideshow or an overlay keeps. */
export const customPageBlobs = (pages: CustomPage[]): string[] => [...new Set(customPagePictures(pages).flatMap((p) => [p.full, p.thumb]))];
