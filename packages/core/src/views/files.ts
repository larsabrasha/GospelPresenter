// The views of imports, exports and files (ADR 0008, docs/core-back-to-typescript.md wave 5), ported back from the
// Rust core: a ProPresenter file as a song (files-propresenter.ts), a translation's zip (files-bible-import.ts), the
// export zip's rows (files-legacy.ts), Bible texts (files-bible-texts.ts) and media files (files-media.ts); here, which
// songs of a ProPresenter import share a name with one in the library or earlier in the import, and what the importer
// may choose for each (spec 02 "Import card", SONG-R42; crates/gp-core/src/song_import.rs).
import { MutationError } from '../mutation.ts';
import type { PureView, View } from './sql.ts';
import { bibleImportView } from './files-bible-import.ts';
import { bibleTextJsonView, bibleTextPlanView, bibleTextStoreView, bibleUploadsView } from './files-bible-texts.ts';
import { argsOf, field } from './files-json.ts';
import { exportRowsView, legacyBlobsView, legacyOverlayPageView, legacyRowsProblemView, legacyUpgradeView } from './files-legacy.ts';
import { mediaPlanView, mediaStorageView, mediaUploadsView, wantedMediaView } from './files-media.ts';
import { proPresenterSongView } from './files-propresenter.ts';

/** How two song names compare for duplicates: case and composition aside (SONG-R42). */
const nameKey = (name: string) => name.trim().normalize('NFC').toLowerCase();
/** The same words in the same order: spaces, line breaks and blank lines do not count. */
const spaced = (t: string) => t.replace(/\s+/g, ' ').trim();
const text = (v: unknown, k: string) => {
  const t = field(v, k);
  return typeof t === 'string' ? t : '';
};
function list(a: Record<string, unknown>, k: string): unknown[] {
  const v = a[k];
  if (!Array.isArray(v)) throw new MutationError('invalid-args');
  return v;
}

/** `songNamesakesView` {names, library: string[]}: the places in `library` of the names one of `names` has. */
function songNamesakesView(args: unknown): number[] {
  const a = argsOf(args);
  const keys = new Set(list(a, 'names').flatMap((n) => (typeof n === 'string' ? [nameKey(n)] : [])));
  return list(a, 'library').flatMap((n, i) => (keys.has(nameKey(typeof n === 'string' ? n : '')) ? [i] : []));
}

/**
 * `songImportDuplicatesView` {songs: {name, text}[], library: {id, name, text}[]}: each song that shares a name, in
 * file order: its index, the song it is compared with (the library's with the same text, else the first; or one
 * earlier in the import, with no id), whether their text is the same, the choices it offers (replacing only a library
 * song) and the one it starts with (a same text skipped, another kept beside, so no text is lost).
 */
function songImportDuplicatesView(args: unknown) {
  const a = argsOf(args);
  const seen = new Map<string, { id: unknown; text: string }[]>();
  const add = (key: string, entry: { id: unknown; text: string }) => seen.set(key, [...(seen.get(key) ?? []), entry]);
  for (const l of list(a, 'library')) add(nameKey(text(l, 'name')), { id: field(l, 'id') ?? null, text: text(l, 'text') });
  return list(a, 'songs').flatMap((song, index) => {
    const [key, t] = [nameKey(text(song, 'name')), text(song, 'text')];
    const others = seen.get(key) ?? [];
    add(key, { id: null, text: t });
    const other = others.find((o) => spaced(o.text) === spaced(t)) ?? others[0];
    if (!other) return [];
    const same = spaced(other.text) === spaced(t);
    const choices = other.id !== null && other.id !== false && other.id !== '' && other.id !== 0 ? ['skip', 'replace', 'keep'] : ['skip', 'keep'];
    return [{ index, other, same, choices, choice: same ? 'skip' : 'keep' }];
  });
}

/** The group's views that read the database. */
export const filesViews: Record<string, View> = {
  exportRowsView,
  wantedMediaView,
  mediaPlanView,
  mediaUploadsView,
  mediaStorageView,
  bibleTextPlanView,
  bibleTextJsonView,
  bibleUploadsView,
};

/** The group's views that read only their arguments. */
export const filesPureViews: Record<string, PureView> = {
  proPresenterSongView,
  songNamesakesView,
  songImportDuplicatesView,
  bibleImportView,
  legacyUpgradeView,
  legacyBlobsView,
  legacyRowsProblemView,
  legacyOverlayPageView,
  bibleTextStoreView,
};
