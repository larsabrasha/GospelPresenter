import { describe, expect, it } from 'vitest';
import { checkPickedDeck, SlidesRefused } from '../src/media/slides.ts';

const MB = 1024 * 1024;

function problemOf(file: { name: string; type: string; size: number }): string | null {
  try {
    checkPickedDeck(file);
    return null;
  } catch (e) {
    return e instanceof SlidesRefused ? e.problem : 'thrown';
  }
}

describe('picking a slide deck', () => {
  it('takes a PDF by its type or, when the browser reports none, by its extension', () => {
    expect(problemOf({ name: 'Predikan.pdf', type: 'application/pdf', size: MB })).toBeNull();
    expect(problemOf({ name: 'Predikan.PDF', type: '', size: MB })).toBeNull();
  });

  it('takes a PowerPoint deck (.pptx) by its type or its extension, for the host to draw', () => {
    expect(checkPickedDeck({ name: 'Predikan.pptx', type: '', size: MB })).toBe('pptx');
    expect(checkPickedDeck({ name: 'Predikan', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: MB })).toBe('pptx');
  });

  it('refuses an old PowerPoint (.ppt) as such, whatever type the browser reports', () => {
    expect(problemOf({ name: 'Predikan.ppt', type: '', size: MB })).toBe('oldPowerpoint');
    expect(problemOf({ name: 'Predikan', type: 'application/vnd.ms-powerpoint', size: MB })).toBe('oldPowerpoint');
  });

  it('refuses another type', () => {
    expect(problemOf({ name: 'Predikan.key', type: '', size: MB })).toBe('type');
  });

  it('refuses an empty file and one over 50 MB', () => {
    expect(problemOf({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toBe('size');
    expect(problemOf({ name: 'a.pdf', type: 'application/pdf', size: 50 * MB + 1 })).toBe('size');
  });
});
