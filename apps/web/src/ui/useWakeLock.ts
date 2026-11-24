import { useEffect } from 'react';

/** Keeps the screen awake while the component is shown and `on`, taking the lock again when the window shows (Live.razor, utils.js). */
export function useWakeLock(on = true): void {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState === 'visible') void navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [on]);
}
