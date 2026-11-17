import { describe, expect, it } from 'vitest';
import type { BibleBookText } from '@gp/core';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { fetchedBibleText } from '../src/db/fetchedBibles.ts';

// A device that keeps no Bible text: every translation comes from `fetch`, into a database in memory of its own.
function countingFetch() {
  const fetched: string[] = [];
  const fetch = async (hash: string): Promise<BibleBookText[] | null> => {
    fetched.push(hash);
    return hash.startsWith('none') ? null : [{ code: 'GEN', verses: [[1, 1, `I begynnelsen (${hash})`]] }];
  };
  return { fetched, fetch };
}

describe('the Bible texts held in memory', () => {
  it('holds a fetched text where the core reads it as a stored one', async () => {
    const { fetch } = countingFetch();

    const rows = await fetchedBibleText('read-a', fetch, openWaSqlite);

    expect(await rows!('SELECT book, chunk FROM bible_texts WHERE hash = ?', ['read-a'])).toEqual([['GEN', '[[1,1,"I begynnelsen (read-a)"]]']]);
  });

  it('fetches a translation read again recently only once', async () => {
    const { fetched, fetch } = countingFetch();

    await fetchedBibleText('once-a', fetch, openWaSqlite);
    await fetchedBibleText('once-a', fetch, openWaSqlite);

    expect(fetched).toEqual(['once-a']);
  });

  it('lets go of the translation read longest ago once three others are read', async () => {
    const { fetched, fetch } = countingFetch();
    for (const hash of ['old-a', 'old-b', 'old-c', 'old-d']) await fetchedBibleText(hash, fetch, openWaSqlite);

    await fetchedBibleText('old-a', fetch, openWaSqlite);

    expect(fetched).toEqual(['old-a', 'old-b', 'old-c', 'old-d', 'old-a']);
  });

  it('counts a translation read again as the newest', async () => {
    const { fetched, fetch } = countingFetch();
    for (const hash of ['new-a', 'new-b', 'new-c', 'new-a', 'new-d']) await fetchedBibleText(hash, fetch, openWaSqlite);

    await fetchedBibleText('new-a', fetch, openWaSqlite);

    expect(fetched).toEqual(['new-a', 'new-b', 'new-c', 'new-d']);
  });

  it('asks again for a text the server could not give', async () => {
    const { fetched, fetch } = countingFetch();
    await fetchedBibleText('none-a', fetch, openWaSqlite);

    const rows = await fetchedBibleText('none-a', fetch, openWaSqlite);

    expect([rows, fetched]).toEqual([null, ['none-a', 'none-a']]);
  });
});
