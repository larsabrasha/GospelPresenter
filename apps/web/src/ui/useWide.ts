import { useSyncExternalStore } from 'react';

/** Whether `query` matches, kept up to date as the window changes. */
function useMedia(query: MediaQueryList): boolean {
  return useSyncExternalStore(
    (on) => {
      query.addEventListener('change', on);
      return () => query.removeEventListener('change', on);
    },
    () => query.matches,
  );
}

const wideQuery = matchMedia('(min-width: 1024px)');

/** Whether the window is `lg` or wider (a computer, an iPad lying down), where the app has columns (docs/layout-2-0.md). */
export function useWide(): boolean {
  return useMedia(wideQuery);
}

const splitQuery = matchMedia('(min-width: 680px) and (min-height: 500px)');

/** Whether Inställningar has its two columns (the `split` variant in app.css): from an iPad held upright. */
export function useSplit(): boolean {
  return useMedia(splitQuery);
}
