import { blankPage, CANVAS, CUSTOM_LIMITS, type CustomElement, type CustomPage } from '@gp/core';

// What the editor does to a custom slide's pages (docs/custom-slides.md), as plain functions: each returns new pages,
// so the editor keeps them in its state and saves them whole.

export type NewKind = 'text' | 'rect' | 'roundedRect' | 'ellipse' | 'line' | 'image';

const W = CANVAS.width;
const H = CANVAS.height;

/** A new element of `kind` in the middle of the stage, at a size that suits it; a picture fitted inside 800×450. */
export function newElement(kind: NewKind, id: string, image?: { imageId: string; width: number; height: number }): CustomElement {
  const centred = (w: number, h: number) => ({ id, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h });
  switch (kind) {
    case 'text':
      return { ...centred(1200, 160), kind, text: 'Text', size: 96, bold: false, italic: false, align: 'center', color: null };
    case 'rect':
    case 'roundedRect':
      return { ...centred(640, 400), kind: 'rect', fill: '#3b82f6', stroke: null, strokeWidth: 0, radius: kind === 'rect' ? 0 : 48 };
    case 'ellipse':
      return { ...centred(400, 400), kind, fill: '#ef4444', stroke: null, strokeWidth: 0, radius: 0 };
    case 'line':
      return { id, x: (W - 800) / 2, y: H / 2, w: 800, h: 0, kind, stroke: null, strokeWidth: 8 };
    case 'image': {
      const scale = Math.min(800 / (image?.width ?? 800), 450 / (image?.height ?? 450), 1);
      const w = Math.round((image?.width ?? 800) * scale);
      const h = Math.round((image?.height ?? 450) * scale);
      return { ...centred(w, h), kind, imageId: image?.imageId ?? '', fit: 'contain' };
    }
  }
}

/** `pages` with page `at` changed by `fn`. */
export function withPage(pages: CustomPage[], at: number, fn: (page: CustomPage) => CustomPage): CustomPage[] {
  return pages.map((p, i) => (i === at ? fn(p) : p));
}

export function addElement(page: CustomPage, e: CustomElement): CustomPage {
  return page.elements.length >= CUSTOM_LIMITS.elements ? page : { ...page, elements: [...page.elements, e] };
}

export function changeElement(page: CustomPage, id: string, patch: Partial<CustomElement>): CustomPage {
  return { ...page, elements: page.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CustomElement) : e)) };
}

export function removeElement(page: CustomPage, id: string): CustomPage {
  return { ...page, elements: page.elements.filter((e) => e.id !== id) };
}

/** A copy a little down and to the right of it, above it. */
export function duplicateElement(page: CustomPage, id: string, newId: string): CustomPage {
  const e = page.elements.find((x) => x.id === id);
  return e ? addElement(page, { ...e, id: newId, x: e.x + 40, y: e.y + 40 }) : page;
}

/** One step up or down the drawing order, or to the top or the bottom of it. */
export function reorderElement(page: CustomPage, id: string, to: 'up' | 'down' | 'top' | 'bottom'): CustomPage {
  const from = page.elements.findIndex((e) => e.id === id);
  if (from < 0) return page;
  const last = page.elements.length - 1;
  const target = to === 'top' ? last : to === 'bottom' ? 0 : Math.min(last, Math.max(0, from + (to === 'up' ? 1 : -1)));
  const elements = page.elements.filter((e) => e.id !== id);
  elements.splice(target, 0, page.elements[from]!);
  return { ...page, elements };
}

/** A new page after `at`: blank, or a copy of page `at` with new element ids. */
export function addPage(pages: CustomPage[], at: number, copy: boolean, newId: () => string): CustomPage[] {
  if (pages.length >= CUSTOM_LIMITS.pages) return pages;
  const page = copy ? { ...pages[at]!, elements: pages[at]!.elements.map((e) => ({ ...e, id: newId() })) } : blankPage();
  return [...pages.slice(0, at + 1), page, ...pages.slice(at + 1)];
}

/** Without page `at`; the last page stays, as a slide has one at least. */
export function removePage(pages: CustomPage[], at: number): CustomPage[] {
  return pages.length > 1 ? pages.filter((_, i) => i !== at) : pages;
}

export function movePage(pages: CustomPage[], from: number, to: number): CustomPage[] {
  if (to < 0 || to >= pages.length || from === to) return pages;
  const next = [...pages];
  const [page] = next.splice(from, 1);
  next.splice(to, 0, page!);
  return next;
}
