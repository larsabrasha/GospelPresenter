import type { BibleBookText } from '@gp/core';
import { base64, Core } from '@gp/core/core';

/** A translation read from a zip by the core (spec 05 BIBLE-R3–R6). */
interface ImportedBible {
  name: string;
  abbreviation: string;
  language: string | null;
  books: BibleBookText[];
}

/**
 * A translation's zip read by the core (`bibleImportView`, packages/core/src/views/files-bible-import.ts). A refusal is thrown with its reason as the message (not-zip, compression, too-large,
 * no-files, no-verses), which the page puts in words.
 */
export const readBibleZip = (data: Uint8Array) => new Core().pure<ImportedBible>('bibleImportView', { data: base64(data) });
