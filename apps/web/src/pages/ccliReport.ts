import type { CcliEntry } from '@gp/core';

// How the CCLI report groups and filters its entries (spec 02 `/admin/ccli-report`).

export const ccliFilters = ['all', 'unreported', 'reported'] as const;
export type CcliFilter = (typeof ccliFilters)[number];

export const matchesFilter = (e: CcliEntry, f: CcliFilter) => f === 'all' || (f === 'reported') === (e.reportedAt !== null);

export interface CcliCard {
  key: string;
  date: string;
  presentationName: string;
  entries: CcliEntry[];
}

/** The card an entry is on: its day and presentation (02 Q13 as decided on 2026-10-31). */
export const cardKey = (e: Pick<CcliEntry, 'date' | 'presentationId'>) => `${e.date}|${e.presentationId}`;

/** A card per day and presentation, in the entries' order (listCcliEntries: newest day first, then presentation). */
export function ccliCards(entries: CcliEntry[]): CcliCard[] {
  const cards = new Map<string, CcliCard>();
  for (const e of entries) {
    const key = cardKey(e);
    const card = cards.get(key) ?? { key, date: e.date, presentationName: e.presentationName, entries: [] };
    card.entries.push(e);
    cards.set(key, card);
  }
  return [...cards.values()];
}
