import { useSyncExternalStore } from 'react';

const wideQuery = matchMedia('(min-width: 1024px)');

/** Whether the window is `lg` or wider (a computer, an iPad lying down), where the app has columns (docs/layout-2-0.md). */
export function useWide(): boolean {
  return useSyncExternalStore(
    (on) => {
      wideQuery.addEventListener('change', on);
      return () => wideQuery.removeEventListener('change', on);
    },
    () => wideQuery.matches,
  );
}
