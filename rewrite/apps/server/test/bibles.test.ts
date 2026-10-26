// Bibles and themes against every server adapter (spec 05): the text of a
// translation is uploaded once and downloaded once per device, outside the
// change log; only its `bibles` row syncs. Also measures one full-size
// (generated) translation for the README.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bibleId, bibleTextHash, BIBLE_LIMITS, parseBibleContent, serializeBibleText, type BibleBookText } from '@gp/core';
import { loadBibleText, storeBibleText, syncBibleTexts, type SyncClient } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** A few verses of the World English Bible (public domain). */
const SAMPLE: BibleBookText[] = [
  {
    code: 'PSA',
    verses: [
      [23, 1, 'Yahweh is my shepherd; I shall lack nothing.'],
      [23, 2, 'He makes me lie down in green pastures. He leads me beside still waters.'],
    ],
  },
  {
    code: 'JHN',
    verses: [
      [3, 16, 'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.'],
      [3, 17, 'For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.'],
    ],
  },
];

/** A generated translation the size of a whole Bible: 66 books, 31 102 verses, about 5 MB. Not a real text. */
function fullSizeText(): BibleBookText[] {
  const words = ['och', 'Herren', 'sade', 'till', 'folket', 'att', 'de', 'skulle', 'gå', 'genom', 'landet', 'med', 'frid', 'ljus', 'nåd'];
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n);
  const codes = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(
    ' ',
  );
  const total = 31_102;
  return codes.map((code, i) => {
    const n = Math.floor(total / codes.length) + (i < total % codes.length ? 1 : 0);
    const verses: BibleBookText['verses'] = [];
    for (let k = 0; k < n; k++) {
      let t = '';
      while (t.length < 150) t += (t ? ' ' : '') + words[rnd(words.length)];
      verses.push([Math.floor(k / 30) + 1, (k % 30) + 1, t + '.']);
    }
    return { code, verses };
  });
}

/** Stores a text on the device and uploads it, as the import does before `importBible`. */
async function upload(h: Harness, org: string, d: Device, books: BibleBookText[]) {
  const { hash, json } = await storeBibleText(d.client, books);
  const res = await put(h, org, d.user, hash, json);
  expect(res.status).toBe(204);
  return hash;
}

function put(h: Harness, org: string, user: string, hash: string, body: string) {
  return fetch(`${h.url}/bibles/${hash}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${tokenOf(h, org, user)}`, 'content-type': 'application/json' },
    body,
  });
}

function downloader(h: Harness, org: string, user: string) {
  return async (hash: string) => {
    const res = await fetch(`${h.url}/bibles/${hash}`, { headers: { authorization: `Bearer ${tokenOf(h, org, user)}` } });
    return res.status === 200 ? res.text() : null;
  };
}

async function dbBytes(client: SyncClient) {
  const [r] = await client.query('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()');
  return Number(r!.bytes);
}

