import type { Label, Song, SongArrangement, SongPart } from './schema.ts';

/** What an output renders for one song part (spec 04 `LiveSlide`, milestone 1 subset). */
export interface Slide {
  /** The part id, plus the occurrence when an arrangement repeats the part: stable while the song is edited. */
  key: string;
  text: string;
  label: { text: string; color: string } | null;
  credits: string | null;
}

/** "Author · © Publisher · Year", dropping missing pieces; null if there are none (spec 04). */
export function songCredits(song: Pick<Song, 'author' | 'publisher' | 'year'>): string | null {
  const pieces = [song.author, song.publisher ? `© ${song.publisher}` : null, song.year ? String(song.year) : null];
  const kept = pieces.filter((p): p is string => !!p?.trim());
  return kept.length ? kept.join(' · ') : null;
}

/** An arrangement's part ids. A value that is not a list of strings reads as empty. */
export function parsePartIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A song's arrangements in their order; the first is the default (SONG-R19). */
export function sortedArrangements(arrangements: SongArrangement[], songId: string): SongArrangement[] {
  return arrangements.filter((a) => a.songId === songId).toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

/**
 * The parts in the order they are shown (SONG-R18, R19): the item's
 * arrangement, else the song's first arrangement, else all parts in part
 * order. An arrangement id that is not one of the song's shows all parts; ids
 * of deleted parts are skipped; repeats are kept.
 */
export function arrangedParts(song: Song, parts: SongPart[], arrangements: SongArrangement[], itemArrangementId: string | null = null): SongPart[] {
  const own = parts.filter((p) => p.songId === song.id).toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const arrangementId = itemArrangementId ?? sortedArrangements(arrangements, song.id)[0]?.id ?? null;
  const arrangement = arrangementId ? arrangements.find((a) => a.id === arrangementId && a.songId === song.id) : undefined;
  if (!arrangement) return own;
  const byId = new Map(own.map((p) => [p.id, p]));
  return parsePartIds(arrangement.partIds).flatMap((id) => byId.get(id) ?? []);
}

/** One slide per arranged part (spec 02: one part is one slide). */
export function songSlides(
  song: Song,
  parts: SongPart[],
  labels: Map<string, Label>,
  arrangements: SongArrangement[] = [],
  itemArrangementId: string | null = null,
): Slide[] {
  const credits = songCredits(song);
  const seen = new Map<string, number>();
  return arrangedParts(song, parts, arrangements, itemArrangementId).map((p) => {
    const n = seen.get(p.id) ?? 0;
    seen.set(p.id, n + 1);
    const l = p.labelId ? labels.get(p.labelId) : undefined;
    return { key: n ? `${p.id}#${n}` : p.id, text: p.content, label: l ? { text: l.text, color: l.color } : null, credits };
  });
}
