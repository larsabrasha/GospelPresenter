// The MCP tools for how slides look (docs/mcp.md): the organisation's themes, its overlays, and the pictures they
// show, fetched from the web by the server (Lars, 2026-11-26: "use the Swish logo on the web on an overlay", from
// Claude on a phone). A theme is changed in what is named and answered whole; an overlay's elements are written whole,
// as the app's editor saves them.
import { z } from 'zod';
import { blankPage, customPageSchema, parseCustomPage } from './custom-slides.ts';
import { DEFAULT_THEME_ID, BUILT_IN_THEMES, PLAYFUL_THEME_IDS, themeDefinitionSchema, type Theme, type ThemeDefinition } from './themes.ts';
import { MutationError } from './mutation.ts';
import { id, tool, type McpToolContext, type Row, type Tool } from './mcp-tool.ts';
import { overlayRowView, overlaysView } from './views/lists-media.ts';
import { defaultThemeIdView, ownThemesView, ownThemeView } from './views/lists-settings.ts';
import type { RunSql } from './views/sql.ts';

const STAGE =
  'Slides are a 1920×1080 stage in pixels, (0, 0) at the top left; the app keeps 54 px (5 % of the height) from the edges, ' +
  'so an element at the top left is at x 54, y 54.';

// ------------------------------------------------------------------ themes

const textChanges = themeDefinitionSchema.shape.song.shape.main.partial();
const backgroundChanges = themeDefinitionSchema.shape.media.partial();
const slideChanges = z.object({ background: backgroundChanges.optional(), main: textChanges.optional(), credits: textChanges.optional() });
const themeChanges = z
  .object({ song: slideChanges.optional(), bible: slideChanges.optional(), media: backgroundChanges.optional() })
  .describe(
    "What to change, the rest kept: a song's or a Bible text's slide (its background, main text and credits) and a picture's or a video's " +
      'background. A colour is CSS ("#ffffff", "rgba(255, 255, 255, 0.4)"); a background picture is {kind: "picture", full, thumb} ' +
      `from add_picture_from_url, or null for none. ${STAGE}`,
  );
type ThemeChanges = z.output<typeof themeChanges>;

/** `definition` with `changes` over it, checked as a theme is wherever it is read. */
function changed(definition: ThemeDefinition, changes: ThemeChanges | undefined): ThemeDefinition {
  if (!changes) return definition;
  const slide = (s: ThemeDefinition['song'], c: ThemeChanges['song']) =>
    c ? { background: { ...s.background, ...c.background }, main: { ...s.main, ...c.main }, credits: { ...s.credits, ...c.credits } } : s;
  const next = themeDefinitionSchema.safeParse({ song: slide(definition.song, changes.song), bible: slide(definition.bible, changes.bible), media: { ...definition.media, ...changes.media } });
  if (!next.success) throw new MutationError('invalid-theme', z.prettifyError(next.error));
  return next.data;
}

const defaultThemeId = async (sql: RunSql) => String((await defaultThemeIdView({}, sql)) ?? DEFAULT_THEME_ID);

/** A theme the organisation can use, built in or its own, with whether it is built in. */
async function themeOf(sql: RunSql, themeId: string): Promise<{ theme: Theme; builtIn: boolean }> {
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (builtIn) return { theme: JSON.parse(JSON.stringify(builtIn)) as Theme, builtIn: true };
  const own = (await ownThemeView({ id: themeId }, sql)) as { theme: Theme } | null;
  if (!own) throw new MutationError('theme-not-found', 'Theme not found.');
  return { theme: own.theme, builtIn: false };
}

async function themeAnswer(sql: RunSql, themeId: string) {
  const { theme, builtIn } = await themeOf(sql, themeId);
  return { id: theme.id, name: theme.name, builtIn, isDefault: theme.id === (await defaultThemeId(sql)), definition: theme.definition };
}

// ------------------------------------------------------------------ overlays

const elements = customPageSchema.shape.elements.describe(
  `The overlay's texts, pictures and shapes, the first drawn first; each has an id of your choosing, unique in the overlay. ${STAGE} ` +
    'A text: {id, kind: "text", x, y, w, h, text, size (px), bold, italic, align, color (null: the theme\'s)}; it grows downwards with its words. ' +
    'A picture: {id, kind: "image", x, y, w, h, picture: {full, thumb} from add_picture_from_url, fit: "contain", tint (optional, "#rrggbb": every pixel not see-through in that colour, a black logo made white)}. ' +
    'Nothing under them: an overlay has no background of its own, the slide shows through.',
);

async function overlay(sql: RunSql, overlayId: string) {
  const row = (await overlayRowView({ id: overlayId }, sql)) as Row | null;
  if (!row) throw new MutationError('not-found', 'no such overlay');
  return { id: row.id, title: row.title, elements: parseCustomPage(row.content as string | null).elements };
}

const overlayPage = (e: z.output<typeof elements>) => ({ ...blankPage(), elements: e });

// ------------------------------------------------------------------ the tools