describe.each(adapters)('%s adapter: Bibles and themes', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device; // admin
  let bob: Device; // user
  const devices: Device[] = [];

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);

  afterAll(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    await h?.close();
  });

  beforeEach(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
    devices.push(alice, bob);
  });

  const importArgs = (hash: string, abbreviation = 'WEB', name = 'World English Bible') => ({ name, abbreviation, language: 'eng', contentHash: hash });

  it('an import syncs one row; every device fetches the text once and keeps it', async () => {
    const hash = await upload(h, org, alice, SAMPLE);
    await alice.client.mutate('importBible', importArgs(hash));
    await alice.client.sync();
    await bob.client.sync();

    const s = await serverDump(h, org, 'alice');
    expect(s.tables.bibles).toEqual([
      { id: 'bible:web', name: 'World English Bible', abbreviation: 'WEB', language: 'eng', verse_count: 4, content_hash: hash },
    ]);
    // The text never enters the change log: one change for the row, none for verses.
    expect(s.changes.filter((c) => c.tbl === 'bibles')).toHaveLength(1);
    expect(s.changes.some((c) => c.tbl.startsWith('bible_'))).toBe(false);

    expect(await loadBibleText(bob.client, hash)).toBeNull();
    const first = await syncBibleTexts(bob.client, downloader(h, org, 'bob'));
    expect(first).toEqual({ downloaded: [hash], missing: [], removed: 0 });
    expect(await loadBibleText(bob.client, hash)).toEqual(SAMPLE);
    // Once is enough.
    expect(await syncBibleTexts(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [], missing: [], removed: 0 });
  });

  it('a Bible reading is added, synced and kept as slides with its translation (BIBLE-R12, D12, D25)', async () => {
    const hash = await upload(h, org, alice, SAMPLE);
    await alice.client.mutate('importBible', importArgs(hash));
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Sunday' });
    await alice.client.sync();
    await bob.client.sync();
    await syncBibleTexts(bob.client, downloader(h, org, 'bob'));
    const verses = SAMPLE[1]!.verses.map(([c, v, t]) => ({ b: 'JHN', c, v, t }));
    await bob.client.mutate('addBibleToPresentation', { itemId: 'I1', presentationId: 'P', bibleId: bibleId('WEB'), translation: 'WEB', verses });
    await bob.client.sync();
    await alice.client.sync();
    expect(bob.client.rejected).toEqual([]);
    const [item] = (await serverDump(h, org, 'alice')).tables.presentation_items;
    expect(item).toMatchObject({ type: 'bible', title: 'Johannes 3:16-17', source_id: 'bible:web' });
    const content = parseBibleContent(item!.content as string);
    expect(content?.translation).toBe('WEB');
    expect(content?.slides.flat().map((s) => s.n)).toEqual([16, 17]);
    expect(JSON.stringify((await alice.client.dump()).presentation_items)).toBe(JSON.stringify([item]));

    // Deleting the translation leaves the reading as it was (BIBLE-A7).
    await alice.client.mutate('deleteBible', { id: 'bible:web' });
    await alice.client.sync();
    const after = await serverDump(h, org, 'alice');
    expect(after.tables.bibles).toEqual([]);
    expect(after.tables.presentation_items).toEqual([item]);
    // And the text goes with it, on the server and on every device.
    expect((await fetch(`${h.url}/bibles/${hash}`, { headers: { authorization: `Bearer ${tokenOf(h, org, 'alice')}` } })).status).toBe(404);
    await bob.client.sync();
    expect(await syncBibleTexts(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [], missing: [], removed: 1 });
    expect(await loadBibleText(bob.client, hash)).toBeNull();
  });

  it('re-importing the same abbreviation replaces the text and drops the old one everywhere (BIBLE-R5)', async () => {
    const old = await upload(h, org, alice, SAMPLE);
    await alice.client.mutate('importBible', importArgs(old));
    await alice.client.sync();
    await bob.client.sync();
    await syncBibleTexts(bob.client, downloader(h, org, 'bob'));

    const fixed: BibleBookText[] = [{ code: 'JHN', verses: [[3, 16, 'For God so loved the world.']] }];
    const hash = await upload(h, org, alice, fixed);
    await alice.client.mutate('importBible', importArgs(hash, 'web', 'World English Bible (2026)'));
    await alice.client.sync();
    await bob.client.sync();

    const s = await serverDump(h, org, 'alice');
    expect(s.tables.bibles).toMatchObject([{ id: 'bible:web', name: 'World English Bible (2026)', abbreviation: 'web', verse_count: 1 }]);
    expect(await syncBibleTexts(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [hash], missing: [], removed: 1 });
    expect(await loadBibleText(bob.client, old)).toBeNull();
    expect(await loadBibleText(bob.client, hash)).toEqual(fixed);
    expect(await loadBibleText(alice.client, old)).toBeNull();
  });

  it('the text must be uploaded first, and its hash must match (BIBLE-R4)', async () => {
    const { hash, json } = await storeBibleText(alice.client, SAMPLE);
    // Not uploaded: the server refuses the import, and the device drops the row.
    await alice.client.mutate('importBible', importArgs(hash));
    await alice.client.sync();
    expect(alice.client.rejected.map((r) => r.error)).toEqual(['bible-text-missing']);
    expect((await alice.client.dump()).bibles).toEqual([]);

    const other = await bibleTextHash(serializeBibleText(SAMPLE.slice(0, 1)));
    expect((await put(h, org, 'alice', other, json)).status).toBe(400);
    expect((await put(h, org, 'alice', 'not-a-hash', json)).status).toBe(400);
    expect((await put(h, org, 'alice', hash, '{"v":1,"books":[]}')).status).toBe(400);
    expect((await put(h, org, 'alice', hash, 'not json')).status).toBe(400);
    expect((await put(h, org, 'alice', hash, json)).status).toBe(204);
    expect((await put(h, org, 'alice', hash, json)).status).toBe(204); // idempotent
  });

  it('only admins import or delete; users read; another organisation finds nothing (D24, BIBLE-A8)', async () => {
    const { hash, json } = await storeBibleText(bob.client, SAMPLE);
    expect((await put(h, org, 'bob', hash, json)).status).toBe(403);
    await expect(bob.client.mutate('importBible', importArgs(hash))).rejects.toThrow(/may not/);

    await upload(h, org, alice, SAMPLE);
    await alice.client.mutate('importBible', importArgs(hash));
    await alice.client.sync();
    await bob.client.sync();
    await expect(bob.client.mutate('deleteBible', { id: 'bible:web' })).rejects.toThrow(/may not/);
    expect(await downloader(h, org, 'bob')(hash)).toBe(json);

    const other = `org-${crypto.randomUUID()}`;
    await setRole(h, 'eve', other, 'admin');
    expect(await downloader(h, other, 'eve')(hash)).toBeNull();
    expect((await fetch(`${h.url}/bibles/${hash}`)).status).toBe(401);
  });

  it('at most ten translations; replacing one does not count (BIBLE-R6)', async () => {
    const hash = await upload(h, org, alice, SAMPLE);
    for (let i = 0; i < BIBLE_LIMITS.bibles; i++) await alice.client.mutate('importBible', importArgs(hash, `B${i}`));
    await expect(alice.client.mutate('importBible', importArgs(hash, 'B10'))).rejects.toThrow(/maximum number of Bibles/);
    await alice.client.mutate('importBible', importArgs(hash, 'B3', 'Replaced'));
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    expect((await serverDump(h, org, 'alice')).tables.bibles).toHaveLength(10);
  });

  it('themes: a user sets a presentation’s theme; only an admin sets the default; unknown themes are refused', async () => {
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Sunday' });
    await alice.client.sync();
    await bob.client.sync();
    await bob.client.mutate('updatePresentation', { id: 'P', themeId: 'aurora' });
    await expect(bob.client.mutate('updatePresentation', { id: 'P', themeId: 'nope' })).rejects.toThrow('Theme not found.');
    await expect(bob.client.mutate('setDefaultTheme', { themeId: 'midnight' })).rejects.toThrow(/may not/);
    await alice.client.mutate('setDefaultTheme', { themeId: 'midnight' });
    await bob.client.sync();
    await alice.client.sync();
    await bob.client.pull();
    const s = await serverDump(h, org, 'alice');
    expect(s.tables.presentations[0]).toMatchObject({ id: 'P', theme_id: 'aurora' });
    expect(s.tables.org_settings).toEqual([{ id: 'defaultThemeId', value: 'midnight' }]);
    expect(JSON.stringify(await bob.client.dump())).toBe(JSON.stringify(s.tables));

    // Back to following the default (THEME-A5).
    await bob.client.mutate('updatePresentation', { id: 'P', themeId: null });
    await bob.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.presentations[0]!.theme_id).toBeNull();
  });

  it('an upsert in a mutator (setDefaultTheme) is undone, rebased onto the server and replayed, or dropped if refused', async () => {
    await setRole(h, 'dave', org, 'admin');
    const dave = await device(h, org, 'dave', 'admin');
    devices.push(dave);
    const setting = async (d: Device) => (await d.client.dump()).org_settings.map((r) => r.value);

    // Inserting, refused: alice is no longer an admin on the server, so her row goes.
    alice.net.online = false;
    await alice.client.mutate('setDefaultTheme', { themeId: 'midnight' });
    expect(await setting(alice)).toEqual(['midnight']);
    await setRole(h, 'alice', org, 'user');
    alice.net.online = true;
    await alice.client.sync();
    expect(alice.client.rejected.map((r) => r.error)).toEqual(['forbidden']);
    expect(await setting(alice)).toEqual([]);
    await setRole(h, 'alice', org, 'admin');

    // Updating, concurrently: the server's value comes in under alice's pending one, which then wins.
    await alice.client.mutate('setDefaultTheme', { themeId: 'midnight' });
    await alice.client.sync();
    alice.net.online = false;
    await alice.client.mutate('setDefaultTheme', { themeId: 'aurora' });
    await alice.client.mutate('setDefaultTheme', { themeId: 'aurora' });
    await dave.client.pull();
    await dave.client.mutate('setDefaultTheme', { themeId: 'daylight' });
    await dave.client.sync();
    alice.net.online = true;
    await alice.client.pull();
    expect(await setting(alice)).toEqual(['aurora']);
    expect(await alice.client.pending()).toHaveLength(2);
    await alice.client.sync();
    await dave.client.pull();
    expect((await serverDump(h, org, 'alice')).tables.org_settings).toEqual([{ id: 'defaultThemeId', value: 'aurora' }]);
    expect(await setting(dave)).toEqual(['aurora']);

    // Updating, refused: alice's row goes back to the server's.
    alice.net.online = false;
    await alice.client.mutate('setDefaultTheme', { themeId: 'classic' });
    await setRole(h, 'alice', org, 'user');
    alice.net.online = true;
    await alice.client.sync();
    expect(alice.client.rejected.map((r) => r.error)).toEqual(['forbidden', 'forbidden']);
    expect(await setting(alice)).toEqual(['aurora']);
    expect(JSON.stringify(await alice.client.dump())).toBe(JSON.stringify((await serverDump(h, org, 'dave')).tables));
  });

  it('measures a full-size translation: upload, first sync of a new device, and its database size', async () => {
    const books = fullSizeText();
    const json = serializeBibleText(books);
    expect(books.reduce((n, b) => n + b.verses.length, 0)).toBe(31_102);

    const emptyBytes = await dbBytes(bob.client);
    let t = performance.now();
    const hash = await upload(h, org, alice, books);
    const uploadMs = performance.now() - t;
    await alice.client.mutate('importBible', importArgs(hash, 'GEN', 'Genererad'));
    await alice.client.sync();

    // A device's first sync: the pull brings one row; then the text, once.
    t = performance.now();
    await bob.client.sync();
    const pullMs = performance.now() - t;
    t = performance.now();
    const r = await syncBibleTexts(bob.client, downloader(h, org, 'bob'));
    const textMs = performance.now() - t;
    expect(r.downloaded).toEqual([hash]);
    t = performance.now();
    const loaded = await loadBibleText(bob.client, hash);
    const loadMs = performance.now() - t;
    expect(loaded).toEqual(books);
    const deviceBytes = (await dbBytes(bob.client)) - emptyBytes;

    const line =
      `[measure] ${adapterName} full-size Bible: ${(json.length / 1e6).toFixed(2)} MB JSON, 31 102 verses, 66 rows; ` +
      `upload ${Math.round(uploadMs)} ms; first sync: pull ${Math.round(pullMs)} ms + download and store ${Math.round(textMs)} ms; ` +
      `load all books ${Math.round(loadMs)} ms; device database +${(deviceBytes / 1e6).toFixed(2)} MB`;
    console.log(line);
    expect(textMs).toBeLessThan(30_000);
  }, 120_000);
});
