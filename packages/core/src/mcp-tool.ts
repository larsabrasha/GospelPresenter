// What every MCP tool is made of (docs/mcp.md): the context it runs in, its shape, and the small readers the tools
// share. The tools themselves are in mcp-tools.ts (presentations, songs, Bible texts) and mcp-tools-looks.ts (themes,
// overlays and their pictures).
import { z } from 'zod';
import type { Picture } from './custom-slides.ts';
import type { MutatorName } from './mutator-args.ts';
import type { RunSql } from './views/sql.ts';

/** A picture the server fetched and stored, as a page or a theme names it, and its full size in pixels. */
export interface ImportedPicture {
  picture: Picture;
  width: number;
  height: number;
}

/** What a tool runs on: the organisation's database, and its mutators as the key's maker. */
export interface McpToolContext {
  sql: RunSql;
  /** Runs a mutator, committed with its change log and announced to the devices; throws MutationError when refused. */
  mutate(name: MutatorName, args: object): Promise<void>;
  /**
   * Runs `fn` with nothing else of the organisation's in between: for a change made from what was just read (a theme's
   * definition with some fields changed), so a device's push in between is not written over. Each read and change
   * otherwise waits its own turn.
   */
  atomic<T>(fn: (cx: McpToolContext) => Promise<T>): Promise<T>;
  /**
   * Fetches a picture from the web, fits it within 1920×1080 and 400×225 as the app's import does, and stores both as
   * the organisation's blobs; throws MutationError when the address or the file is refused.
   */
  importPicture(url: string): Promise<ImportedPicture>;
  newId(): string;
  now(): number;
}

/** A tool as `tools/list` describes it; its annotations tell a client which tools only read and which remove. */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
}

/** A tool's answer as `tools/call` gives it: its result as JSON text, or why it was refused. */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface Tool<S extends z.ZodType> {
  /** `read` changes nothing; `change` adds or edits; `remove` deletes what cannot be brought back. */
  kind: 'read' | 'change' | 'remove';
  /** It reaches outside the organisation: the web. */
  openWorld?: boolean;
  description: string;
  args: S;
  run(a: z.output<S>, cx: McpToolContext): Promise<unknown>;
}
export const tool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool<z.ZodType>;

export const LOCALE = { locale: 'sv' };
export const id = z.string().min(1).max(100);

export type Row = Record<string, unknown>;
export const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
