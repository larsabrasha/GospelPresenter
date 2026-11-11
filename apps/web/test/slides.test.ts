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

  it('refuses a PowerPoint as such, whatever type the browser reports', () => {
    expect(problemOf({ name: 'Predikan.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: MB })).toBe('powerpoint');
    expect(problemOf({ name: 'Predikan.ppt', type: '', size: MB })).toBe('powerpoint');
  });

  it('refuses another type', () => {
    expect(problemOf({ name: 'Predikan.key', type: '', size: MB })).toBe('type');
  });

  it('refuses an empty file and one over 50 MB', () => {
    expect(problemOf({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toBe('size');
    expect(problemOf({ name: 'a.pdf', type: 'application/pdf', size: 50 * MB + 1 })).toBe('size');
  });
});
