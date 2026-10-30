// The output window's reads through the operator window's database, over a
// real BroadcastChannel (Node has one). No OPFS anywhere: this is the path an
// output takes when the operator's database is only in memory.
import { afterEach, describe, expect, it } from 'vitest';
import { needsReload, serveReads, SharedReader, shareChannelName, type MediaBytes } from '../src/db/share.ts';

const open: { close(): void }[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

function owner(
  name: string,
  rows: Record<string, Record<string, unknown>[]>,
  onOtherChanged: (tables?: string[]) => void = () => {},
  media: (hash: string) => Promise<MediaBytes | null> = async () => null,
) {
  const channel = new BroadcastChannel(name);
  open.push(channel);
  return serveReads(
    channel,
    async (sql) => {
      if (!(sql in rows)) throw new Error(`no such query: ${sql}`);
      return rows[sql]!;
    },
    onOtherChanged,
    media,
  );
}

function reader(name: string, retryMs = 50) {
  const r = new SharedReader(name, retryMs);
  open.push(r);
  return r;
}

const name = () => shareChannelName({ userId: 'operator', orgId: `org-${crypto.randomUUID()}` });

describe('shared reads between windows', () => {
  it('a reader gets the rows the owner holds, and errors as errors', async () => {
    const n = name();
    owner(n, { 'SELECT 1': [{ x: 1 }] });
    const r = reader(n);
    expect(await r.query('SELECT 1')).toEqual([{ x: 1 }]);
    await expect(r.query('SELECT nope')).rejects.toThrow('no such query: SELECT nope');
  });

  it('a read made before any owner exists is answered once one opens (an operator reload)', async () => {
    const n = name();
    const r = reader(n);
    const pending = r.query('SELECT 1');
    await new Promise((res) => setTimeout(res, 120));
    owner(n, { 'SELECT 1': [{ x: 'late' }] });
    expect(await pending).toEqual([{ x: 'late' }]);
  });

  it('readers and other owners hear about changes; an owner does not hear its own', async () => {
    const n = name();
    let otherHeard = 0;
    let selfHeard = 0;
    const a = owner(n, {}, () => selfHeard++);
    owner(n, {}, () => otherHeard++);
    const r = reader(n);
    const readerHeard = new Promise<void>((res) => r.onChange(() => res()));
    a.changed();
    await readerHeard;
    await new Promise((res) => setTimeout(res, 20));
    expect(otherHeard).toBe(1);
    expect(selfHeard).toBe(0);
  });

  it('a change says which tables it wrote, to readers and other owners alike', async () => {
    const n = name();
    let otherHeard: string[] | undefined;
    const a = owner(n, {});
    owner(n, {}, (tables) => (otherHeard = tables));
    const r = reader(n);
    const readerHeard = new Promise<ReadonlySet<string> | undefined>((res) => r.onChange(res));

    a.changed(['songs', 'song_parts']);

    expect([...((await readerHeard) ?? [])]).toEqual(['songs', 'song_parts']);
    await new Promise((res) => setTimeout(res, 20));
    expect(otherHeard).toEqual(['songs', 'song_parts']);
  });

  it('a change that does not say what it wrote reaches a reader as one that may have written anything', async () => {
    const n = name();
    const a = owner(n, {});
    const r = reader(n);
    const readerHeard = new Promise<ReadonlySet<string> | undefined>((res) => r.onChange(res));

    a.changed();

    expect(await readerHeard).toBeUndefined();
  });

  it("a reader gets a media blob through the owner (a host's own window takes it from its server)", async () => {
    const n = name();
    owner(n, {}, () => {}, async (hash) => (hash === 'h1' ? { contentType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) } : null));
    const r = reader(n);

    expect(await r.fetchMedia('h1')).toEqual({ contentType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });
    expect(await r.fetchMedia('h2')).toBeNull();
  });

  it('two owners of one file both answer; the reader takes the first and ignores the second', async () => {
    const n = name();
    owner(n, { q: [{ from: 'one' }] });
    owner(n, { q: [{ from: 'one' }] });
    const r = reader(n);
    expect(await r.query('q')).toEqual([{ from: 'one' }]);
    expect(await r.query('q')).toEqual([{ from: 'one' }]);
  });
});

describe('which changes a page loads again for', () => {
  it('a load that names its tables loads again when a change wrote one of them', () => {
    expect(needsReload(['songs', 'song_parts'], new Set(['song_parts', 'presentations']))).toBe(true);
  });

  it('a load that names its tables is left alone when a change wrote only others', () => {
    expect(needsReload(['songs', 'song_parts'], new Set(['presentation_items', 'presentations']))).toBe(false);
  });

  it('a change that does not say what it wrote loads everything again', () => {
    expect(needsReload(['songs'], undefined)).toBe(true);
  });

  it('a load that names no tables loads again on every change', () => {
    expect(needsReload(undefined, new Set(['media_blobs']))).toBe(true);
  });
});
