import { parseCustomPage, type CustomPage } from '@gp/core';
import { getCustomSlide } from '../../db/customSlides.ts';
import type { Db } from '../../db/db.ts';
import { getOverlay } from '../../db/queries.ts';
import type { ReadDb } from '../../db/share.ts';

// What the editor edits (docs/custom-slides.md): a custom slide, with its pages, or an overlay, with its one page and
// no background. One editor for both; only where it reads, writes and goes back to differs.

export type EditedKind = 'slide' | 'overlay';

export interface Edited {
  name: string;
  pages: CustomPage[];
  updatedAt: number;
}

export async function readEdited(db: ReadDb, kind: EditedKind, id: string): Promise<Edited | null> {
  if (kind === 'slide') {
    const s = await getCustomSlide(db, id);
    return s && { name: s.name, pages: s.pages, updatedAt: s.updatedAt };
  }
  const o = await getOverlay(db, id);
  return o && { name: o.title, pages: [parseCustomPage(o.content)], updatedAt: o.updatedAt ?? 0 };
}

/** Saves the pages whole; an overlay's is its first. */
export const savePages = (db: Db, kind: EditedKind, id: string, pages: CustomPage[], at: number) =>
  kind === 'slide' ? db.mutate('updateCustomSlide', { id, pages, at }) : db.mutate('updateOverlay', { id, page: pages[0]!, at });

export const renameEdited = (db: Db, kind: EditedKind, id: string, name: string) =>
  kind === 'slide' ? db.mutate('updateCustomSlide', { id, name, at: Date.now() }) : db.mutate('updateOverlay', { id, title: name, at: Date.now() });
