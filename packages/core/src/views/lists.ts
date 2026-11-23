// The presentations page, the templates, the trash and the lists other pages read beside their own (apps/web's
// Presentations, Templates, Trash, Storage, Labels, the command palette and song import), as the web's reads gave
// them (ported back from crates/gp-core/src/lists.rs).
import { MutationError } from '../mutation.ts';
import { marks, type RunSql } from './sql.ts';
import { AUDIO, IMAGE, imageRow, VIDEO, videoRow } from './lists-media.ts';
import { type Fields, itemsOf, jsNum, LABEL, langOf, PART, PRESENTATION, select, SONG, sortRows } from './lists-rows.ts';
import { argsOf, idOf } from './serde.ts';


/** `presentationListView`: the presentations, newest event first, those without a date last (`listPresentations`). */
export async function presentationListView(args: unknown, sql: RunSql) {
  argsOf(args);
  return select(sql, PRESENTATION, 'presentations WHERE deleted_at IS NULL AND is_template = 0 ORDER BY event_date IS NULL, event_date DESC, name');
}

/** `templatesView` {locale}: the templates, last changed first, then by name in the page's language and by id (`listTemplates`). */
export async function templatesView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const rows = await select(sql, PRESENTATION, 'presentations WHERE deleted_at IS NULL AND is_template = 1');
  return sortRows(langOf(a), rows, [['last', 'updatedAt'], ['name', 'name'], ['id', 'id']]);
}

/** `itemsView` {presentationId}: a presentation's items in order (`itemsOf`); an unknown type reads as a song. */
export async function itemsView(args: unknown, sql: RunSql) {
  return itemsOf(sql, idOf(argsOf(args), 'presentationId'));
}

/** `labelsView`: the labels in their order (`listLabels`). */
export const labelsView = async (args: unknown, sql: RunSql) => (argsOf(args), select(sql, LABEL, 'labels ORDER BY sort, text'));

/** `songPartsView` {songIds}: the parts of these songs, in order (`songPartsOf`). */
export async function songPartsView(args: unknown, sql: RunSql) {
  const ids = argsOf(args).songIds;
  if (!Array.isArray(ids)) throw new MutationError('invalid-args', 'songIds');
  return ids.length ? select(sql, PART, `song_parts WHERE song_id IN (${marks(ids.length)}) ORDER BY sort, id`, ids) : [];
}

/** `pinnedView`: the presentations this device keeps offline ("Tillgänglig offline"). */
export const pinnedView = async (args: unknown, sql: RunSql) => (argsOf(args), (await sql('SELECT id FROM pinned_presentations', [])).map((r) => r[0]));

/**
 * `trashEntriesView`: what is in the trash (spec 03 section 5) as `listTrash`'s entries, slideshows, videos, pictures,
 * sounds, presentations and templates, songs; the page orders them, newest deletion first.
 */
export async function trashEntriesView(args: unknown, sql: RunSql) {
  argsOf(args);
  const entry = (kind: string, id: unknown, name: unknown, detail: unknown, deletedAt: unknown) => ({ kind, id, name, detail, deletedAt });
  const trashed = (fields: Fields, table: string) => select(sql, fields, `${table} WHERE deleted_at IS NOT NULL`);
  const out: object[] = [];
  for (const r of await sql('SELECT id, name, deleted_at FROM custom_slides WHERE deleted_at IS NOT NULL', [])) out.push(entry('Slide', r[0], r[1], null, jsNum(r[2])));
  for (const v of (await trashed(VIDEO, 'videos')).map(videoRow)) out.push(entry('Video', v.id, v.fileName, null, v.deletedAt));
  for (const v of (await trashed(IMAGE, 'images')).map(imageRow)) out.push(entry('Image', v.id, v.fileName, null, v.deletedAt));
  for (const v of await trashed(AUDIO, 'audios')) out.push(entry('Audio', v.id, v.fileName, null, v.deletedAt));
  for (const p of await trashed(PRESENTATION, 'presentations'))
    out.push(p.isTemplate === true ? { kind: 'Template', id: p.id, name: p.name, detail: null, template: p, deletedAt: p.deletedAt } : entry('Presentation', p.id, p.name, p.eventDate, p.deletedAt));
  for (const s of await trashed(SONG, 'songs')) out.push(entry('Song', s.id, s.name, s.author, s.deletedAt));
  return out;
}
