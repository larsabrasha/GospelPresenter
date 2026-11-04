import { useSyncExternalStore } from 'react';

/** A phone's width, below which a panel is a sheet and a row of tabs a menu (Tailwind's `sm`). */
const PHONE = '(width < 40rem)';

/** Whether the window is a phone's width, kept up as it changes. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = matchMedia(PHONE);
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    () => matchMedia(PHONE).matches,
  );
}
