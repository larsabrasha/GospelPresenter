import type { BibleBookText } from '@gp/core';
import { base64, type RustCore } from '@gp/rust-core';

/** A translation read from a zip by the core (spec 05 BIBLE-R3–R6). */
interface ImportedBible {
  name: string;
  abbreviation: string;
  language: string | null;
  books: BibleBookText[];
}

/**
 * A translation's zip read by `core` (`bibleImportView`, crates/gp-core/src/bible_import.rs): a core of its own, so the
 * client's may go on syncing. A refusal is thrown with its reason as the message (not-zip, compression, too-large,
 * no-files, no-verses), which the page puts in words.
 */
export const readBibleZip = (core: RustCore, data: Uint8Array) => core.pure<ImportedBible>('bibleImportView', { data: base64(data) });
