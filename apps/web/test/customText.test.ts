import { blankPage, BUILT_IN_THEMES, readCustomPage, slideStyle, type CustomElement } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { newElement } from '../src/pages/custom-slides/slideModel.ts';
import { elementTextCss, elementTextStyle } from '../src/ui/customText.ts';

type TextElement = Extract<CustomElement, { kind: 'text' }>;

const text = (patch: Partial<TextElement> = {}): TextElement => ({ ...(newElement('text', 't') as TextElement), ...patch });
// The terminal theme: its song text is not the classic one's, so what is followed shows.
const theme = BUILT_IN_THEMES.find((t) => t.id === 'terminal')!;
const main = slideStyle(theme, 'song').main;

// A slideshow's or an overlay's text as a theme's text (ui/customText.ts): what it sets over the theme's song text.
describe('a text on a slide', () => {
  it("follows the theme's song text in what it does not set", () => {
    const style = elementTextStyle(text(), theme);

    expect([style.fontFamily, style.lineHeight, style.shadow, style.uppercase, style.outline]).toEqual([main.fontFamily, main.lineHeight, main.shadow, main.uppercase, main.outline]);
  });

  it('takes its own font, line height, shadow, capitals and outline over the theme', () => {
    const style = elementTextStyle(text({ font: 'Lato', lineHeight: 2, shadow: true, uppercase: true, outline: 3, outlineColor: '#ff0000' }), theme);

    expect([style.fontFamily, style.lineHeight, style.shadow, style.uppercase, style.outline, style.outlineColor]).toEqual(['Lato', 2, true, true, 3, '#ff0000']);
  });

  it('is as heavy as its weight, which wins over bold', () => {
    const style = elementTextStyle(text({ bold: true, weight: 600 }), theme);

    expect(style.fontWeight).toBe(600);
  });

  it('is bold without a weight, as a text made before weights', () => {
    const style = elementTextStyle(text({ bold: true }), theme);

    expect(style.fontWeight).toBe(700);
  });

  it('is drawn as opaque as its opacity, and whole without one', () => {
    expect([elementTextCss(text({ opacity: 40 }), theme).opacity, elementTextCss(text(), theme).opacity]).toEqual([0.4, 1]);
  });

  it('keeps what it sets when its page is read back', () => {
    const page = { ...blankPage(), elements: [text({ font: 'Lato', weight: 600, opacity: 50, shadow: true, outline: 2, outlineColor: '#000000' })] };

    const read = readCustomPage(JSON.parse(JSON.stringify(page))).elements[0] as TextElement;

    expect([read.font, read.weight, read.opacity, read.shadow, read.outline]).toEqual(['Lato', 600, 50, true, 2]);
  });
});
