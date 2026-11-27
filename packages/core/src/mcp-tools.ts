// The MCP tools (docs/mcp.md): what an assistant reads and changes in an organisation through an MCP key. Each read is
// the views the app reads, each change a mutator, run as the key's maker, so a change reaches every device as any other
// does and is refused as it would be for them in the app. The transport (JSON-RPC over HTTP) is the server's.
import { z } from 'zod';
import { FIELD_RULES, MAX_VERSES_PER_ITEM, MutationError } from './mutation.ts';
import type { MutatorName } from './mutator-args.ts';
import { prepareSong, rankSongs } from './search.ts';
import { bibleItemTitle, type Verse } from './bible.ts';
import { id, LOCALE, pick, tool, type McpToolContext, type McpToolInfo, type McpToolResult, type Row, type Tool } from './mcp-tool.ts';
import { LOOK_TOOLS } from './mcp-tools-looks.ts';
import { bibleView, verseSearchPlanView } from './views/slides-bible.ts';
import { biblesView } from './views/lists-settings.ts';
import { itemsView, presentationListView, templatesView } from './views/lists.ts';
import { libraryLyrics, songPageView, songsView } from './views/lists-songs.ts';
import type { RunSql } from './views/sql.ts';

export type { ImportedPicture, McpToolContext, McpToolInfo, McpToolResult } from './mcp-tool.ts';

const limit = (dflt: number, max: number) => z.number().int().min(1).max(max).default(dflt).describe(`At most this many (${dflt} if left out).`);
const after = id.optional().describe("Add it right after this item of the running order; at the end if left out.");
// A presentation's fields, within the limits the app keeps (FIELD_RULES); the mutator checks them again.
const title = z.string().trim().min(1).max(FIELD_RULES.name.max);
const eventDate = z.iso.date().describe('YYYY-MM-DD');
const eventTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('HH:MM');
const eventLocation = z.string().max(FIELD_RULES.location.max);
const eventDescription = z.string().max(FIELD_RULES.description.max);

const songRow = (r: Row) => pick(r, ['id', 'name', 'author', 'ccli']);
const presentationRow = (r: Row) => pick(r, ['id', 'name', 'eventDate', 'time', 'location', 'description', 'themeId']);

/** The songs, by name; with a query, the ones that match, best first, as the songs page's search ranks them (SONG-R30). */
async function songs(sql: RunSql, query: string | undefined, max: number) {
  const all = (await songsView(LOCALE, sql)) as Row[];
  if (!query?.trim()) return all.slice(0, max).map(songRow);
  const lyrics = await libraryLyrics(sql);
  const prepared = new Map(
    all.map((s) => {
      const parts = lyrics.get(String(s.id)) ?? [];
      return [s, prepareSong({ name: String(s.name), author: String(s.author ?? ''), firstPart: parts[0] ?? '', lyrics: parts.join('\n') })];
    }),
  );
  return rankSongs(all, (s) => prepared.get(s)!, query).slice(0, max).map(songRow);
}

/** A song's text part by part with each part's label, and its arrangements as orders of those parts. */
async function song(sql: RunSql, songId: string) {
  const page = (await songPageView({ id: songId }, sql)) as { song: Row | null; parts: Row[]; arrangements: Row[]; labels: Row[] };
  // A trashed song, or a draft not yet made with Skapa, is in no list, so not here either.
  if (!page.song || page.song.deletedAt !== null || page.song.draft !== null) throw new MutationError('not-found', 'no such song');
  const labels = new Map(page.labels.map((l) => [l.id, l.text]));
  const parts = page.parts.map((p) => ({ id: p.id, label: labels.get(p.labelId) ?? null, text: p.content }));
  const arrangements = page.arrangements.map((a) => ({ id: a.id, name: a.name, partIds: JSON.parse(String(a.partIds)) as string[] }));
  return { ...songRow(page.song), publisher: page.song.publisher ?? null, year: page.song.year ?? null, parts, arrangements };
}

/**
 * Refuses an id that is not a presentation outside the trash: the tools change presentations, never a template, which
 * is an Admin's and waits for a later round (docs/mcp.md).
 */
async function requirePresentation(sql: RunSql, presentationId: string) {
  const [p] = await sql('SELECT id FROM presentations WHERE id = ? AND deleted_at IS NULL AND is_template = 0', [presentationId]);
  if (!p) throw new MutationError('not-found', 'no such presentation');
}

/** The presentation an item is in, refused as `requirePresentation` refuses. */
async function presentationOfItem(sql: RunSql, itemId: string): Promise<string> {
  const [r] = await sql(
    'SELECT i.presentation_id FROM presentation_items i JOIN presentations p ON p.id = i.presentation_id WHERE i.id = ? AND p.deleted_at IS NULL AND p.is_template = 0',
    [itemId],
  );
  if (!r) throw new MutationError('not-found', 'no such item in a presentation');
  return String(r[0]);
}

