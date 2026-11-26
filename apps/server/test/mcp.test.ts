// MCP (docs/mcp.md) against every server adapter: a Superadmin turns the experiment on for someone, who makes their
// own keys; a key acts as its maker in its organisation, through `POST /api/mcp`, and what it changes reaches devices.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bibleId, MCP_LIMITS, type McpKeyCreated, type McpKeyRow, type Me, type UserRow } from '@gp/core';
import { storeBibleText } from '@gp/sync/client';
import { api, device, setRole, startAdapter, type AdapterName, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];

type Rpc = { jsonrpc: '2.0'; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

for (const adapter of adapters) {
  describe(`MCP (${adapter})`, () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startAdapter(adapter);
    }, 60_000);
    afterAll(async () => {
      await h?.close();
    });

    let org: string;
    /** A Superadmin in superadminläge, and a plain member, each with a session in `org`. */
    let su: string;
    let anna: { id: string; token: string };
    beforeEach(async () => {
      org = `org-${crypto.randomUUID()}`;
      su = await setRole(h, `su-${crypto.randomUUID()}`, org, 'superAdmin');
      const id = `anna-${crypto.randomUUID()}`;
      anna = { id, token: await setRole(h, id, org, 'user') };
    });

    const setMcp = (userId: string, enabled: boolean, token = su) => api(h, 'PUT', `/api/users/${userId}/mcp`, { token, body: { enabled } });
    const makeKey = (token = anna.token, name = 'Claude') => api<McpKeyCreated & { error?: string }>(h, 'POST', '/api/auth/mcp-keys', { token, body: { name } });
    /** Anna with the experiment on and a key. */
    async function annaKey() {
      expect((await setMcp(anna.id, true)).status).toBe(200);
      const r = await makeKey();
      expect(r.status).toBe(200);
      return r.body;
    }
    /** An Admin of `org` with MCP on and a key: their id, and the key's secret. */
    async function adminKey() {
      const adminId = `ad-${crypto.randomUUID()}`;
      const admin = await setRole(h, adminId, org, 'admin');
      expect((await setMcp(adminId, true)).status).toBe(200);
      const r = await makeKey(admin);
      expect(r.status).toBe(200);
      return { adminId, secret: r.body.secret };
    }
    let rpcId = 0;
    const rpc = (key: string | null, method: string, params?: unknown) =>
      api<Rpc>(h, 'POST', '/api/mcp', { ...(key ? { token: key } : {}), body: { jsonrpc: '2.0', id: ++rpcId, method, ...(params === undefined ? {} : { params }) } });
    /** A tool's answer, read from its JSON text; `isError` when the tool refused. */
    async function call<T = Record<string, unknown>>(key: string, name: string, args: unknown = {}) {
      const r = await rpc(key, 'tools/call', { name, arguments: args });
      expect(r.status).toBe(200);
      const res = r.body.result as { content: { text: string }[]; isError?: boolean };
      return { value: JSON.parse(res.content[0]!.text) as T, isError: !!res.isError };
    }

    // ------------------------------------------------------------ the switch and the keys

    it('a Superadmin turning MCP on for a member shows it in their Me and their row', async () => {
      await setMcp(anna.id, true);

      const me = await api<Me>(h, 'GET', '/api/auth/me', { token: anna.token });
      const row = await api<UserRow>(h, 'GET', `/api/users/${anna.id}`, { token: su });

      expect([me.body.mcp, row.body.mcp]).toEqual([true, true]);
    });

    it('an Admin outside superadminläge may not turn MCP on', async () => {
      const admin = await setRole(h, `ad-${crypto.randomUUID()}`, org, 'admin');

      const r = await setMcp(anna.id, true, admin);

      expect(r).toEqual({ status: 403, body: { error: 'super-admin-only' } });
    });

    it('a member MCP is off for makes no key', async () => {
      const r = await makeKey();

      expect(r).toEqual({ status: 403, body: { error: 'forbidden' } });
    });

    it('a new key is answered with its secret once; the list never holds it', async () => {
      const made = await annaKey();

      const list = await api<McpKeyRow[]>(h, 'GET', '/api/auth/mcp-keys', { token: anna.token });

      expect(made.secret).toMatch(/^gpmcp_/);
      expect(list.body).toEqual([made.key]);
      expect(JSON.stringify(list.body)).not.toContain(made.secret);
    });

    it(`a member makes at most ${MCP_LIMITS.keysPerUser} keys`, async () => {
      await annaKey();
      for (let i = 1; i < MCP_LIMITS.keysPerUser; i++) expect((await makeKey()).status).toBe(200);

      const r = await makeKey();

      expect(r).toEqual({ status: 409, body: { error: 'limit' } });
    });

    // ------------------------------------------------------------ who a request is

    it('a request without a key, or with one that is not a key, is 401', async () => {
      const none = await rpc(null, 'tools/list');
      const wrong = await rpc('gpmcp_not-a-key', 'tools/list');
      const session = await rpc(anna.token, 'tools/list');

      expect([none.status, wrong.status, session.status]).toEqual([401, 401, 401]);
    });

    it('turning MCP off deletes its keys: none works again when it is turned back on', async () => {
      const { secret } = await annaKey();

      await setMcp(anna.id, false);
      await setMcp(anna.id, true);

      expect((await rpc(secret, 'tools/list')).status).toBe(401);
    });

    it('turning MCP off empties the list of keys', async () => {
      await annaKey();

      await setMcp(anna.id, false);

      expect((await api<McpKeyRow[]>(h, 'GET', '/api/auth/mcp-keys', { token: anna.token })).body).toEqual([]);
    });

    it('a deleted key is 401', async () => {
      const { key, secret } = await annaKey();

      expect((await api(h, 'DELETE', `/api/auth/mcp-keys/${key.id}`, { token: anna.token })).status).toBe(200);

      expect((await rpc(secret, 'tools/list')).status).toBe(401);
    });

    it("a key of someone removed from its organisation is 401", async () => {
      const { secret } = await annaKey();

      expect((await api(h, 'DELETE', `/api/users/${anna.id}`, { token: su })).status).toBe(200);

      expect((await rpc(secret, 'tools/list')).status).toBe(401);
    });

    // ------------------------------------------------------------ the protocol

    it('initialize answers the version asked for and offers tools', async () => {
      const { secret } = await annaKey();

      const r = await rpc(secret, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

      expect(r.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gospel-presenter' } });
    });

    it('a notification is accepted without an answer', async () => {
      const { secret } = await annaKey();

      const r = await api(h, 'POST', '/api/mcp', { token: secret, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });

      expect(r).toEqual({ status: 202, body: null });
    });

    it('tools/list describes each tool with a JSON schema of its arguments', async () => {
      const { secret } = await annaKey();

      const tools = (await rpc(secret, 'tools/list')).body.result!.tools as { name: string; inputSchema: { type: string } }[];

      expect(tools.map((t) => t.name)).toContain('add_song_to_presentation');
      expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    });

    it('tools/list marks the tools that only read, and the one that removes', async () => {
      const { secret } = await annaKey();

      const tools = (await rpc(secret, 'tools/list')).body.result!.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[];
      const hints = Object.fromEntries(tools.map((t) => [t.name, [t.annotations.readOnlyHint, t.annotations.destructiveHint]]));

      expect([hints.get_song, hints.add_song_to_presentation, hints.remove_item]).toEqual([[true, false], [false, false], [false, true]]);
    });

    it('a batch is answered message by message, without answers to its notifications', async () => {
      const { secret } = await annaKey();

      const r = await api<Rpc[]>(h, 'POST', '/api/mcp', {
        token: secret,
        body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping' }],
      });

      expect(r).toEqual({ status: 200, body: [{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }] });
    });

    it('an unknown tool is a JSON-RPC error', async () => {
      const { secret } = await annaKey();

      const r = await rpc(secret, 'tools/call', { name: 'drop_everything', arguments: {} });

      expect(r.body.error?.code).toBe(-32602);
    });

    // ------------------------------------------------------------ the tools

    it("a presentation made through MCP reaches a member's device", async () => {
      const { secret } = await annaKey();
      const d = await device(h, org, anna.id, 'user');

      const made = await call<{ presentationId: string }>(secret, 'create_presentation', { name: 'Gudstjänst', eventDate: '2026-11-29', time: '11:00' });
      await d.client.pull();

      const row = (await d.client.dump()).presentations.find((p) => p.id === made.value.presentationId);
      expect(row).toMatchObject({ name: 'Gudstjänst', event_date: '2026-11-29', time: '11:00' });
      await d.client.close();
    });

    /** Anna's device makes the song S1 with one verse, a draft song S2 whose lyrics match too, and the presentation P. */
    async function seed() {
      const d = await device(h, org, anna.id, 'user');
      await d.client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
      await d.client.mutate('addSongPart', { id: 'P1', songId: 'S1', labelText: 'Vers 1', content: 'Härlig är jorden, härlig är Guds himmel' });
      await d.client.mutate('createSong', { id: 'S2', name: 'Utkast', draft: true });
      await d.client.mutate('addSongPart', { id: 'P2', songId: 'S2', labelText: 'Vers 1', content: 'Guds himmel' });
      await d.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
      await d.client.sync();
      await d.client.close();
    }

    it('search_songs finds a song by its lyrics, and not a draft', async () => {
      const { secret } = await annaKey();
      await seed();

      const found = await call<{ id: string }[]>(secret, 'search_songs', { query: 'guds himmel' });

      expect(found.value.map((s) => s.id)).toEqual(['S1']);
    });

    it('get_song refuses a draft, as no list shows one', async () => {
      const { secret } = await annaKey();
      await seed();

      const r = await call<{ error: string }>(secret, 'get_song', { songId: 'S2' });

      expect(r).toMatchObject({ isError: true, value: { error: 'not-found' } });
    });

    it('add_song_to_presentation puts the song in the running order', async () => {
      const { secret } = await annaKey();
      await seed();

      await call(secret, 'add_song_to_presentation', { presentationId: 'P', songId: 'S1' });

      const p = await call<{ items: { type: string; title: string }[] }>(secret, 'get_presentation', { presentationId: 'P' });
      expect(p.value.items).toMatchObject([{ type: 'song', title: 'Härlig är jorden' }]);
    });

    it("create_presentation from a template copies the template's running order", async () => {
      const { adminId, secret } = await adminKey();
      const d = await device(h, org, adminId, 'admin');
      await d.client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
      await d.client.mutate('createTemplate', { id: 'T', name: 'Söndag' });
      await d.client.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'T', songId: 'S1', arrangementId: null, afterItemId: null });
      await d.client.sync();
      await d.client.close();

      const made = await call<{ presentationId: string }>(secret, 'create_presentation', { name: 'Gudstjänst', templateId: 'T' });

      const p = await call<{ items: { type: string; title: string }[] }>(secret, 'get_presentation', { presentationId: made.value.presentationId });
      expect(p.value.items).toMatchObject([{ type: 'song', title: 'Härlig är jorden' }]);
    });

    it('add_bible_text_to_presentation adds the passage a reference names, titled as the app titles it', async () => {
      const { secret } = await annaKey();
      // Only an Admin imports a Bible (D24).
      const adminId = `ad-${crypto.randomUUID()}`;
      const admin = await setRole(h, adminId, org, 'admin');
      const d = await device(h, org, adminId, 'admin');
      const { hash, json } = await storeBibleText(d.client, [{ code: 'JHN', verses: [[3, 16, 'Ty så älskade Gud världen'], [3, 17, 'Gud sände inte sin Son'], [3, 18, 'Den som tror']] }]);
      expect((await api(h, 'PUT', `/api/bibles/${hash}`, { token: admin, body: JSON.parse(json) })).status).toBe(204);
      await d.client.mutate('importBible', { name: 'Bibel 2000', abbreviation: 'B2000', language: 'sv', contentHash: hash });
      await d.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
      await d.client.sync();
      await d.client.close();

      const added = await call<{ title: string }>(secret, 'add_bible_text_to_presentation', { presentationId: 'P', bibleId: bibleId('B2000'), reference: 'Joh 3:16-17' });

      expect(added).toMatchObject({ value: { itemId: expect.any(String), title: 'Johannes 3:16-17' }, isError: false });
    });

    // ------------------------------------------------------------ changing a running order (docs/mcp.md, round 1)

    type Presentation = { name: string; eventDate: string | null; time: string | null; location: string | null; items: { id: string; type: string; title: string; note: string | null; arrangementId: string | null }[] };
    type Changed = { presentation: Presentation };

    /**
     * Anna's presentation P on 29 November at 11:00 in Kyrkan: the song S1 (item I1, with the arrangement A1 to choose),
     * then the heading Kollekt (I2) and the song S1 again (I3).
     */
    async function runningOrder() {
      const d = await device(h, org, anna.id, 'user');
      await d.client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
      await d.client.mutate('addSongPart', { id: 'SP1', songId: 'S1', labelText: 'Vers 1', content: 'Härlig är jorden' });
      await d.client.mutate('createArrangement', { id: 'A1', songId: 'S1', name: 'Kort', partIds: ['SP1'] });
      await d.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: '2026-11-29', time: '11:00', location: 'Kyrkan' });
      await d.client.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'S1' });
      await d.client.mutate('addHeaderToPresentation', { itemId: 'I2', presentationId: 'P', title: 'Kollekt' });
      await d.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S1' });
      await d.client.sync();
      await d.client.close();
    }
    const ids = (p: Presentation) => p.items.map((i) => i.id);

    it('update_presentation changes the fields it names and keeps the others', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'update_presentation', { presentationId: 'P', name: 'Första advent', time: '10:00' });

      expect(r.value.presentation).toMatchObject({ name: 'Första advent', eventDate: '2026-11-29', time: '10:00', location: 'Kyrkan' });
    });

    it('update_presentation clears a field given as null', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'update_presentation', { presentationId: 'P', location: null });

      expect(r.value.presentation.location).toBeNull();
    });

    it('add_header_to_presentation adds a heading after the item named', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed & { itemId: string }>(secret, 'add_header_to_presentation', { presentationId: 'P', title: 'Predikan', afterItemId: 'I1' });

      expect(r.value.presentation.items[1]).toMatchObject({ id: r.value.itemId, type: 'header', title: 'Predikan' });
    });

    it('reorder_items puts the running order in the order given', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'reorder_items', { presentationId: 'P', itemIds: ['I3', 'I1', 'I2'] });

      expect(ids(r.value.presentation)).toEqual(['I3', 'I1', 'I2']);
    });

    it('reorder_items refuses a list that leaves an item out, rather than putting it last', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<{ error: string }>(secret, 'reorder_items', { presentationId: 'P', itemIds: ['I3', 'I1'] });

      expect(r).toMatchObject({ isError: true, value: { error: 'invalid-order' } });
    });

    it('rename_item renames the item, not its song', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      await call(secret, 'rename_item', { itemId: 'I1', title: 'Inledningssång' });

      const song = await call<{ name: string }>(secret, 'get_song', { songId: 'S1' });
      const p = await call<Presentation>(secret, 'get_presentation', { presentationId: 'P' });
      expect([p.value.items[0]!.title, song.value.name]).toEqual(['Inledningssång', 'Härlig är jorden']);
    });

    it('set_item_note sets the note of the item', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'set_item_note', { itemId: 'I2', note: 'Swish 123 456' });

      expect(r.value.presentation.items[1]!.note).toBe('Swish 123 456');
    });

    it("update_item_arrangement chooses one of the song's arrangements for the item", async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'update_item_arrangement', { itemId: 'I1', arrangementId: 'A1' });

      expect(r.value.presentation.items[0]!.arrangementId).toBe('A1');
    });

    it('remove_item removes the item from the running order', async () => {
      const { secret } = await annaKey();
      await runningOrder();

      const r = await call<Changed>(secret, 'remove_item', { itemId: 'I2' });

      expect(ids(r.value.presentation)).toEqual(['I1', 'I3']);
    });

    it("a template's running order is not changed through MCP, even by an Admin", async () => {
      const { adminId, secret } = await adminKey();
      const d = await device(h, org, adminId, 'admin');
      await d.client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
      await d.client.mutate('createTemplate', { id: 'T', name: 'Söndag' });
      await d.client.sync();
      await d.client.close();

      const r = await call<{ error: string }>(secret, 'add_song_to_presentation', { presentationId: 'T', songId: 'S1' });

      expect(r).toMatchObject({ isError: true, value: { error: 'not-found' } });
    });

    it("an item of a template is not found by the item tools", async () => {
      const { adminId, secret } = await adminKey();
      const d = await device(h, org, adminId, 'admin');
      await d.client.mutate('createTemplate', { id: 'T', name: 'Söndag' });
      await d.client.mutate('addHeaderToPresentation', { itemId: 'TI', presentationId: 'T', title: 'Kollekt' });
      await d.client.sync();
      await d.client.close();

      const r = await call<{ error: string }>(secret, 'remove_item', { itemId: 'TI' });

      expect(r).toMatchObject({ isError: true, value: { error: 'not-found' } });
    });

    it("a mutator's refusal is the tool's error, not the request's", async () => {
      const { secret } = await annaKey();

      const r = await call<{ error: string }>(secret, 'add_song_to_presentation', { presentationId: 'nowhere', songId: 'S1' });

      expect(r.isError).toBe(true);
      expect(r.value.error).toBe('not-found');
    });

    it('arguments that do not read are the tool\'s error', async () => {
      const { secret } = await annaKey();

      const r = await call<{ error: string }>(secret, 'create_presentation', { name: '', time: '25:00' });

      expect(r).toMatchObject({ isError: true, value: { error: 'invalid-arguments' } });
    });
  });
}
