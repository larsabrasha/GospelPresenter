import { useEffect } from 'react';

/**
 * Gives the focus back, as the dialog or sheet that took it closes, to what had it when it opened: Escape then reaches
 * what is under it (a sheet under a confirmation), one step at a time.
 */
export function useReturnFocus() {
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
}
