import { songNameKey, type ImportedSong, type MutatorArgs } from '@gp/core';
import { t } from '../i18n.ts';

// What the ProPresenter import on Sånger sends and says (spec 02 "Import card", SONG-R42 as changed on
// 2026-10-31): the songs read from the files with ids of their own, which of them share a name with a
// song in the library or earlier in the import, whether their text is the same, what the importer chose
// for each, and the result line once they are written.

type ImportArgs = MutatorArgs<'importSongs'>;
export type PlannedSong = Omit<ImportArgs['songs'][number], 'replaces'>;

/** At most this many songs go in one `importSongs` mutation (its argument limit). */
export const IMPORT_BATCH = 500;

/** A file larger than this is not read (spec 02: 25 MB per file). */
export const MAX_PRO_BYTES = 25 * 1024 * 1024;

/** A library song whose name an imported song has, with its parts' text in order. */
export interface LibrarySong {
  id: string;
  name: string;
  text: string;
}

/** Skip the file's song, replace the library's with it, or add it beside the other. */
export type DuplicateChoice = 'skip' | 'replace' | 'keep';

export interface Duplicate {
  /** Its index in `ImportPlan.songs`. */
  index: number;
  name: string;
  text: string;
  /** The song it shares its name with: in the library (an id), or earlier in this import (no id, so it can only be skipped or kept). */
  other: { id: string | null; text: string };
  /** Whether the text is the same, as `sameText` has it. */
  same: boolean;
}

export interface ImportPlan {
  songs: PlannedSong[];
  /** The songs that share a name, in file order. */
  duplicates: Duplicate[];
}

/** A song's text as compared and shown: its parts, a blank line between. */
export const songText = (parts: { content: string }[]) => parts.map((p) => p.content).join('\n\n');

/** The same words in the same order: spaces, line breaks and blank lines do not count. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** The library songs to compare with: those whose name one of the read songs has (case and composition aside). */
export function namesakes<S extends { name: string }>(read: ImportedSong[], library: S[]): S[] {
  const keys = new Set(read.map((s) => songNameKey(s.name)));
  return library.filter((s) => keys.has(songNameKey(s.name)));
}

/**
 * The songs with ids for the song, its parts and its arrangements (an arrangement's part indexes become
 * part ids), and which of them share a name with a library song or an earlier song of the import. Of
 * several library songs with the name, the one with the same text is compared with, else the first.
 */
export function planImport(read: ImportedSong[], library: LibrarySong[], newId: () => string): ImportPlan {
  const seen = new Map<string, { id: string | null; text: string }[]>();
  for (const s of library) seen.set(songNameKey(s.name), [...(seen.get(songNameKey(s.name)) ?? []), { id: s.id, text: s.text }]);
  const duplicates: Duplicate[] = [];
  const songs = read.map((s, index) => {
    const key = songNameKey(s.name);
    const text = songText(s.parts);
    const others = seen.get(key) ?? [];
    const other = others.find((o) => sameText(o.text, text)) ?? others[0];
    if (other) duplicates.push({ index, name: s.name, text, other, same: sameText(other.text, text) });
    seen.set(key, [...others, { id: null, text }]);
    const partIds = s.parts.map(() => newId());
    return {
      id: newId(),
      name: s.name,
      author: s.author,
      publisher: s.publisher,
      ccli: s.ccli,
      parts: s.parts.map((p, i) => ({ id: partIds[i]!, labelText: p.labelText, content: p.content })),
      arrangements: s.arrangements.map((a) => ({ id: newId(), name: a.name, partIds: a.partIndexes.map((i) => partIds[i]!) })),
    };
  });
  return { songs, duplicates };
}

/** What the dialog starts with: a song with the same text is skipped, one with other text kept beside the other, so no text is lost. */
export const defaultChoice = (d: Duplicate): DuplicateChoice => (d.same ? 'skip' : 'keep');

/** The choices a duplicate offers: replacing only a library song. */
export const choicesFor = (d: Duplicate): DuplicateChoice[] => (d.other.id ? ['skip', 'replace', 'keep'] : ['skip', 'keep']);

/** The songs to send, by the choice for each duplicate (aligned with `plan.duplicates`). */
export function songsToSend(plan: ImportPlan, choices: DuplicateChoice[]): ImportArgs['songs'] {
  const byIndex = new Map(plan.duplicates.map((d, i) => [d.index, { d, choice: choices[i] ?? defaultChoice(d) }]));
  return plan.songs.flatMap((s, index) => {
    const dup = byIndex.get(index);
    if (dup?.choice === 'skip') return [];
    return [{ ...s, replaces: dup?.choice === 'replace' ? dup.d.other.id : null }];
  });
}

export interface ImportResult {
  created: number;
  replaced: number;
  skipped: number;
  failed: number;
}

export function importResult(plan: ImportPlan, choices: DuplicateChoice[], failed: number): ImportResult {
  const count = (c: DuplicateChoice) => plan.duplicates.filter((d, i) => (choices[i] ?? defaultChoice(d)) === c).length;
  const skipped = count('skip');
  const replaced = count('replace');
  return { created: plan.songs.length - skipped - replaced, replaced, skipped, failed };
}

/** "3 nya, 1 ersatt, 2 överhoppade (fanns redan), 1 fil saknade sångtext." or that nothing came in. */
export function importResultText(r: ImportResult): string {
  const part = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => (n ? [t(n === 1 ? one : many, { n })] : []);
  const parts = [
    ...part(r.created, 'songs.import.new.one', 'songs.import.new.many'),
    ...part(r.replaced, 'songs.import.replaced.one', 'songs.import.replaced.many'),
    ...part(r.skipped, 'songs.import.skipped.one', 'songs.import.skipped.many'),
    ...part(r.failed, 'songs.import.failed.one', 'songs.import.failed.many'),
  ];
  return parts.length ? `${parts.join(', ')}.` : t('songs.import.nothing');
}
