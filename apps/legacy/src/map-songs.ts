import { ccliEntryId, labelId, labelKey, SONG_VERSION_LIMIT, type LegacyRow, type SongSnapshot } from '@gp/core';
import type { OldData } from './old-db.ts';

// Labels, songs, their parts, arrangements and versions, and the CCLI report, from 1.x's rows to the new
// tables (docs/import-from-1x.md, "What maps to what"). Ids are kept, except a label's, which 2.0 makes
// from its text (SYNC-A12).

export const ms = (d: Date | null) => (d ? d.getTime() : null);

/** 1.x's label ids to the new ones; two labels whose texts compare equal become one, the first in order. */
function labelIds(data: OldData): Map<string, string> {
  return new Map(data.labels.map((l) => [l.Id, labelId(l.Text)]));
}

export function mapLabels(data: OldData): LegacyRow[] {
  const seen = new Set<string>();
  const rows: LegacyRow[] = [];
  for (const l of data.labels) {
    if (seen.has(labelKey(l.Text))) continue;
    seen.add(labelKey(l.Text));
    rows.push({ id: labelId(l.Text), text: l.Text.trim(), color: l.Color, sort: rows.length });
  }
  return rows;
}

export function mapSongs(data: OldData): LegacyRow[] {
  return data.songs.map((s) => ({ id: s.Id, name: s.Name, author: s.Author, publisher: s.Publisher, year: s.Year, ccli: s.Ccli, deleted_at: ms(s.DeletedAt) }));
}

export function mapParts(data: OldData): LegacyRow[] {
  const labels = labelIds(data);
  const sort = new Map<string, number>();
  return data.parts.map((p) => {
    const n = sort.get(p.SongId) ?? 0;
    sort.set(p.SongId, n + 1);
    return { id: p.Id, song_id: p.SongId, sort: n, label_id: (p.LabelId && labels.get(p.LabelId)) ?? null, content: p.Content };
  });
}

function partIdsOf(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A song's arrangements, keeping only part ids the song has (1.x could leave a removed part's id behind). */
export function mapArrangements(data: OldData): LegacyRow[] {
  const partsOf = new Map<string, Set<string>>();
  for (const p of data.parts) (partsOf.get(p.SongId) ?? partsOf.set(p.SongId, new Set()).get(p.SongId)!).add(p.Id);
  const sort = new Map<string, number>();
  return data.arrangements.map((a) => {
    const n = sort.get(a.SongId) ?? 0;
    sort.set(a.SongId, n + 1);
    const own = partsOf.get(a.SongId) ?? new Set();
    return { id: a.Id, song_id: a.SongId, name: a.Name, part_ids: JSON.stringify(partIdsOf(a.PartIdsJson).filter((id) => own.has(id))), sort: n };
  });
}

interface OldVersionPart {
  Id?: string;
  LabelId?: string | null;
  LabelText?: string | null;
  LabelColor?: string | null;
  Content?: string;
}

/**
 * Song versions as `SongSnapshot`s. A 1.x version keeps the name, the author and the parts with their
 * labels; the rest (publisher, year, CCLI number, arrangements) is the song's as it is now, its arrangements
 * holding only the version's parts, so a restore leaves those as they are. The newest SONG_VERSION_LIMIT of a
 * song are kept (SONG-R21). `user_id` is filled in by the server: 1.x does not record whose change it was.
 */
export function mapVersions(data: OldData): LegacyRow[] {
  const labels = labelIds(data);
  const songs = new Map(data.songs.map((s) => [s.Id, s]));
  const arrangements = mapArrangements(data);
  const bySong = new Map<string, typeof data.versions>();
  for (const v of data.versions) (bySong.get(v.SongId) ?? bySong.set(v.SongId, []).get(v.SongId)!).push(v);
  const rows: LegacyRow[] = [];
  for (const [songId, versions] of bySong) {
    const song = songs.get(songId);
    if (!song) continue;
    for (const v of versions.toSorted((a, b) => a.CreatedAt.getTime() - b.CreatedAt.getTime()).slice(-SONG_VERSION_LIMIT)) {
      let old: OldVersionPart[];
      try {
        old = JSON.parse(v.PartsJson) as OldVersionPart[];
      } catch {
        continue;
      }
      const parts = old.filter((p) => typeof p.Id === 'string');
      const ids = new Set(parts.map((p) => p.Id!));
      const snapshot: SongSnapshot = {
        name: v.Name,
        author: v.Author,
        publisher: song.Publisher,
        year: song.Year,
        ccli: song.Ccli,
        parts: parts.map((p) => ({
          id: p.Id!,
          labelId: p.LabelText ? labelId(p.LabelText) : ((p.LabelId && labels.get(p.LabelId)) ?? null),
          labelText: p.LabelText ?? null,
          labelColor: p.LabelColor ?? null,
          content: p.Content ?? '',
        })),
        arrangements: arrangements
          .filter((a) => a.song_id === songId)
          .map((a) => ({ id: String(a.id), name: (a.name as string | null) ?? null, partIds: partIdsOf(String(a.part_ids)).filter((id) => ids.has(id)) })),
      };
      rows.push({ id: v.Id, song_id: songId, user_id: '', created_at: v.CreatedAt.getTime(), name: v.Name, data: JSON.stringify(snapshot) });
    }
  }
  return rows;
}

/** The CCLI report: one entry per song, day and presentation (SONG-R50), so 1.x's duplicates become one. */
export function mapCcli(data: OldData): LegacyRow[] {
  const rows = new Map<string, LegacyRow>();
  for (const e of data.ccli) {
    const presentationId = e.PresentationId ?? '';
    const id = ccliEntryId(e.SongId, e.Date, presentationId);
    const reportedAt = e.Reported ? (ms(e.ReportedAt) ?? e.CreatedAt.getTime()) : null;
    const known = rows.get(id);
    if (known) {
      if (reportedAt !== null && known.reported_at === null) known.reported_at = reportedAt;
      continue;
    }
    rows.set(id, {
      id,
      song_id: e.SongId,
      song_name: e.SongName,
      ccli: e.CcliNumber,
      presentation_id: presentationId,
      presentation_name: e.PresentationName,
      date: e.Date,
      reported_at: reportedAt,
    });
  }
  return [...rows.values()];
}
