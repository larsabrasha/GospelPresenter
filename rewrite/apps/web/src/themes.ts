import { backgroundCss, backgroundOf, slideStyle, textStyleCss, type Css, type SlideKind, type Theme } from '@gp/core';
import auroraBackground from './assets/themes/aurora/background.webp?url';
import { t, type TextKey } from './i18n.ts';

/** Where this app serves each built-in theme asset: bundled, so it works offline. */
const ASSETS: Record<string, string> = { 'aurora/background': auroraBackground };

/** The built-in themes' names and descriptions in the page's language; the core keeps the Swedish. */
const TEXTS: Record<string, { name: TextKey; description: TextKey }> = {
  classic: { name: 'theme.classic', description: 'theme.classicDescription' },
  midnight: { name: 'theme.midnight', description: 'theme.midnightDescription' },
  daylight: { name: 'theme.daylight', description: 'theme.daylightDescription' },
  aurora: { name: 'theme.aurora', description: 'theme.auroraDescription' },
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
