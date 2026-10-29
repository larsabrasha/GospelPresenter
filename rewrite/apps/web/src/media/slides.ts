import { fitWithin, IMAGE_VARIANTS, MAX_SLIDE_PAGES, MAX_SLIDES_SOURCE_BYTES, MEDIA_LIMITS } from '@gp/core';
import type { SlidesImport } from '../db/protocol.ts';

// The slide deck import (D29, PRES-R11): only PDF. A PowerPoint, Keynote or
// Google Slides deck is saved as PDF first, in the program that made it. Each
// page is rendered once, here, by pdf.js, to a picture fitting 1920×1080 and a
// thumbnail fitting 400×225, so other devices only download pictures.

/** Why a file was not imported; the tab says each in its own words. */
export type SlidesProblem = 'powerpoint' | 'type' | 'size' | 'name' | 'pages' | 'invalid';

export class SlidesRefused extends Error {
  constructor(readonly problem: SlidesProblem) {
    super(problem);
  }
}

/** The checks that need no reading: a PowerPoint is refused with how to save it as PDF. */
export function checkPickedDeck(file: Pick<File, 'type' | 'size' | 'name'>): void {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pptx' || ext === 'ppt' || file.type.includes('presentation') || file.type === 'application/vnd.ms-powerpoint') throw new SlidesRefused('powerpoint');
  if (file.type !== 'application/pdf' && ext !== 'pdf') throw new SlidesRefused('type');
  if (file.size === 0 || file.size > MAX_SLIDES_SOURCE_BYTES) throw new SlidesRefused('size');
  if (file.name.length > MEDIA_LIMITS.fileName) throw new SlidesRefused('name');
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
export async function renderPdf(file: File, ids: { itemId: string; presentationId: string; afterItemId: string | null }, onPage?: (done: number, total: number) => void): Promise<SlidesImport> {
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
    return { ...ids, fileName: file.name, contentType: type, pages };
  } catch (e) {
    throw e instanceof SlidesRefused ? e : new SlidesRefused('invalid');
  } finally {
    void task.destroy();
  }
}
