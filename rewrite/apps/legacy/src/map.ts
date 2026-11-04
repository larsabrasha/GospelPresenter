import {
  bibleId,
  bibleTextHash,
  CCLI_COLLECTION_SETTING,
  DEFAULT_THEME_SETTING,
  isKnownTheme,
  legacyOverlayPage,
  serializeBibleText,
  sortBibleBooks,
  verseCount,
  type BibleBookText,
  type LegacyRow,
  type LegacyRows,
  type LegacyUser,
  type Verse,
} from '@gp/core';
import { mapItems, mapPresentations, type Skipped } from './map-presentations.ts';
import { mapArrangements, mapCcli, mapLabels, mapParts, mapSongs, mapVersions, ms } from './map-songs.ts';
import type { Media, StoredImage } from './media.ts';
import type { OldData } from './old-db.ts';

// One organisation of 1.x as the rows, users and Bible texts of the export zip (docs/import-from-1x.md).

export interface Mapped {
  rows: LegacyRows;
  users: LegacyUser[];
  /** Each translation's text in its canonical form, named by its hash (`PUT /api/bibles/:hash`). */
  bibleTexts: { hash: string; json: string }[];
  skipped: Skipped[];
}

/** A translation's verses, 1.x's `[{b, c, v, t}]`, as books in canonical order. */
export function booksOf(versesJson: string): BibleBookText[] {
  const verses = JSON.parse(versesJson) as Verse[];
  const books = new Map<string, BibleBookText>();
  for (const v of verses) (books.get(v.b) ?? books.set(v.b, { code: v.b, verses: [] }).get(v.b)!).verses.push([v.c, v.v, v.t]);
  return sortBibleBooks([...books.values()]);
}

async function mapBibles(data: OldData): Promise<{ rows: LegacyRow[]; texts: { hash: string; json: string }[] }> {
  const rows: LegacyRow[] = [];
  const texts: { hash: string; json: string }[] = [];
  for (const b of data.bibles) {
    const books = booksOf(b.VersesJson);
    if (!books.length) continue;
    const json = serializeBibleText(books);
    const hash = await bibleTextHash(json);
    const id = bibleId(b.Abbreviation);
    if (rows.some((r) => r.id === id)) continue; // two translations with one abbreviation: 2.0 keeps one (BIBLE-R5)
    rows.push({ id, name: b.Name, abbreviation: b.Abbreviation.trim(), language: null, verse_count: verseCount(books), content_hash: hash });
    texts.push({ hash, json });
  }
  return { rows, texts };
}

const imageRow = (id: string, fileName: string, s: StoredImage, createdAt: number, deletedAt: number | null): LegacyRow => ({
  id,
  file_name: fileName.slice(0, 200),
  content_type: s.contentType,
  full_hash: s.fullHash,
  thumb_hash: s.thumbHash,
  width: s.width,
  height: s.height,
  created_at: createdAt,
  deleted_at: deletedAt,
});

/**
 * Overlays, and their own pictures as library pictures: 2.0's overlay names a picture of the library
 * (`overlays.image_id`), so the picture is listed under Bilder, named after the overlay.
 */
function mapOverlays(data: OldData, media: Media, now: number): { overlays: LegacyRow[]; images: LegacyRow[] } {
  const images: LegacyRow[] = [];
  const overlays = data.overlays.map((o, sort) => {
    const picture = media.overlayImages.get(o.Id);
    const imageId = picture ? `${o.Id}-image` : null;
    if (picture) images.push(imageRow(imageId!, `${o.Title || 'Overlay'}.${picture.contentType === 'image/jpeg' ? 'jpg' : 'webp'}`, picture, now, null));
    return { id: o.Id, title: o.Title, content: JSON.stringify(legacyOverlayPage(o.Content, imageId)), image_id: null, sort, updated_at: now };
  });
  return { overlays, images };
}

/** The settings 2.0 has: the default theme and CCLI collection. */
function mapSettings(data: OldData): LegacyRow[] {
  const rows: LegacyRow[] = [];
  for (const s of data.settings) {
    if (s.Key === 'DefaultThemeId' && isKnownTheme(s.Value)) rows.push({ id: DEFAULT_THEME_SETTING, value: s.Value });
    if (s.Key === 'CcliCollectionEnabled') rows.push({ id: CCLI_COLLECTION_SETTING, value: s.Value.trim().toLowerCase() === 'true' ? 'true' : 'false' });
  }
  return rows;
}

/** 1.x's `Admin` and `SuperAdmin` are admins of the organisation, `User` a user; a Google login keeps its subject. */
export function mapUsers(data: OldData): LegacyUser[] {
  return data.users
    .filter((u) => u.Email.trim())
    .map((u) => ({
      name: u.Name.trim() || u.Email.trim(),
      email: u.Email.trim().toLowerCase(),
      role: u.Role === 'Admin' || u.Role === 'SuperAdmin' ? 'admin' : 'user',
      google: data.logins.filter((l) => l.UserId === u.Id && l.Provider.toLowerCase() === 'google').map((l) => l.ProviderSubjectId),
    }));
}

export async function mapOrg(data: OldData, media: Media, now = Date.now()): Promise<Mapped> {
  const bibles = await mapBibles(data);
  const { overlays, images: overlayImages } = mapOverlays(data, media, now);
  const items = mapItems(data, media);
  const rows: LegacyRows = {
    labels: mapLabels(data),
    org_settings: mapSettings(data),
    bibles: bibles.rows,
    images: [...data.images.flatMap((i) => (media.images.has(i.Id) ? [imageRow(i.Id, i.FileName, media.images.get(i.Id)!, i.CreatedAt.getTime(), ms(i.DeletedAt))] : [])), ...overlayImages],
    audios: data.audios.flatMap((a) => {
      const m = media.audios.get(a.Id);
      return m ? [{ id: a.Id, file_name: a.FileName.slice(0, 200), content_type: m.contentType, hash: m.hash, size: m.size, created_at: a.CreatedAt.getTime(), deleted_at: ms(a.DeletedAt) }] : [];
    }),
    overlays,
    displays: data.displays.map((d) => ({ id: d.Id, name: d.Name, code: d.DisplayIdentifier, kind: d.Kind === 1 ? 'public' : 'screen', created_at: d.CreatedAt.getTime() })),
    songs: mapSongs(data),
    song_parts: mapParts(data),
    song_arrangements: mapArrangements(data),
    song_versions: mapVersions(data),
    presentations: mapPresentations(data),
    presentation_items: items.rows,
    ccli_entries: mapCcli(data),
  };
  return { rows, users: mapUsers(data), bibleTexts: bibles.texts, skipped: items.skipped };
}
