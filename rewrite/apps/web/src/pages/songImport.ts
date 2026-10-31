import { songNameKey, type ImportedSong, type MutatorArgs } from '@gp/core';
import { t } from '../i18n.ts';

// What the ProPresenter import on Sånger sends and says (spec 02 "Import card", SONG-R42): the songs
// read from the files with ids of their own, which of them the library has already, and the result
// line once they are written.

type ImportArgs = MutatorArgs<'importSongs'>;

/** At most this many songs go in one `importSongs` mutation (its argument limit). */
export const IMPORT_BATCH = 500;

/** A file larger than this is not read (spec 02: 25 MB per file). */
export const MAX_PRO_BYTES = 25 * 1024 * 1024;

export interface ImportPlan {
  songs: ImportArgs['songs'];
  /** The names that are in the library already, or earlier in this import, in file order. */
  duplicates: string[];
}

/**
 * The songs with ids for the song, its parts and its arrangements (an arrangement's part indexes become
 * part ids), and which of them are duplicates by the rule `importSongs` applies where it runs.
 */
export function planImport(read: ImportedSong[], libraryNames: string[], newId: () => string): ImportPlan {
  const seen = new Set(libraryNames.map(songNameKey));
  const duplicates: string[] = [];
  const songs = read.map((s) => {
    const key = songNameKey(s.name);
    if (seen.has(key)) duplicates.push(s.name);
    seen.add(key);
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

export interface ImportResult {
  created: number;
  replaced: number;
  skipped: number;
  failed: number;
}

export function importResult(plan: ImportPlan, replace: boolean, failed: number): ImportResult {
  const d = plan.duplicates.length;
  return { created: plan.songs.length - d, replaced: replace ? d : 0, skipped: replace ? 0 : d, failed };
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
