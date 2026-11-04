import { backgroundCss, backgroundOf, slideStyle, textStyleCss, type Css, type SlideKind, type Theme } from '@gp/core';
import { t, type TextKey } from './i18n.ts';

/** Where this app serves each built-in theme asset: bundled, so it works offline. The built-in themes have none now. */
const ASSETS: Record<string, string> = {};

/** The built-in themes' names and descriptions in the page's language; the core keeps the Swedish. */
const TEXTS: Record<string, { name: TextKey; description: TextKey }> = {
  classic: { name: 'theme.classic', description: 'theme.classicDescription' },
  light: { name: 'theme.light', description: 'theme.lightDescription' },
};

export function themeName(theme: Theme): string {
  const texts = TEXTS[theme.id];
  return texts ? t(texts.name) : theme.name;
}

export function themeDescription(theme: Theme): string {
  const texts = TEXTS[theme.id];
  return texts ? t(texts.description) : theme.description;
}

function assetUrl(asset: string): string | null {
  return ASSETS[asset] ?? null;
}

/** The stage's background for a slide kind. */
export function stageCss(theme: Theme, kind: SlideKind): Css {
  return backgroundCss(backgroundOf(theme, kind), assetUrl);
}

export function mainCss(theme: Theme, kind: 'song' | 'bible'): Css {
  return textStyleCss(slideStyle(theme, kind).main);
}

export function creditsCss(theme: Theme, kind: 'song' | 'bible'): Css {
  return textStyleCss(slideStyle(theme, kind).credits);
}
