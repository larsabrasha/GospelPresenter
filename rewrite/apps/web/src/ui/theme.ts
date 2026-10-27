// The app's colour theme, as in the current app: `.dark` on <html>, the
// choice in localStorage 'theme' ('light', 'dark' or 'system'), and the
// system's setting when nothing is chosen. The choice belongs to the device.

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'theme';
const media = matchMedia('(prefers-color-scheme: dark)');

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage refused (a private window): the choice lasts until the page closes.
  }
  applyTheme(theme);
}

function applyTheme(theme = getTheme()): void {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Sets the class before the first render, and follows the system while the choice is 'system'. Call once. */
export function installTheme(): void {
  applyTheme();
  media.addEventListener('change', () => applyTheme());
}
