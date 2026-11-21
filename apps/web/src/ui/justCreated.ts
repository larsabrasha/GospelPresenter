import { useEffect, useState } from 'react';
import { pageCore } from '../db/pageCore.ts';

// Made at once and named in place, as Apple's apps make a note or a document (Lars, 2026-11-04): + creates "Ny sång"
// and opens it with its name picked, to type over. What was just made is kept here until its editor has opened.

const fresh = new Set<string>();

/** Marks `id` as just made, for its editor to pick its name when it opens. */
export function markCreated(id: string) {
  fresh.add(id);
}

/** Whether this editor's item was just made; asked once, as the editor opens. */
export function useJustCreated(id: string): boolean {
  const [isNew] = useState(() => fresh.has(id));
  useEffect(() => {
    fresh.delete(id);
  }, [id]);
  return isNew;
}

/** `base`, or `base 2`, `base 3` … the first that no name in `taken` is, as Finder names a new folder: the core's (`freshNameView`), for every shell. */
export function freshName(base: string, taken: readonly string[]): string {
  return pageCore().pure<string>('freshNameView', { base, taken });
}
