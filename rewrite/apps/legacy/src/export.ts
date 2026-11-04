import { renameSync, rmSync } from 'node:fs';
import { LEGACY_ENTRIES, LEGACY_FORMAT, LEGACY_TABLES, type LegacyManifest } from '@gp/core';
import { mapOrg } from './map.ts';
import type { Skipped } from './map-presentations.ts';
import { collectMedia, type ObjectStore } from './media.ts';
import type { OldData } from './old-db.ts';
import { ZipWriter } from './zip-writer.ts';

// One organisation of 1.x written as the export zip (docs/import-from-1x.md, "The two steps").

export interface ExportReport {
  manifest: LegacyManifest;
  /** Files that were not there or that 2.0 does not take, and running order items left out. */
  problems: string[];
  skipped: Skipped[];
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** Written beside `out` and moved there only when it is whole, so a failed export leaves no zip that looks done. */
export async function exportOrg(data: OldData, store: ObjectStore, out: string, progress?: (done: number, total: number) => void): Promise<ExportReport> {
  const partial = `${out}.partial`;
  const zip = new ZipWriter(partial);
  let whole = false;
  try {
    let blobs = 0;
    const media = await collectMedia(
      data,
      store,
      async (hash, bytes) => {
        const name = LEGACY_ENTRIES.blob(hash);
        if (zip.names.has(name)) return;
        zip.add(name, bytes);
        blobs++;
      },
      progress,
    );
    const mapped = await mapOrg(data, media);
    for (const t of mapped.bibleTexts) zip.add(LEGACY_ENTRIES.bible(t.hash), new TextEncoder().encode(t.json));
    for (const table of LEGACY_TABLES) zip.add(LEGACY_ENTRIES.rows(table), json(mapped.rows[table]));
    zip.add(LEGACY_ENTRIES.users, json(mapped.users));
    const counts: Record<string, number> = Object.fromEntries(LEGACY_TABLES.map((t) => [t, mapped.rows[t].length]));
    counts.users = mapped.users.length;
    counts.blobs = blobs;
    counts.bibleTexts = mapped.bibleTexts.length;
    const manifest: LegacyManifest = { format: LEGACY_FORMAT, orgName: data.org.Name, exportedAt: Date.now(), counts };
    zip.add(LEGACY_ENTRIES.manifest, json(manifest));
    zip.close();
    whole = true;
    renameSync(partial, out);
    return { manifest, problems: media.problems, skipped: mapped.skipped };
  } finally {
    if (!whole) {
      zip.abandon();
      rmSync(partial, { force: true });
    }
  }
}
