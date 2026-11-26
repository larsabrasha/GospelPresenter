import { backgroundCss, backgroundOf, slideStyle, textStyleCss, type Css, type SlideKind, type Theme } from '@gp/core';
import blueBackdrop from './assets/backdrops/blue.jpg';
import { t, type TextKey } from './i18n.ts';

/**
 * Where this app serves each built-in theme asset: bundled, so it works offline. Blått's picture is a 1920×1080
 * screenshot by Chromium of `radial-gradient(60% 55% at 30% 18%, rgba(56, 189, 248, 0.55), transparent 70%),
 * radial-gradient(50% 45% at 78% 30%, rgba(129, 140, 248, 0.45), transparent 70%), radial-gradient(70% 60% at 55% 110%,
 * rgba(14, 116, 144, 0.6), transparent 70%), linear-gradient(160deg, #0b1f3a, #071226 60%, #050b18)`, as JPEG.
 */
const ASSETS: Record<string, string> = { 'backdrops/blue': blueBackdrop };

/** The built-in themes' names and descriptions in the page's language; the core keeps the Swedish. */
const TEXTS: Record<string, { name: TextKey; description: TextKey }> = {
  classic: { name: 'theme.classic', description: 'theme.classicDescription' },
  light: { name: 'theme.light', description: 'theme.lightDescription' },
  blue: { name: 'theme.blue', description: 'theme.blueDescription' },
  terminal: { name: 'theme.terminal', description: 'theme.terminalDescription' },
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
