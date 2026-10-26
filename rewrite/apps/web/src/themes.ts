import { backgroundCss, backgroundOf, slideStyle, textStyleCss, type Css, type SlideKind, type Theme } from '@gp/core';
import auroraBackground from './assets/themes/aurora/background.webp?url';

/** Where this app serves each built-in theme asset: bundled, so it works offline. */
const ASSETS: Record<string, string> = { 'aurora/background': auroraBackground };

export function assetUrl(asset: string): string | null {
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
