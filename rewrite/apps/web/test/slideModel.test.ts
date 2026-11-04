import { blankPage, type CustomPage } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { addElement, addPage, duplicateElement, movePage, newElement, removePage, reorderElement } from '../src/pages/custom-slides/slideModel.ts';

const page = (...ids: string[]): CustomPage => ids.reduce((p, id) => addElement(p, newElement('rect', id)), blankPage());

describe('a custom slide in the editor', () => {
  it('places a new text in the middle of the stage', () => {
    const e = newElement('text', 't');

    expect([e.x + e.w / 2, e.y + e.h / 2]).toEqual([960, 540]);
  });

  it('fits a new picture inside 800×450, keeping its shape', () => {
    const e = newElement('image', 'i', { imageId: 'img', width: 1920, height: 1080 });

    expect([e.w, e.h]).toEqual([800, 450]);
  });

  it('moves an element one step up, and to the bottom', () => {
    const p = page('a', 'b', 'c');

    expect([reorderElement(p, 'a', 'up').elements.map((e) => e.id), reorderElement(p, 'c', 'bottom').elements.map((e) => e.id)]).toEqual([
      ['b', 'a', 'c'],
      ['c', 'a', 'b'],
    ]);
  });

  it('duplicates an element above it, moved a little', () => {
    const p = duplicateElement(page('a'), 'a', 'a2');

    expect(p.elements.map((e) => [e.id, e.x - p.elements[0]!.x])).toEqual([
      ['a', 0],
      ['a2', 40],
    ]);
  });

  it('copies a page after it with new element ids', () => {
    let n = 0;
    const pages = addPage([page('a')], 0, true, () => `new${++n}`);

    expect(pages.map((p) => p.elements.map((e) => e.id))).toEqual([['a'], ['new1']]);
  });

  it('keeps the last page when it is removed', () => {
    expect(removePage([page('a')], 0)).toHaveLength(1);
  });

  it('moves a page, and leaves pages as they are past the ends', () => {
    const pages = [page('a'), page('b')];

    expect([movePage(pages, 0, 1).map((p) => p.elements[0]!.id), movePage(pages, 1, 2)]).toEqual([['b', 'a'], pages]);
  });
});
