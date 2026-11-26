// The MCP tools (docs/mcp.md): what an assistant reads and changes in an organisation through an MCP key. Each read is
// the views the app reads, each change a mutator, run as the key's maker, so a change reaches every device as any other
// does and is refused as it would be for them in the app. The transport (JSON-RPC over HTTP) is the server's.
import { z } from 'zod';
import { MAX_VERSES_PER_ITEM, MutationError } from './mutation.ts';
import type { MutatorName } from './mutator-args.ts';
import { prepareSong, rankSongs } from './search.ts';
import { bibleItemTitle, type Verse } from './bible.ts';
import { bibleView, verseSearchPlanView } from './views/slides-bible.ts';
import { biblesView } from './views/lists-settings.ts';
import { itemsView, presentationListView, templatesView } from './views/lists.ts';
import { libraryLyrics, songPageView, songsView } from './views/lists-songs.ts';
import type { RunSql } from './views/sql.ts';

/** What a tool runs on: the organisation's database, and its mutators as the key's maker. */
export interface McpToolContext {
  sql: RunSql;
  /** Runs a mutator, committed with its change log and announced to the devices; throws MutationError when refused. */
  mutate(name: MutatorName, args: object): Promise<void>;
  newId(): string;
  now(): number;
}

/** A tool as `tools/list` describes it. */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool's answer as `tools/call` gives it: its result as JSON text, or why it was refused. */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const LOCALE = { locale: 'sv' };
const id = z.string().min(1).max(100);
const limit = (dflt: number, max: number) => z.number().int().min(1).max(max).default(dflt).describe(`At most this many (${dflt} if left out).`);
const after = id.optional().describe("Add it right after this item of the running order; at the end if left out.");

type Row = Record<string, unknown>;
const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
const songRow = (r: Row) => pick(r, ['id', 'name', 'author', 'ccli']);
const presentationRow = (r: Row) => pick(r, ['id', 'name', 'eventDate', 'time', 'location', 'description']);

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

