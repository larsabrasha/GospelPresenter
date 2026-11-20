import { fitWithin, IMAGE_VARIANTS, MAX_SLIDE_PAGES, MAX_SLIDES_SOURCE_BYTES, MEDIA_LIMITS } from '@gp/core';
import { authHeaders } from '../auth/api.ts';
import type { SlidesImport, SlidesTarget } from '../db/protocol.ts';
import { serverUrl } from '../server.ts';

// The slide deck import (D29, PRES-R11): a PDF, or a PowerPoint deck (.pptx) where the desktop host can draw it
// (docs/powerpoint-deckcraft.md, step 1, Lars 2026-11-20). A PDF's pages are rendered once, here, by pdf.js; a
// deck's slides, at every click of their builds, by the host (crates/gp-pptx). Either way each page is a picture
// fitting 1920×1080 and a thumbnail fitting 400×225, so other devices only download pictures.

/** Why a file was not imported; the tab says each in its own words. */
export type SlidesProblem = 'powerpoint' | 'oldPowerpoint' | 'type' | 'size' | 'name' | 'pages' | 'invalid';

export class SlidesRefused extends Error {
  constructor(readonly problem: SlidesProblem) {
    super(problem);
  }
}

/** What a slideshow's picker and drop take: a PDF or a PowerPoint deck. */
export const DECK_ACCEPT = 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx';

/** The file's kind as the import takes it, by its extension or the type the browser reports. */
function kindOf(file: Pick<File, 'type' | 'name'>): 'pdf' | 'pptx' | 'ppt' | null {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (ext === 'pptx' || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (ext === 'ppt' || file.type === 'application/vnd.ms-powerpoint') return 'ppt';
  return null;
}

/** The checks that need no reading: an old PowerPoint (.ppt) is refused with how to save it otherwise. */
export function checkPickedDeck(file: Pick<File, 'type' | 'size' | 'name'>): 'pdf' | 'pptx' {
  const kind = kindOf(file);
  if (kind === 'ppt') throw new SlidesRefused('oldPowerpoint');
  if (!kind) throw new SlidesRefused('type');
  if (file.size === 0 || file.size > MAX_SLIDES_SOURCE_BYTES) throw new SlidesRefused('size');
  if (file.name.length > MEDIA_LIMITS.fileName) throw new SlidesRefused('name');
  return kind;
}

/** What the host answers for a drawn deck (apps/server/src/pptx-routes.ts). */
interface DrawnDeck {
  charts: boolean;
  contentType: 'image/jpeg';
  pages: { full: string; thumb: string }[];
}

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * A PowerPoint deck drawn by the host: every slide shown at every click, as pages. Where no host draws decks (the
 * cloud, a page without one) the server has no such route, and the deck is refused with how to save it as PDF.
 * `charts`: a slide has a chart, which may not look as in PowerPoint.
 */
async function drawPptx(file: File, target: SlidesTarget): Promise<{ slides: SlidesImport; charts: boolean }> {
  const res = await fetch(serverUrl('/api/slides/pptx'), { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...authHeaders() }, body: file });
  const body = (await res.json().catch(() => null)) as (DrawnDeck & { error?: string }) | null;
  if (res.status === 404) throw new SlidesRefused('powerpoint');
  if (res.status === 413) throw new SlidesRefused('size');
  if (!res.ok || !body) throw new SlidesRefused(body?.error === 'pages' ? 'pages' : 'invalid');
  const pages = body.pages.map((p) => ({ full: bytesOf(p.full), thumb: bytesOf(p.thumb) }));
  return { slides: { ...target, fileName: file.name, contentType: body.contentType, pages }, charts: body.charts };
}

/** A deck picked, as pages: a PDF rendered here, a PowerPoint deck drawn by the host. */
export async function renderDeck(file: File, target: SlidesTarget): Promise<{ slides: SlidesImport; charts: boolean }> {
  if (checkPickedDeck(file) === 'pptx') return drawPptx(file, target);
  return { slides: await renderPdf(file, target), charts: false };
}

/** The browser's canvas encodes WebP; WebKit's silently answers PNG, so that device stores JPEG instead. */
async function encode(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/jpeg', quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Reads the PDF and renders every page, `onPage(done, total)` after each. pdf.js
 * is loaded here, on first use, so the app does not carry it until a deck is imported.
 */
async function renderPdf(file: File, target: SlidesTarget, onPage?: (done: number, total: number) => void): Promise<SlidesImport> {
  checkPickedDeck(file);
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    throw new SlidesRefused('invalid');
  }
  try {
    if (doc.numPages > MAX_SLIDE_PAGES) throw new SlidesRefused('pages');
    let type: 'image/webp' | 'image/jpeg' = 'image/webp';
    const pages: SlidesImport['pages'] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // A vector page is drawn at the size it is shown, so it fills 1920×1080 even from 960×540 points.
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(IMAGE_VARIANTS.full.width / base.width, IMAGE_VARIANTS.full.height / base.height);
      const viewport = page.getViewport({ scale });
      const full = canvasOf(Math.min(IMAGE_VARIANTS.full.width, Math.round(viewport.width)), Math.min(IMAGE_VARIANTS.full.height, Math.round(viewport.height)));
      await page.render({ canvas: full, viewport }).promise;
      page.cleanup();
      let fullBlob = await encode(full, type, IMAGE_VARIANTS.full.quality);
      if (fullBlob.type !== type) {
        type = 'image/jpeg'; // a page has a white background, so nothing is lost but size
        fullBlob = await encode(full, type, IMAGE_VARIANTS.full.quality);
      }
      const size = fitWithin(full.width, full.height, IMAGE_VARIANTS.thumb.width, IMAGE_VARIANTS.thumb.height);
      const thumb = canvasOf(size.width, size.height);
      const ctx = thumb.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, 0, 0, size.width, size.height);
      const thumbBlob = await encode(thumb, type, IMAGE_VARIANTS.thumb.quality);
      pages.push({ full: new Uint8Array(await fullBlob.arrayBuffer()), thumb: new Uint8Array(await thumbBlob.arrayBuffer()) });
      onPage?.(n, doc.numPages);
    }
    if (!pages.length) throw new SlidesRefused('invalid');
    return { ...target, fileName: file.name, contentType: type, pages };
  } catch (e) {
    throw e instanceof SlidesRefused ? e : new SlidesRefused('invalid');
  } finally {
    void task.destroy();
  }
}