async function presentation(sql: RunSql, presentationId: string) {
  await requirePresentation(sql, presentationId);
  const row = ((await presentationListView({}, sql)) as Row[]).find((r) => r.id === presentationId)!;
  const items = ((await itemsView({ presentationId }, sql)) as Row[]).map((i) => pick(i, ['id', 'type', 'title', 'sourceId', 'arrangementId', 'overlayId', 'note']));
  return { ...presentationRow(row), items };
}

/** A translation's row: its text's hash, and the codes of the books stored here. */
async function bible(sql: RunSql, bibleId: string) {
  const row = ((await biblesView(LOCALE, sql)) as Row[]).find((b) => b.id === bibleId);
  if (!row) throw new MutationError('not-found', 'no such Bible');
  const text = (await bibleView({ hash: row.contentHash }, sql)) as { books: string[] } | null;
  if (!text) throw new MutationError('not-found', 'the text of this Bible is not on the server');
  return { row, books: text.books };
}

/** The verses a reference names ("Joh 3:16-18", "Psaltaren 23"), as the Bible tab reads one (BIBLE-R11). */
async function passage(sql: RunSql, bibleId: string, reference: string): Promise<{ abbreviation: string; verses: Verse[] }> {
  const { row, books } = await bible(sql, bibleId);
  const plan = verseSearchPlanView({ query: reference, available: books });
  if (!plan) throw new MutationError('not-found', `no passage reads as "${reference}"`);
  const read = (await bibleView({ hash: row.contentHash, passage: { books: plan.codes, from: plan.from, to: plan.to } }, sql)) as { passage: Verse[] };
  if (!read.passage.length) throw new MutationError('not-found', `no verses in "${reference}"`);
  if (read.passage.length > MAX_VERSES_PER_ITEM) throw new MutationError('too-many', `${read.passage.length} verses; at most ${MAX_VERSES_PER_ITEM}`);
  return { abbreviation: String(row.abbreviation), verses: read.passage };
}

/** A change to a presentation's items: runs the mutator, and answers with the presentation as it is after it. */
async function changeItem(cx: McpToolContext, itemId: string, mutator: MutatorName, args: object) {
  const presentationId = await presentationOfItem(cx.sql, itemId);
  await cx.mutate(mutator, { itemId, ...args });
  return { presentation: await presentation(cx.sql, presentationId) };
}

/** Adds an item to a presentation (never a template) through `mutator`; its id and the presentation after it. */
async function addItem(cx: McpToolContext, presentationId: string, mutator: MutatorName, args: object) {
  await requirePresentation(cx.sql, presentationId);
  const itemId = cx.newId();
  await cx.mutate(mutator, { itemId, presentationId, ...args });
  return { itemId, presentation: await presentation(cx.sql, presentationId) };
}

/** `reorder_items`' list must be the running order's items, each once: one left out would silently go last. */
async function requireAllItems(sql: RunSql, presentationId: string, itemIds: string[]) {
  const current = ((await itemsView({ presentationId }, sql)) as Row[]).map((i) => String(i.id));
  const missing = current.filter((x) => !itemIds.includes(x));
  const unknown = itemIds.filter((x) => !current.includes(x));
  const twice = itemIds.filter((x, i) => itemIds.indexOf(x) !== i);
  if (missing.length || unknown.length || twice.length) {
    throw new MutationError('invalid-order', `every item once: missing ${JSON.stringify(missing)}, not in it ${JSON.stringify(unknown)}, twice ${JSON.stringify(twice)}`);
  }
}

const nullable = <T extends z.ZodType>(t: T, what: string) => t.nullable().optional().describe(`${what}; left out keeps it, null clears it.`);

