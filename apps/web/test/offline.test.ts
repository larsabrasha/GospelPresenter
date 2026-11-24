import { describe, expect, it } from 'vitest';
import { isOffline } from '../src/db/offline.ts';

describe('an error of background work in the database worker', () => {
  it('is the network when fetch could not reach the server, in any browser’s words, or was cut off', () => {
    const cases = [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('NetworkError when attempting to fetch resource.'), new DOMException('aborted', 'AbortError')];

    expect(cases.map(isOffline)).toEqual([true, true, true, true]);
  });

  it('is something to report otherwise: a SQL error, a full disk, a bug', () => {
    const cases = [new Error('SQLITE_ERROR: no such table: songs'), new DOMException('quota', 'QuotaExceededError'), new TypeError("Cannot read properties of undefined (reading 'id')")];

    expect(cases.map(isOffline)).toEqual([false, false, false]);
  });
});
