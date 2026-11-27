// MCP's tools for how slides look (docs/mcp.md): themes, overlays and the pictures they show, fetched from the web by
// the server, against every server adapter. The pictures are served from this machine, which test builds allow.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { McpKeyCreated, Role } from '@gp/core';
import { api, setRole, startAdapter, type AdapterName, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];

type Rpc = { jsonrpc: '2.0'; id: number; result?: { content: { text: string }[]; isError?: boolean } };
type Picture = { picture: { full: string; thumb: string }; width: number; height: number };

/** A PNG of `width` × `height` half-transparent red pixels, made here so no file is needed. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [255, 0, 0, 128]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

/** The pictures the tests fetch: a small logo, a wide picture larger than the stage, and a page that is no picture. */
const FILES: Record<string, [string, Buffer]> = {
  '/logo.png': ['image/png', png(200, 100)],
  '/wide.png': ['image/png', png(3000, 1000)],
  '/page.html': ['text/html', Buffer.from('<!doctype html><title>no picture</title>')],
  // A logo as SVG, with a script, which must never run nor be kept.
  '/logo.svg': [
    'image/svg+xml',
    Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><script>alert(1)</script><circle cx="25" cy="25" r="20" fill="#ff0000"/></svg>'),
  ],
};

let files: Server;
let filesUrl: string;
beforeAll(async () => {
  files = createServer((req, res) => {
    const file = FILES[req.url ?? ''];
    if (!file) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': file[0] }).end(file[1]);
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  filesUrl = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => files.close(() => resolve())));

for (const adapter of adapters) {
  describe(`MCP: themes, overlays and pictures (${adapter})`, () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startAdapter(adapter);
    }, 60_000);
    afterAll(async () => {
      await h?.close();
    });

    let org: string;
    let su: string;
    beforeEach(async () => {
      org = `org-${crypto.randomUUID()}`;
      su = await setRole(h, `su-${crypto.randomUUID()}`, org, 'superAdmin');
    });

    let session = '';
    /** A key of a new member of `org` with `role`, MCP turned on for them; their session is `session`. */
    async function keyOf(role: Role) {
      const userId = `u-${crypto.randomUUID()}`;
      session = await setRole(h, userId, org, role);
      expect((await api(h, 'PUT', `/api/users/${userId}/mcp`, { token: su, body: { enabled: true } })).status).toBe(200);
      const made = await api<McpKeyCreated>(h, 'POST', '/api/auth/mcp-keys', { token: session, body: { name: 'Claude' } });
      return made.body.secret;
    }
    let rpcId = 0;
    async function call<T = Record<string, unknown>>(key: string, name: string, args: unknown = {}) {
      const r = await api<Rpc>(h, 'POST', '/api/mcp', { token: key, body: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } } });
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('result');
      return { value: JSON.parse(r.body.result!.content[0]!.text) as T, isError: !!r.body.result!.isError };
    }

    // ------------------------------------------------------------ themes

    it("an Admin's key makes a theme as a copy of the default with a change, the rest kept", async () => {
      const key = await keyOf('admin');

      const made = await call<{ id: string; definition: { song: { main: { color: string; fontSize: number } } } }>(key, 'create_theme', {
        name: 'Gult',
        changes: { song: { main: { color: '#ffd700' } } },
      });

      expect(made.isError).toBe(false);
      expect([made.value.definition.song.main.color, made.value.definition.song.main.fontSize]).toEqual(['#ffd700', 75]);
    });

    it("a member's key may not make a theme", async () => {
      const key = await keyOf('user');

      const made = await call(key, 'create_theme', { name: 'Gult' });

      expect(made).toEqual({ value: { error: 'forbidden', detail: expect.any(String) }, isError: true });
    });

    it('a built-in theme is not changed', async () => {
      const key = await keyOf('admin');

      const changed = await call(key, 'update_theme', { themeId: 'classic', changes: { song: { main: { color: '#ffd700' } } } });

      expect(changed.value).toMatchObject({ error: 'forbidden' });
    });

    it('a change that is no theme, a colour that is not one, is refused before it is saved', async () => {
      const key = await keyOf('admin');

      const made = await call(key, 'create_theme', { name: 'Fel', changes: { song: { main: { fontSize: 5000 } } } });

      expect(made.value).toMatchObject({ error: 'invalid-arguments' });
    });

    it("an own theme is changed in the field named, its other fields as they were, and renamed", async () => {
      const key = await keyOf('admin');
      const { value: made } = await call<{ id: string }>(key, 'create_theme', { name: 'Söndag', changes: { song: { main: { color: '#ffd700' } } } });

      const { value } = await call<{ name: string; definition: { song: { main: { color: string; fontSize: number } } } }>(key, 'update_theme', {
        themeId: made.id,
        name: 'Högtid',
        changes: { song: { main: { fontSize: 90 } } },
      });

      expect([value.name, value.definition.song.main.color, value.definition.song.main.fontSize]).toEqual(['Högtid', '#ffd700', 90]);
    });

    // ------------------------------------------------------------ overlays

    it("an overlay's elements are written anew, and it is renamed", async () => {
      const key = await keyOf('user');
      const text = (id: string, words: string) => ({ id, kind: 'text', x: 54, y: 54, w: 800, h: 100, text: words, size: 64, bold: false, italic: false, align: 'left', color: null });
      const { value: made } = await call<{ overlayId: string }>(key, 'create_overlay', { title: 'Kollekt', elements: [text('a', 'Swish')] });

      const { value } = await call<{ overlay: { title: string; elements: { text: string }[] } }>(key, 'update_overlay', {
        overlayId: made.overlayId,
        title: 'Gåvor',
        elements: [text('a', 'Swish 123 45'), text('b', 'Tack!')],
      });

      expect([value.overlay.title, value.overlay.elements.map((e) => e.text)]).toEqual(['Gåvor', ['Swish 123 45', 'Tack!']]);
    });


    it('an overlay made with a text reads back with it, and goes on an item of a presentation', async () => {
      const key = await keyOf('user');
      const text = { id: 'swish', kind: 'text', x: 54, y: 54, w: 800, h: 100, text: 'Swish 123 45', size: 64, bold: true, italic: false, align: 'left', color: null };
      const { value: made } = await call<{ overlayId: string }>(key, 'create_overlay', { title: 'Kollekt', elements: [text] });
      const { value: p } = await call<{ presentationId: string }>(key, 'create_presentation', { name: 'Söndag' });
      const { value: item } = await call<{ itemId: string }>(key, 'add_header_to_presentation', { presentationId: p.presentationId, title: 'Kollekt' });

      const set = await call<{ presentation: { items: { overlayId: string | null }[] } }>(key, 'set_item_overlay', { itemId: item.itemId, overlayId: made.overlayId });
      const read = await call<{ elements: { text: string }[] }>(key, 'get_overlay', { overlayId: made.overlayId });

      expect(read.value.elements.map((e) => e.text)).toEqual(['Swish 123 45']);
      expect(set.value.presentation.items.map((i) => i.overlayId)).toEqual([made.overlayId]);
    });

    // ------------------------------------------------------------ pictures

    it('a picture from an address is kept as two blobs of the organisation, its size as fetched', async () => {
      const key = await keyOf('user');

      const { value, isError } = await call<Picture>(key, 'add_picture_from_url', { url: `${filesUrl}/logo.png` });

      expect(isError).toBe(false);
      expect([value.width, value.height]).toEqual([200, 100]);
      expect(await h.mediaKeys()).toEqual(expect.arrayContaining([expect.stringContaining(value.picture.full), expect.stringContaining(value.picture.thumb)]));
    });

    it('a PNG is kept as WebP with its transparency, as the app keeps one', async () => {
      const key = await keyOf('user');
      const { value } = await call<Picture>(key, 'add_picture_from_url', { url: `${filesUrl}/logo.png` });

      const res = await fetch(`${h.url}/api/media/${value.picture.full}`, { headers: { authorization: `Bearer ${session}` } });
      const bytes = Buffer.from(await res.arrayBuffer());

      expect(res.headers.get('content-type')).toBe('image/webp');
      // An alpha channel: a lossy WebP's ALPH chunk, or a lossless one, which always has it.
      expect(bytes.includes('ALPH') || bytes.includes('VP8L')).toBe(true);
    });

    it('a picture larger than the stage is made to fit within 1920×1080, its shape kept', async () => {
      const key = await keyOf('user');

      const { value } = await call<Picture>(key, 'add_picture_from_url', { url: `${filesUrl}/wide.png` });

      expect([value.width, value.height]).toEqual([1920, 640]);
    });

    it('an SVG is drawn filling the stage and kept as WebP with its transparency, never as SVG', async () => {
      const key = await keyOf('user');
      const { value } = await call<Picture>(key, 'add_picture_from_url', { url: `${filesUrl}/logo.svg` });

      const res = await fetch(`${h.url}/api/media/${value.picture.full}`, { headers: { authorization: `Bearer ${session}` } });
      const bytes = Buffer.from(await res.arrayBuffer());

      expect([value.width, value.height, res.headers.get('content-type')]).toEqual([1920, 960, 'image/webp']);
      expect(bytes.includes('ALPH') || bytes.includes('VP8L')).toBe(true);
    });

    it('a page that is no picture is refused', async () => {
      const key = await keyOf('user');

      const fetched = await call(key, 'add_picture_from_url', { url: `${filesUrl}/page.html` });

      expect(fetched.value).toMatchObject({ error: 'invalid-image' });
    });

    it("an address in the church's own network is refused, nothing fetched", async () => {
      const key = await keyOf('user');

      const fetched = await call(key, 'add_picture_from_url', { url: 'https://192.168.1.1/logo.png' });

      expect(fetched.value).toMatchObject({ error: 'invalid-url' });
    });

    it('a fetched picture stands on an overlay and behind a theme', async () => {
      const key = await keyOf('admin');
      const { value: logo } = await call<Picture>(key, 'add_picture_from_url', { url: `${filesUrl}/logo.png` });
      const image = { id: 'logo', kind: 'image', x: 1666, y: 54, w: 200, h: 100, picture: logo.picture, fit: 'contain' };

      const overlay = await call(key, 'create_overlay', { title: 'Swish', elements: [image] });
      const theme = await call(key, 'create_theme', { name: 'Med bild', changes: { song: { background: { image: { kind: 'picture', ...logo.picture } } } } });

      expect([overlay.isError, theme.isError]).toEqual([false, false]);
    });
  });
}
