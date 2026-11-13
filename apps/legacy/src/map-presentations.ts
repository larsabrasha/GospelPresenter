import { isBuiltInTheme, MAX_SLIDE_PAGES, pdfPages, type BibleItemContent, type LegacyRow, type SlidePage } from '@gp/core';
import { bibleSlideFromHtml } from './bible-html.ts';
import { ms } from './map-songs.ts';
import type { Media } from './media.ts';
import type { OldData, OldItem } from './old-db.ts';

// Presentations, templates and their running orders, from 1.x's rows to the new tables
// (docs/import-from-1x.md, "What maps to what").

/** `HH:MM` of a 1.x time of day (`HH:MM:SS`). */
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

export function mapPresentations(data: OldData): LegacyRow[] {
  return data.presentations.map((p) => ({
    id: p.Id,
    name: p.Name,
    event_date: p.IsTemplate ? null : p.EventDate,
    deleted_at: ms(p.DeletedAt),
    theme_id: p.ThemeId && isBuiltInTheme(p.ThemeId) ? p.ThemeId : null,
    is_template: p.IsTemplate ? 1 : 0,
    weekday: p.IsTemplate ? p.ScheduledDayOfWeek : null,
    time: hhmm(p.IsTemplate ? p.ScheduledTime : p.EventTime),
    location: p.EventLocation,
    last_used_at: p.IsTemplate ? ms(p.LastUsedAt) : null,
    description: p.Description,
    updated_at: ms(p.UpdatedAt),
  }));
}

/** An item 1.x had that has nothing to show here: what it was and why, for the export's report. */
export interface Skipped {
  presentationId: string;
  title: string;
  reason: 'no-song' | 'no-image' | 'no-audio' | 'no-deck' | 'no-pages';
}

const TYPES = ['song', 'bible', 'image', 'audio', 'slides'] as const;

/**
 * The running orders. A song, a picture and a sound are references, and an item whose song, picture or sound
 * is gone is left out (1.x showed a copy; 2.0 has none). A Bible item's slides are copied onto the item, as 2.0
 * keeps them (D25). A slide deck item's pages, those 1.x's item shows in its order, become a slideshow of PDF pages
 * of the item's id (docs/custom-slides.md), which the item names. `sort` is counted from 0 per presentation.
 */
export function mapItems(data: OldData, media: Media, now: number): { rows: LegacyRow[]; decks: LegacyRow[]; skipped: Skipped[] } {
  const songs = new Set(data.songs.map((s) => s.Id));
  const arrangementSong = new Map(data.arrangements.map((a) => [a.Id, a.SongId]));
  const partsOf = new Map<string, string[]>();
  for (const p of data.itemParts) (partsOf.get(p.PresentationItemId) ?? partsOf.set(p.PresentationItemId, []).get(p.PresentationItemId)!).push(p.Content);
  const oldDecks = new Map(data.decks.map((d) => [d.Id, d]));
  const presentations = new Set(data.presentations.map((p) => p.Id));
  const rows: LegacyRow[] = [];
  const decks: LegacyRow[] = [];
  const skipped: Skipped[] = [];
  const sort = new Map<string, number>();

  for (const item of data.items) {
    if (!presentations.has(item.PresentationId)) continue;
    const type = TYPES[item.Type];
    if (!type) continue;
    const skip = (reason: Skipped['reason']) => skipped.push({ presentationId: item.PresentationId, title: item.Title, reason });
    /** The item's row; a deck is a slideshow item here (`custom`). */
    const row = (sourceId: string, content: string | null, arrangementId: string | null = null, as: string = type) => {
      const n = sort.get(item.PresentationId) ?? 0;
      sort.set(item.PresentationId, n + 1);
      rows.push({ id: item.Id, presentation_id: item.PresentationId, type: as, title: item.Title, source_id: sourceId, sort: n, arrangement_id: arrangementId, content, overlay_id: null, note: null });
    };
    if (type === 'song') {
      if (!item.SourceId || !songs.has(item.SourceId)) skip('no-song');
      else row(item.SourceId, null, item.ArrangementId && arrangementSong.get(item.ArrangementId) === item.SourceId ? item.ArrangementId : null);
    } else if (type === 'bible') {
      // 1.x's item does not name its translation, so 2.0 shows no translation in its credits.
      const content: BibleItemContent = { translation: '', slides: (partsOf.get(item.Id) ?? []).map(bibleSlideFromHtml).filter((s) => s.length) };
      row(item.Id, JSON.stringify(content));
    } else if (type === 'image' || type === 'audio') {
      const known = item.SourceId && (type === 'image' ? media.images : media.audios).has(item.SourceId);
      if (!known) skip(type === 'image' ? 'no-image' : 'no-audio');
      else row(item.SourceId!, null);
    } else {
      const deck = slideDeck(item, oldDecks.get(item.SourceId ?? '')?.FileName, partsOf.get(item.Id) ?? [], media);
      if (typeof deck === 'string') skip(deck);
      else {
        decks.push({ id: item.Id, name: deck.fileName, pages: JSON.stringify(pdfPages(deck.pages)), created_at: now, updated_at: now, deleted_at: null });
        row(item.Id, null, null, 'custom');
      }
    }
  }
  return { rows, decks, skipped };
}

/** A slide deck's pages in the item's order: each part holds the number of a page stored as `page-{n}.webp`. */
function slideDeck(item: OldItem, fileName: string | undefined, parts: string[], media: Media): { fileName: string; pages: SlidePage[] } | 'no-deck' | 'no-pages' {
  const pages = item.SourceId ? media.decks.get(item.SourceId) : undefined;
  if (fileName === undefined || !pages) return 'no-deck';
  const shown = parts.flatMap((p): SlidePage[] => {
    const page = pages.get(Number(p));
    return page ? [page] : [];
  });
  if (!shown.length) return 'no-pages';
  return { fileName: fileName.slice(0, 200), pages: shown.slice(0, MAX_SLIDE_PAGES) };
}
