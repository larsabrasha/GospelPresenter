import { Hono, type Context } from 'hono';
import { can, MAX_SLIDE_PAGES } from '@gp/core';
import type { Caller } from './auth/index.ts';
import type { Org } from './app.ts';

// A PowerPoint deck drawn as a slideshow's pages (docs/powerpoint-deckcraft.md, step 1, Lars 2026-11-20): the page
// sends the .pptx, the host draws every slide shown at every click (crates/gp-pptx, DeckCraft's libraries), and the
// page keeps the pictures as a PDF's pages, so they sync and show as those do. Only where the host can draw them
// (the desktop host, `NodeServerOptions.pptx`); elsewhere the route is not there (404) and the page asks for a PDF,
// having asked first (GET) so a deck is not sent for nothing.

/**
 * A deck's pages, drawn, at most `max`: a full picture and a thumbnail each (JPEG), and whether a slide has a chart;
 * `invalid` when the file does not read, `pages` when it has more than `max`.
 */
export type PptxPages = (pptx: Uint8Array, max: number) => Promise<{ charts: boolean; pages: { full: Uint8Array; thumb: Uint8Array }[] } | 'invalid' | 'pages'>;

const base64 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');

export function pptxRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, draw: PptxPages) {
  const app = new Hono();

  // Whether this server draws decks: it does, where the route is there at all.
  app.get('/api/slides/pptx', async (c) => {
    const r = await resolve(c);
    return r instanceof Response ? r : c.json({ ok: true });
  });

  app.post('/api/slides/pptx', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManagePresentations')) return c.json({ error: 'forbidden' }, 403);
    const deck = await draw(new Uint8Array(await c.req.arrayBuffer()), MAX_SLIDE_PAGES);
    if (deck === 'invalid' || deck === 'pages') return c.json({ error: deck }, 400);
    if (!deck.pages.length) return c.json({ error: 'invalid' }, 400);
    return c.json({ charts: deck.charts, contentType: 'image/jpeg', pages: deck.pages.map((p) => ({ full: base64(p.full), thumb: base64(p.thumb) })) });
  });

  return app;
}