async function presentation(sql: RunSql, presentationId: string) {
  const [p] = (await sql('SELECT id FROM presentations WHERE id = ? AND deleted_at IS NULL AND is_template = 0', [presentationId])) as unknown[][];
  if (!p) throw new MutationError('not-found', 'no such presentation');
  const row = ((await presentationListView({}, sql)) as Row[]).find((r) => r.id === presentationId)!;
  const items = ((await itemsView({ presentationId }, sql)) as Row[]).map((i) => pick(i, ['id', 'type', 'title', 'sourceId', 'arrangementId', 'note']));
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

interface Tool<S extends z.ZodType> {
  description: string;
  args: S;
  run(a: z.output<S>, cx: McpToolContext): Promise<unknown>;
}
const tool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool<z.ZodType>;

const TOOLS: Record<string, Tool<z.ZodType>> = {
  search_songs: tool({
    description: "Searches the organisation's song library by name, author and lyrics, best match first.",
    args: z.object({ query: z.string().min(1).max(200), limit: limit(20, 100) }),
    run: (a, cx) => songs(cx.sql, a.query, a.limit),
  }),
  list_songs: tool({
    description: "Lists the organisation's songs by name.",
    args: z.object({ limit: limit(200, 5000) }),
    run: (a, cx) => songs(cx.sql, undefined, a.limit),
  }),
  get_song: tool({
    description: "A song's details, its text part by part (each with its label, such as Vers 1 or Refräng), and its arrangements as orders of part ids.",
    args: z.object({ songId: id }),
    run: (a, cx) => song(cx.sql, a.songId),
  }),
  list_presentations: tool({
    description: 'Lists the presentations (running orders of a service), the latest date first; those without a date last.',
    args: z.object({ limit: limit(30, 500) }),
    run: async (a, cx) => ((await presentationListView({}, cx.sql)) as Row[]).slice(0, a.limit).map(presentationRow),
  }),
  get_presentation: tool({
    description: "A presentation's details and its running order: each item's id, type (song, bible, header, image, ...), title and note.",
    args: z.object({ presentationId: id }),
    run: (a, cx) => presentation(cx.sql, a.presentationId),
  }),
  list_templates: tool({
    description: 'Lists the templates a new presentation can start from, with their weekday (1 Monday to 7 Sunday), time and place.',
    args: z.object({}),
    run: async (_a, cx) => ((await templatesView(LOCALE, cx.sql)) as Row[]).map((r) => pick(r, ['id', 'name', 'weekday', 'time', 'location'])),
  }),
  create_presentation: tool({
    description: "Creates a presentation, empty or as a copy of a template's running order. Returns its id.",
    args: z.object({
      name: z.string().trim().min(1).max(200),
      eventDate: z.iso.date().optional().describe('YYYY-MM-DD'),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe('HH:MM'),
      location: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      templateId: id.optional().describe('Start from this template (list_templates).'),
    }),
    run: async (a, cx) => {
      const presentationId = cx.newId();
      const event = { eventDate: a.eventDate ?? null, time: a.time ?? null, location: a.location ?? null, description: a.description ?? null };
      if (a.templateId) {
        const items = ((await itemsView({ presentationId: a.templateId }, cx.sql)) as Row[]).map((i) => ({ from: String(i.id), id: cx.newId() }));
        await cx.mutate('createFromTemplate', { id: presentationId, templateId: a.templateId, name: a.name, items, at: cx.now(), ...event });
      } else await cx.mutate('createPresentation', { id: presentationId, name: a.name, ...event });
      return { presentationId };
    },
  }),
  add_song_to_presentation: tool({
    description: "Adds a song to a presentation's running order, in one of its arrangements or as written. Returns the new item's id.",
    args: z.object({ presentationId: id, songId: id, arrangementId: id.optional().describe("One of the song's arrangements (get_song)."), afterItemId: after }),
    run: async (a, cx) => {
      const itemId = cx.newId();
      await cx.mutate('addSongToPresentation', { itemId, presentationId: a.presentationId, songId: a.songId, arrangementId: a.arrangementId ?? null, afterItemId: a.afterItemId ?? null });
      return { itemId };
    },
  }),
  list_bibles: tool({
    description: "Lists the organisation's Bible translations.",
    args: z.object({}),
    run: async (_a, cx) => ((await biblesView(LOCALE, cx.sql)) as Row[]).map((r) => pick(r, ['id', 'name', 'abbreviation', 'language'])),
  }),
  get_bible_verses: tool({
    description: 'The verses of a passage in a translation. The reference is as typed in the app: "Joh 3:16", "Johannes 3:16-18", "Ps 23", "Rom 8:28-9:2".',
    args: z.object({ bibleId: id, reference: z.string().min(1).max(200) }),
    run: async (a, cx) => {
      const { abbreviation, verses } = await passage(cx.sql, a.bibleId, a.reference);
      return { title: bibleItemTitle(verses), translation: abbreviation, verses };
    },
  }),
  add_bible_text_to_presentation: tool({
    description: "Adds a Bible passage to a presentation's running order, its slides made as the app makes them. Returns the new item's id and title.",
    args: z.object({ presentationId: id, bibleId: id, reference: z.string().min(1).max(200).describe('As for get_bible_verses.'), afterItemId: after }),
    run: async (a, cx) => {
      const { abbreviation, verses } = await passage(cx.sql, a.bibleId, a.reference);
      const itemId = cx.newId();
      await cx.mutate('addBibleToPresentation', { itemId, presentationId: a.presentationId, bibleId: a.bibleId, translation: abbreviation, verses, afterItemId: a.afterItemId ?? null });
      return { itemId, title: bibleItemTitle(verses) };
    },
  }),
};

/** Every tool, as `tools/list` answers. */
export function mcpTools(): McpToolInfo[] {
  return Object.entries(TOOLS).map(([name, t]) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(t.args, { io: 'input' }) as Record<string, unknown>;
    return { name, description: t.description, inputSchema };
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