export const LOOK_TOOLS: Record<string, Tool<z.ZodType>> = {
  list_themes: tool({
    kind: 'read',
    description: "Lists the themes a presentation can have: the built-in ones, then the organisation's own, and which is the default.",
    args: z.object({}),
    run: async (_a, cx) => {
      const isDefault = await defaultThemeId(cx.sql);
      const own = ((await ownThemesView({}, cx.sql)) as Theme[]).map((t) => ({ id: t.id, name: t.name, builtIn: false }));
      const builtIn = BUILT_IN_THEMES.filter((t) => !PLAYFUL_THEME_IDS.has(t.id) || t.id === isDefault).map((t) => ({ id: t.id, name: t.name, builtIn: true }));
      return [...builtIn, ...own].map((t) => ({ ...t, isDefault: t.id === isDefault }));
    },
  }),
  get_theme: tool({
    kind: 'read',
    description: "A theme's whole look: per kind of slide its background and its texts' font, size, weight, colour, alignment and box.",
    args: z.object({ themeId: id }),
    run: (a, cx) => themeAnswer(cx.sql, a.themeId),
  }),
  create_theme: tool({
    kind: 'change',
    description: "Makes an own theme as a copy of another (the default if none is named), with changes. Needs an Admin. Returns it whole.",
    args: z.object({ name: z.string().trim().min(1).max(100), basedOn: id.optional().describe('The theme to copy (list_themes).'), changes: themeChanges.optional() }),
    run: async (a, cx) => {
      const { theme } = await themeOf(cx.sql, a.basedOn ?? (await defaultThemeId(cx.sql)));
      const themeId = cx.newId();
      await cx.mutate('createTheme', { id: themeId, name: a.name, definition: changed(theme.definition, a.changes), at: cx.now() });
      return themeAnswer(cx.sql, themeId);
    },
  }),
  update_theme: tool({
    kind: 'change',
    description: 'Renames an own theme or changes its look; a built-in one is not changed (create_theme copies it). Needs an Admin. Returns it whole.',
    args: z.object({ themeId: id, name: z.string().trim().min(1).max(100).optional(), changes: themeChanges.optional() }),
    // Read, changed and written in one turn: a device's save in between would otherwise be written over.
    run: (a, cx) =>
      cx.atomic(async (one) => {
        const { theme } = await themeOf(one.sql, a.themeId);
        await one.mutate('updateTheme', { id: a.themeId, name: a.name, definition: a.changes ? changed(theme.definition, a.changes) : undefined, at: one.now() });
        return themeAnswer(one.sql, a.themeId);
      }),
  }),
  set_default_theme: tool({
    kind: 'change',
    description: "Makes a theme the organisation's default: every presentation without a theme of its own shows it at once. Needs an Admin.",
    args: z.object({ themeId: id }),
    run: async (a, cx) => {
      await cx.mutate('setDefaultTheme', { themeId: a.themeId });
      return themeAnswer(cx.sql, a.themeId);
    },
  }),
  delete_theme: tool({
    kind: 'remove',
    description: "Deletes an own theme for good; presentations that showed it follow the default. It cannot be undone: ask the user first. Needs an Admin.",
    args: z.object({ themeId: id }),
    run: async (a, cx) => {
      await themeOf(cx.sql, a.themeId);
      await cx.mutate('deleteTheme', { id: a.themeId });
      return { deleted: a.themeId };
    },
  }),
  list_overlays: tool({
    kind: 'read',
    description: "Lists the organisation's overlays: what is drawn over an item's slides when the item carries it (set_item_overlay).",
    args: z.object({}),
    run: async (_a, cx) => ((await overlaysView({}, cx.sql)) as Row[]).map((r) => ({ id: r.id, title: r.title })),
  }),
  get_overlay: tool({
    kind: 'read',
    description: `An overlay's name and its elements. ${STAGE}`,
    args: z.object({ overlayId: id }),
    run: (a, cx) => overlay(cx.sql, a.overlayId),
  }),
  create_overlay: tool({
    kind: 'change',
    description: 'Makes an overlay with its elements. Returns its id and the overlay.',
    args: z.object({ title: z.string().trim().min(1).max(200), elements: elements.optional() }),
    run: async (a, cx) => {
      const overlayId = cx.newId();
      await cx.mutate('createOverlay', { id: overlayId, title: a.title, page: overlayPage(a.elements ?? []), at: cx.now() });
      return { overlayId, overlay: await overlay(cx.sql, overlayId) };
    },
  }),
  update_overlay: tool({
    kind: 'change',
    description: 'Renames an overlay or writes its elements anew: give every element it is to have (get_overlay), changed ones and kept ones alike.',
    args: z.object({ overlayId: id, title: z.string().trim().min(1).max(200).optional(), elements: elements.optional() }),
    run: async (a, cx) => {
      await overlay(cx.sql, a.overlayId);
      await cx.mutate('updateOverlay', { id: a.overlayId, title: a.title, page: a.elements ? overlayPage(a.elements) : undefined, at: cx.now() });
      return { overlay: await overlay(cx.sql, a.overlayId) };
    },
  }),
  delete_overlay: tool({
    kind: 'remove',
    description: 'Deletes an overlay for good; items that carried it carry none. It cannot be undone: ask the user first.',
    args: z.object({ overlayId: id }),
    run: async (a, cx) => {
      await overlay(cx.sql, a.overlayId);
      await cx.mutate('deleteOverlay', { id: a.overlayId });
      return { deleted: a.overlayId };
    },
  }),
  add_picture_from_url: tool({
    kind: 'change',
    openWorld: true,
    description:
      'Fetches a picture (PNG, JPEG, WebP or SVG, at most 10 MB) from an https address and keeps it for this organisation, made to fit ' +
      '1920×1080 as the app makes a picture it imports; a PNG or an SVG keeps its transparency, so a logo can stand on a slide. An SVG is ' +
      "drawn as a picture filling 1920×1080, without fonts: its letters show only if they are shapes, as a logo's mostly are. Returns " +
      "{picture: {full, thumb}, width, height}, to put in an overlay's picture element or a theme's background.",
    // https only, which the server checks (apps/server/src/picture-fetch.ts), as a test build serves its pictures over http.
    args: z.object({ url: z.url({ protocol: /^https?$/ }).max(2000).describe('An https address of the picture itself, not of a page showing it.') }),
    run: (a, cx: McpToolContext) => cx.importPicture(a.url),
  }),
};
