import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOB_URL_GRACE_MS, blobUrl, blobUrlCount, holdBlobUrl } from '../src/db/queries.ts';
import type { ReadDb } from '../src/db/share.ts';

// A picture's object URL holds its bytes in the window's memory: it is let go once nothing shows it (TODO.md "Video").

/** A database that has every blob asked for. */
const db = { query: async () => [{ content_type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }], fetchMedia: async () => null } as unknown as ReadDb;
const hash = (n: number) => String(n).padStart(64, '0');

describe('blob URLs', () => {
  let revoked: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    revoked = [];
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${n++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a URL while something holds it', async () => {
    const release = holdBlobUrl(hash(1));
    const url = await blobUrl(db, hash(1));

    vi.advanceTimersByTime(BLOB_URL_GRACE_MS * 2);

    expect(revoked).not.toContain(url);
    release();
  });

  it('lets a URL go a while after the last holder lets go', async () => {
    const release = holdBlobUrl(hash(2));
    const url = await blobUrl(db, hash(2));
    const before = blobUrlCount();

    release();
    vi.advanceTimersByTime(BLOB_URL_GRACE_MS);

    expect(revoked).toContain(url);
    expect(blobUrlCount()).toBe(before - 1);
  });

  it('keeps a URL that is held again within the grace', async () => {
    const url = await blobUrl(db, hash(3));
    holdBlobUrl(hash(3))();

    vi.advanceTimersByTime(BLOB_URL_GRACE_MS - 1);
    const release = holdBlobUrl(hash(3));
    vi.advanceTimersByTime(BLOB_URL_GRACE_MS * 2);

    expect(revoked).not.toContain(url);
    expect(await blobUrl(db, hash(3))).toBe(url);
    release();
  });

  it('lets go of a URL asked for once and never held', async () => {
    const url = await blobUrl(db, hash(4));

    vi.advanceTimersByTime(BLOB_URL_GRACE_MS);

    expect(revoked).toContain(url);
  });
});