const TOOLS: Record<string, Tool<z.ZodType>> = {
  search_songs: tool({
    kind: 'read',
    description: "Searches the organisation's song library by name, author and lyrics, best match first.",
    args: z.object({ query: z.string().min(1).max(200), limit: limit(20, 100) }),
    run: (a, cx) => songs(cx.sql, a.query, a.limit),
  }),
  list_songs: tool({
    kind: 'read',
    description: "Lists the organisation's songs by name.",
    args: z.object({ limit: limit(200, 5000) }),
    run: (a, cx) => songs(cx.sql, undefined, a.limit),
  }),
  get_song: tool({
    kind: 'read',
    description: "A song's details, its text part by part (each with its label, such as Vers 1 or Refräng), and its arrangements as orders of part ids.",
    args: z.object({ songId: id }),
    run: (a, cx) => song(cx.sql, a.songId),
  }),
  list_presentations: tool({
    kind: 'read',
    description: 'Lists the presentations (running orders of a service), the latest date first; those without a date last.',
    args: z.object({ limit: limit(30, 500) }),
    run: async (a, cx) => ((await presentationListView({}, cx.sql)) as Row[]).slice(0, a.limit).map(presentationRow),
  }),
  get_presentation: tool({
    kind: 'read',
    description: "A presentation's details and its running order: each item's id, type (song, bible, header, image, ...), title and note.",
    args: z.object({ presentationId: id }),
    run: (a, cx) => presentation(cx.sql, a.presentationId),
  }),
  list_templates: tool({
    kind: 'read',
    description: 'Lists the templates a new presentation can start from, with their weekday (0 Sunday, 1 Monday, ... 6 Saturday), time and place.',
    args: z.object({}),
    run: async (_a, cx) => ((await templatesView(LOCALE, cx.sql)) as Row[]).map((r) => pick(r, ['id', 'name', 'weekday', 'time', 'location'])),
  }),
  create_presentation: tool({
    kind: 'change',
    description: "Creates a presentation, empty or as a copy of a template's running order. Returns its id and the presentation.",
    args: z.object({
      name: title,
      eventDate: eventDate.optional(),
      time: eventTime.optional(),
      location: eventLocation.optional(),
      description: eventDescription.optional(),
      templateId: id.optional().describe('Start from this template (list_templates).'),
    }),
    run: async (a, cx) => {
      const presentationId = cx.newId();
      const event = { eventDate: a.eventDate ?? null, time: a.time ?? null, location: a.location ?? null, description: a.description ?? null };
      if (a.templateId) {
        const items = ((await itemsView({ presentationId: a.templateId }, cx.sql)) as Row[]).map((i) => ({ from: String(i.id), id: cx.newId() }));
        await cx.mutate('createFromTemplate', { id: presentationId, templateId: a.templateId, name: a.name, items, at: cx.now(), ...event });
      } else await cx.mutate('createPresentation', { id: presentationId, name: a.name, ...event });
      return { presentationId, presentation: await presentation(cx.sql, presentationId) };
    },
  }),
  update_presentation: tool({
    kind: 'change',
    description: "Changes a presentation's name, date, time, place, description or theme. Answers with the presentation after it.",
    args: z.object({
      presentationId: id,
      name: title.optional().describe('Left out keeps it.'),
      eventDate: nullable(eventDate, 'YYYY-MM-DD'),
      time: nullable(eventTime, 'HH:MM'),
      location: nullable(eventLocation, 'The place'),
      description: nullable(eventDescription, 'The description'),
      themeId: nullable(id, "Its theme (list_themes); null follows the organisation's default"),
    }),
    run: async ({ presentationId, ...fields }, cx) => {
      await requirePresentation(cx.sql, presentationId);
      await cx.mutate('updatePresentation', { id: presentationId, ...fields });
      return { presentation: await presentation(cx.sql, presentationId) };
    },
  }),
  add_song_to_presentation: tool({
    kind: 'change',
    description: "Adds a song to a presentation's running order, in one of its arrangements or as written. Returns the new item's id and the presentation.",
    args: z.object({ presentationId: id, songId: id, arrangementId: id.optional().describe("One of the song's arrangements (get_song)."), afterItemId: after }),
    run: (a, cx) => addItem(cx, a.presentationId, 'addSongToPresentation', { songId: a.songId, arrangementId: a.arrangementId ?? null, afterItemId: a.afterItemId ?? null }),
  }),
  add_header_to_presentation: tool({
    kind: 'change',
    description: 'Adds a heading to the running order: a name that groups the items after it, or a point with no slides ("Kollekt", "Predikan"). Returns its id and the presentation.',
    args: z.object({ presentationId: id, title, afterItemId: after }),
    run: (a, cx) => addItem(cx, a.presentationId, 'addHeaderToPresentation', { title: a.title, afterItemId: a.afterItemId ?? null }),
  }),
  reorder_items: tool({
    kind: 'change',
    description: "Puts a presentation's items in a new order. Give every item id of its running order (get_presentation) once, in the order wanted.",
    args: z.object({ presentationId: id, itemIds: z.array(id).min(1).max(1000) }),
    run: async (a, cx) => {
      await requirePresentation(cx.sql, a.presentationId);
      await requireAllItems(cx.sql, a.presentationId, a.itemIds);
      await cx.mutate('reorderItems', { presentationId: a.presentationId, itemIds: a.itemIds });
      return { presentation: await presentation(cx.sql, a.presentationId) };
    },
  }),
  rename_item: tool({
    kind: 'change',
    description: "Renames an item of a running order, as it shows in the list; a song item's song keeps its name.",
    args: z.object({ itemId: id, title }),
    run: (a, cx) => changeItem(cx, a.itemId, 'renameItem', { title: a.title }),
  }),
  set_item_note: tool({
    kind: 'change',
    description: "Sets an item's note, for those who run the service (never shown on a screen); an empty note removes it.",
    args: z.object({ itemId: id, note: z.string().max(FIELD_RULES.itemNote.max) }),
    run: (a, cx) => changeItem(cx, a.itemId, 'setItemNote', { note: a.note }),
  }),
  update_item_arrangement: tool({
    kind: 'change',
    description: "Chooses the arrangement a song item shows (get_song lists the song's); null shows the song's default.",
    args: z.object({ itemId: id, arrangementId: id.nullable() }),
    run: (a, cx) => changeItem(cx, a.itemId, 'setItemArrangement', { arrangementId: a.arrangementId }),
  }),
  set_item_overlay: tool({
    kind: 'change',
    description: "Puts an overlay (list_overlays) over an item's slides, such as the Swish number over the collection's song; null takes it away.",
    args: z.object({ itemId: id, overlayId: id.nullable() }),
    run: (a, cx) => changeItem(cx, a.itemId, 'setItemOverlay', { overlayId: a.overlayId }),
  }),
  remove_item: tool({
    kind: 'remove',
    description: 'Removes an item from a running order. It cannot be undone, in the app either: ask the user before removing.',
    args: z.object({ itemId: id }),
    run: (a, cx) => changeItem(cx, a.itemId, 'removeItem', {}),
  }),
  list_bibles: tool({
    kind: 'read',
    description: "Lists the organisation's Bible translations.",
    args: z.object({}),
    run: async (_a, cx) => ((await biblesView(LOCALE, cx.sql)) as Row[]).map((r) => pick(r, ['id', 'name', 'abbreviation', 'language'])),
  }),
  get_bible_verses: tool({
    kind: 'read',
    description: 'The verses of a passage in a translation. The reference is as typed in the app: "Joh 3:16", "Johannes 3:16-18", "Ps 23", "Rom 8:28-9:2".',
    args: z.object({ bibleId: id, reference: z.string().min(1).max(200) }),
    run: async (a, cx) => {
      const { abbreviation, verses } = await passage(cx.sql, a.bibleId, a.reference);
      return { title: bibleItemTitle(verses), translation: abbreviation, verses };
    },
  }),
  add_bible_text_to_presentation: tool({
    kind: 'change',
    description: "Adds a Bible passage to a presentation's running order, its slides made as the app makes them. Returns the new item's id and title, and the presentation.",
    args: z.object({ presentationId: id, bibleId: id, reference: z.string().min(1).max(200).describe('As for get_bible_verses.'), afterItemId: after }),
    run: async (a, cx) => {
      await requirePresentation(cx.sql, a.presentationId);
      const { abbreviation, verses } = await passage(cx.sql, a.bibleId, a.reference);
      const added = await addItem(cx, a.presentationId, 'addBibleToPresentation', { bibleId: a.bibleId, translation: abbreviation, verses, afterItemId: a.afterItemId ?? null });
      return { itemId: added.itemId, title: bibleItemTitle(verses), presentation: added.presentation };
    },
  }),
  ...LOOK_TOOLS,
};

