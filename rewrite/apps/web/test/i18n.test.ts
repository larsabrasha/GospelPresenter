// The language switch (GAPS.md "Engelska", decided on 2026-10-31): Swedish until a device chooses English, and a
// public output's viewer follows their browser.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLanguage, language, texts, type TextKey } from '../src/i18n.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();

describe('the texts', () => {
  it('give every English text the placeholders of its Swedish one', () => {
    const differ = (Object.keys(texts.sv) as TextKey[]).filter((k) => placeholders(texts.sv[k]).join() !== placeholders(texts.en[k]).join());

    expect(differ).toEqual([]);
  });

  it('show Swedish on a device that has chosen nothing', () => {
    expect(language()).toBe('sv');
  });
});

describe("a viewer's browser language", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is Swedish for any Swedish locale', () => {
    vi.stubGlobal('navigator', { languages: ['sv-FI', 'en'], language: 'sv-FI' });

    expect(browserLanguage()).toBe('sv');
  });

  it('is English for any other first language, even with Swedish further down', () => {
    vi.stubGlobal('navigator', { languages: ['nb-NO', 'sv-SE'], language: 'nb-NO' });

    expect(browserLanguage()).toBe('en');
  });
});
