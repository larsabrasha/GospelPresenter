import { slideStyle, textStyleCss, type Css, type CustomElement, type TextStyle, type Theme } from '@gp/core';

type TextElement = Extract<CustomElement, { kind: 'text' }>;

/**
 * A slideshow's or an overlay's text as a theme's text (docs/custom-slides.md): what it sets over the look of the
 * theme's song text, which it follows in what it does not set, as before it had more than its size, bold, italic,
 * alignment and colour. One look for both editors' Text panel and every output (Lars, 2026-11-26).
 */
export function elementTextStyle(e: TextElement, theme: Theme): TextStyle {
  const main = slideStyle(theme, 'song').main;
  return {
    ...main,
    fontFamily: e.font ?? main.fontFamily,
    fontSize: e.size,
    fontWeight: e.weight ?? (e.bold ? 700 : main.fontWeight),
    lineHeight: e.lineHeight ?? main.lineHeight,
    color: e.color ?? main.color,
    align: e.align,
    italic: e.italic,
    uppercase: e.uppercase ?? main.uppercase,
    shadow: e.shadow ?? main.shadow,
    outline: e.outline ?? main.outline,
    outlineColor: e.outlineColor ?? main.outlineColor,
  };
}

/** The text's CSS, as a theme's text is drawn, and its opacity, which a theme keeps in its colour. */
export function elementTextCss(e: TextElement, theme: Theme): Css {
  return { ...textStyleCss(elementTextStyle(e, theme)), fontStyle: e.italic ? 'italic' : 'normal', opacity: (e.opacity ?? 100) / 100 };
}
