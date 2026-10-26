import type { Label, Song, SongPart } from './schema.ts';

/** What an output renders for one song part (spec 04 `LiveSlide`, milestone 1 subset). */
export interface Slide {
  /** The part id: stable while the song is edited. */
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

/** One slide per part, in part order (spec 02: one part is one slide). */
export function songSlides(song: Song, parts: SongPart[], labels: Map<string, Label>): Slide[] {
  const credits = songCredits(song);
  return parts
    .filter((p) => p.songId === song.id)
    .toSorted((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((p) => {
      const l = p.labelId ? labels.get(p.labelId) : undefined;
      return { key: p.id, text: p.content, label: l ? { text: l.text, color: l.color } : null, credits };
    });
}
