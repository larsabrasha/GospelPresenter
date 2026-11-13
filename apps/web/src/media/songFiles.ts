import { AUDIO_TYPES, audioTypeFromName, isPdf, MEDIA_LIMITS, sniffAudio } from '@gp/core';
import type { SongFileImport } from '../db/protocol.ts';

// A song's files (spec 02 "Song material"): sheet music as a PDF, or a recording to practise with, kept as picked.

/** What the file picker offers. */
export const SONG_FILE_ACCEPT = ['application/pdf', '.pdf', ...AUDIO_TYPES].join(',');

export type SongFileProblem = 'type' | 'size';

/**
 * Reads a picked file for a song: a PDF by its `%PDF-` header, or audio by its signature, at most 20 MiB. Its title
 * is the file's name without the extension, which can be changed afterwards.
 */
export async function readSongFile(file: File, ids: { id: string; songId: string }): Promise<SongFileImport | SongFileProblem> {
  const pdfName = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const audioName = AUDIO_TYPES.some((x) => x === file.type) || audioTypeFromName(file.name) !== null;
  if (!pdfName && !audioName) return 'type';
  if (file.size === 0 || file.size > (pdfName ? MEDIA_LIMITS.pdfBytes : MEDIA_LIMITS.audioBytes)) return 'size';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = isPdf(bytes) ? 'application/pdf' : sniffAudio(bytes);
  if (!contentType) return 'type';
  const dot = file.name.lastIndexOf('.');
  const title = (dot > 0 ? file.name.slice(0, dot) : file.name).trim().slice(0, 200) || file.name.slice(0, 200);
  return { ...ids, title, contentType, bytes };
}

/** What a link points at, by its host: Spotify, YouTube and Apple Music by name, any other by its host. */
export function linkSource(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('spotify.com')) return 'Spotify';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube';
    if (host === 'music.apple.com') return 'Apple Music';
    return host;
  } catch {
    return url;
  }
}
