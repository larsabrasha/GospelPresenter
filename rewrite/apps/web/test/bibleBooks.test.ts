import { describe, expect, it } from 'vitest';
import type { BibleBookText } from '@gp/core';
import { bibleBooks } from '../src/db/queries.ts';
import type { ReadDb } from '../src/db/share.ts';

// A device that keeps no Bible text: every translation comes from `fetch`.
const noStoredTexts: ReadDb = {
  query: async () => [],
  onChange: () => () => {},
  fetchMedia: async () => null,
};

function countingFetch() {
  const fetched: string[] = [];
  const fetch = async (hash: string): Promise<BibleBookText[]> => {
    fetched.push(hash);
    return [{ code: 'GEN', verses: [] }];
  };
  return { fetched, fetch };
}

describe('the Bible texts held in memory', () => {
  it('fetches a translation read again recently only once', async () => {
    const { fetched, fetch } = countingFetch();

    await bibleBooks(noStoredTexts, 'once-a', fetch);
    await bibleBooks(noStoredTexts, 'once-a', fetch);

    expect(fetched).toEqual(['once-a']);
  });

  it('lets go of the translation read longest ago once three others are read', async () => {
    const { fetched, fetch } = countingFetch();
    for (const hash of ['old-a', 'old-b', 'old-c', 'old-d']) await bibleBooks(noStoredTexts, hash, fetch);

    await bibleBooks(noStoredTexts, 'old-a', fetch);

    expect(fetched).toEqual(['old-a', 'old-b', 'old-c', 'old-d', 'old-a']);
  });

  it('counts a translation read again as the newest', async () => {
    const { fetched, fetch } = countingFetch();
    for (const hash of ['new-a', 'new-b', 'new-c', 'new-a', 'new-d']) await bibleBooks(noStoredTexts, hash, fetch);

    await bibleBooks(noStoredTexts, 'new-a', fetch);

    expect(fetched).toEqual(['new-a', 'new-b', 'new-c', 'new-d']);
  });
});