/** Every tool, as `tools/list` answers. */
export function mcpTools(): McpToolInfo[] {
  return Object.entries(TOOLS).map(([name, t]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(t.args, { io: 'input' }) as Record<string, unknown>;
    return { name, description: t.description, inputSchema, annotations: { readOnlyHint: t.kind === 'read', destructiveHint: t.kind === 'remove', openWorldHint: !!t.openWorld } };
  });
}

/** Whether `name` is a tool. */
export const isMcpTool = (name: string) => Object.hasOwn(TOOLS, name);

const text = (value: unknown, isError = false): McpToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError } : {}) });

/**
 * Runs the tool `name` (`isMcpTool`). Arguments that do not read, and a refusal (not found, no permission, a limit),
 * are answered as the tool's error, which the assistant reads and can act on; anything else is thrown.
 */
export async function callMcpTool(name: string, args: unknown, cx: McpToolContext): Promise<McpToolResult> {
  const t = TOOLS[name]!;
  const parsed = t.args.safeParse(args ?? {});
  if (!parsed.success) return text({ error: 'invalid-arguments', detail: z.prettifyError(parsed.error) }, true);
  try {
    return text(await t.run(parsed.data, cx));
  } catch (e) {
    if (e instanceof MutationError) return text({ error: e.code, detail: e.message }, true);
    throw e;
  }
}
